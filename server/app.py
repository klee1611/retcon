"""FastAPI app implementing docs/06-interfaces.md. Run: uvicorn server.app:app"""
import logging
import os
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StrictBool
from pymongo.errors import ConnectionFailure, ExecutionTimeout

import agent
import retcon
import scenarios
from retcon import quarantine
from retcon.state import session_state
from server import db as db_mod
from server import limits, sessions
from server.errors import ApiError, invalid_request, unknown_scenario

VERSION = "2.0.0"
log = logging.getLogger("retcon.server")


def database():
    return db_mod.get_database()


# ---------- security ----------

def _allowed_origins() -> set[str]:
    return {o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()}


def guard(request: Request) -> None:
    """POSTs: same-origin (or allow-listed) Origin and a JSON content type."""
    if request.method != "POST":
        return
    origin = request.headers.get("origin", "").rstrip("/")
    host = request.headers.get("host", "")
    same = bool(origin) and urlparse(origin).netloc == host and bool(host)
    if not (same or (origin and origin in _allowed_origins())):
        raise ApiError(403, "forbidden_origin", "Origin not allowed.")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json.")


app = FastAPI(dependencies=[Depends(guard)], docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except (ConnectionFailure, ExecutionTimeout):
        log.exception("database unavailable")
        response = ApiError(503, "db_unavailable", "The database is unreachable.").response()
    except Exception:
        log.exception("unhandled error")
        response = ApiError(500, "internal", "Something went wrong.").response()
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ApiError)
async def _api_error(_request, exc: ApiError):
    return exc.response()


@app.exception_handler(RequestValidationError)
async def _validation(_request, _exc):
    return invalid_request().response()


@app.exception_handler(agent.LLMUnavailable)
async def _llm(_request, exc):
    log.warning("llm unavailable: %s", exc)
    return ApiError(502, "llm_unavailable",
                    "The model did not answer. Nothing was changed; you can retry.",
                    retry_after=2).response()


@app.exception_handler(agent.SessionQuotaExhausted)
async def _quota(_request, _exc):
    return ApiError(429, "session_quota_exhausted",
                    "This session has used all of its LLM calls.").response()


@app.exception_handler(agent.SessionStartError)
async def _start_failed(_request, exc):
    log.error("session start failed: %s", exc)
    return ApiError(500, "internal", "Something went wrong.").response()


# ---------- request models ----------

class NewSession(BaseModel):
    scenario: str


class Chat(BaseModel):
    message: str


class Ingest(BaseModel):
    kind: str
    text: str


class Toggle(BaseModel):
    enabled: StrictBool


class Rollback(BaseModel):
    history_id: str
    preview: StrictBool = True


# ---------- helpers ----------

def _state(db, sid: str) -> dict:
    doc = sessions.get_session(db, sid)
    state = session_state(db, doc)
    state["usage"]["llm_calls_limit"] = limits.session_llm_limit()
    return state


def _mv(v):
    return {"text": v.get("text", ""), "source": v.get("source")} if v else None


def _scenario_of(doc):
    try:
        return scenarios.get(doc["scenario"])
    except KeyError:
        raise unknown_scenario() from None


def _store(doc):
    return retcon.make_store(database(), session_id=doc["_id"], enabled=doc["retcon_enabled"])


def _owned(request: Request, sid: str) -> None:
    sessions.require_cookie(request, sid)


# ---------- endpoints ----------

@app.get("/api/health")
def health():
    try:
        db = database()
        db.command("ping")
        return {"ok": True, "db": "ok", "version": VERSION,
                "daily_quota_left": limits.daily_left(db)}
    except Exception:
        log.warning("health: database down", exc_info=True)
        return {"ok": False, "db": "down", "version": VERSION, "daily_quota_left": None}


@app.get("/api/scenarios")
def list_scenarios():
    return {"scenarios": [s.manifest() for s in scenarios.all()]}


@app.post("/api/sessions", status_code=201)
def create_session(body: NewSession, request: Request, response: Response):
    try:
        scenario = scenarios.get(body.scenario)
    except KeyError:
        raise unknown_scenario() from None
    if not scenario.available:
        raise unknown_scenario()
    db = database()
    limits.check_ip_rate(db, limits.client_ip(request.headers,
                                              request.client.host if request.client else None))
    limits.check_daily_open(db)
    sid = sessions.new_sid()
    doc = agent.start_session(db, scenario, sid, enabled=True)
    sessions.set_cookie(response, sid)
    state = session_state(db, doc)
    state["usage"]["llm_calls_limit"] = limits.session_llm_limit()
    return {"state": state}


@app.get("/api/sessions/{sid}")
def get_state(sid: str, request: Request):
    _owned(request, sid)
    return {"state": _state(database(), sid)}


@app.post("/api/sessions/{sid}/chat")
def chat(sid: str, body: Chat, request: Request):
    _owned(request, sid)
    limits.check_text(body.message)
    db = database()
    with sessions.session_lock(db, sid):
        doc = sessions.get_session(db, sid)
        scenario = _scenario_of(doc)
        limits.check_session_quota(doc)
        limits.consume_daily(db)
        turn = agent.run_turn(db, _store(doc), scenario, sid, body.message)
        return {"turn": turn, "state": _state(db, sid)}


@app.post("/api/sessions/{sid}/ingest")
def ingest(sid: str, body: Ingest, request: Request):
    _owned(request, sid)
    limits.check_text(body.text)
    db = database()
    with sessions.session_lock(db, sid):
        doc = sessions.get_session(db, sid)
        scenario = _scenario_of(doc)
        if body.kind not in {k.kind for k in scenario.source_kinds}:
            raise invalid_request("Unknown source kind for this scenario.")
        limits.check_session_quota(doc)
        limits.consume_daily(db)
        result = agent.ingest(db, _store(doc), scenario, sid, body.kind, body.text)
        return {"ingest": result, "state": _state(db, sid)}


@app.post("/api/sessions/{sid}/toggle")
def toggle(sid: str, body: Toggle, request: Request):
    _owned(request, sid)
    db = database()
    with sessions.session_lock(db, sid):
        db["sessions"].update_one({"_id": sid}, {"$set": {"retcon_enabled": body.enabled}})
        return {"state": _state(db, sid)}


@app.post("/api/sessions/{sid}/rollback")
def rollback(sid: str, body: Rollback, request: Request):
    _owned(request, sid)
    db = database()
    if body.preview:  # read-only: never takes the session lock
        return _rollback(db, sid, body)
    with sessions.session_lock(db, sid):
        return _rollback(db, sid, body)


def _rollback(db, sid: str, body: Rollback) -> dict:
    doc = sessions.get_session(db, sid)
    try:
        raw = retcon.rollback_to_event(db, _store(doc), body.history_id, sid,
                                       preview=body.preview)
    except LookupError:
        raise ApiError(404, "history_event_not_found",
                       "That event is not in this session.") from None
    diff = {"history_id": raw["history_id"]}
    for kind in ("added", "removed", "changed"):
        diff[kind] = [{"key": i["key"], "before": _mv(i["before"]), "after": _mv(i["after"])}
                      for i in raw[kind]]
    applied = not body.preview and any(diff[k] for k in ("added", "removed", "changed"))
    return {"diff": diff, "applied": applied, "state": _state(db, sid)}


def _review(sid: str, qid: str, request: Request, action: str):
    _owned(request, sid)
    db = database()
    with sessions.session_lock(db, sid):
        doc = sessions.get_session(db, sid)
        try:
            if action == "release":
                quarantine.release(db, _store(doc), sid, qid)
            else:
                quarantine.discard(db, sid, qid)
        except LookupError:
            raise ApiError(404, "quarantine_item_not_found",
                           "That item does not exist or was already handled.") from None
        return {"state": _state(db, sid)}


@app.post("/api/sessions/{sid}/quarantine/{qid}/release")
def release_item(sid: str, qid: str, request: Request):
    return _review(sid, qid, request, "release")


@app.post("/api/sessions/{sid}/quarantine/{qid}/discard")
def discard_item(sid: str, qid: str, request: Request):
    return _review(sid, qid, request, "discard")


@app.exception_handler(404)
async def _not_found(_request, _exc):
    return JSONResponse({"error": {"code": "not_found", "message": "Not found."}}, status_code=404)
