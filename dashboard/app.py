"""Retcon live dashboard. Run: uv run uvicorn dashboard.app:app --port 8000"""
import asyncio
import json
import queue
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse

load_dotenv()

COLLECTIONS = ["memories", "quarantine", "sources", "refunds", "memory_history", "demo_runs"]
app = FastAPI(title="Retcon dashboard")
# Local-only dashboard: reject other Host headers so a malicious site can't read
# memory contents through DNS rebinding.
from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: E402

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


_ORIGIN_RE = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")


async def guard(request: Request):
    """CSRF defence for POSTs: same-origin only, JSON content type required."""
    origin = request.headers.get("origin")
    if origin is not None and not _ORIGIN_RE.match(origin):
        raise HTTPException(403, "cross-origin request rejected")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise HTTPException(415, "Content-Type must be application/json")


_store = None
_store_lock = threading.Lock()


def get_store():
    """Lazy singleton unchecked store (index setup can be slow)."""
    global _store
    with _store_lock:
        if _store is None:
            from retcon.db import make_store
            _store = make_store(_db(), enabled=False)
        return _store


@app.on_event("startup")
def _warm_store():
    def run():
        try:
            get_store()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


def _db():
    try:
        from retcon.db import get_db
        return get_db()
    except ImportError:
        import os
        from pymongo import MongoClient
        return MongoClient(os.environ["MONGODB_URI"])["retcon"]


def clean(o):
    """Recursively make a document JSON-safe."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, ObjectId):
        return str(o)
    if isinstance(o, datetime):
        if o.tzinfo is None:
            o = o.replace(tzinfo=timezone.utc)
        return o.isoformat()
    return o


def _oid(s):
    try:
        return ObjectId(s)
    except Exception:
        return s


@app.get("/", response_class=HTMLResponse)
def index():
    return (Path(__file__).parent / "index.html").read_text()


@app.get("/state")
def state():
    db = _db()
    def q(name, sort=None, limit=200):
        cur = db[name].find()
        if sort:
            cur = cur.sort(sort, -1)
        return clean(list(cur.limit(limit)))
    return {
        "memories": q("memories"),
        "quarantine": q("quarantine", "created_at"),
        "sources": q("sources"),
        "refunds": q("refunds", "at"),
        "history": q("memory_history", "at", 50),
    }


def _watch(db, out: queue.Queue, stop: threading.Event):
    pipeline = [{"$match": {"ns.coll": {"$in": COLLECTIONS},
                            "operationType": {"$in": ["insert", "update", "replace", "delete"]}}}]
    try:
        with db.watch(pipeline, full_document="updateLookup", max_await_time_ms=500) as stream:
            while not stop.is_set():
                ch = stream.try_next()
                if ch is None:
                    continue
                if ch["ns"]["coll"] == "memories" and ch["operationType"] == "update":
                    fields = (ch.get("updateDescription") or {}).get("updatedFields") or {}
                    if not any(k == "value" or k.startswith("value.") for k in fields):
                        continue  # timestamp-only refresh (e.g. store.get)
                doc = ch.get("fullDocument")
                if doc is None:
                    doc = {"_id": ch["documentKey"]["_id"]}
                out.put({"collection": ch["ns"]["coll"], "op": ch["operationType"],
                         "doc": clean(doc), "at": datetime.now(timezone.utc).isoformat()})
    except Exception as e:  # surface to client, then end
        out.put({"collection": "_error", "op": "error", "doc": {"error": str(e)}, "at": None})


@app.get("/events")
async def events():
    out: queue.Queue = queue.Queue()
    stop = threading.Event()
    threading.Thread(target=_watch, args=(_db(), out, stop), daemon=True).start()

    async def gen():
        try:
            yield ": connected\n\n"
            idle = 0
            while True:
                try:
                    ev = out.get_nowait()
                    idle = 0
                    yield f"data: {json.dumps(ev)}\n\n"
                except queue.Empty:
                    await asyncio.sleep(0.2)
                    idle += 1
                    if idle % 75 == 0:
                        yield ": ping\n\n"
        finally:  # client disconnect cancels the generator
            stop.set()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/rollback", dependencies=[Depends(guard)])
def rollback(body: dict):
    try:
        from retcon.rollback import rollback_to
    except ImportError:
        raise HTTPException(501, "retcon.rollback not available yet")
    try:
        at = datetime.fromisoformat(body["at"].replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "body must be {at: iso8601}")
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return clean(rollback_to(db=_db(), store=get_store(), at=at))


@app.post("/quarantine/{qid}/release", dependencies=[Depends(guard)])
def release(qid: str):
    from langgraph.store.base import PutOp
    db = _db()
    d = db["quarantine"].find_one({"_id": _oid(qid)})
    if not d:
        raise HTTPException(404, "not found")
    if d.get("status") != "held":
        raise HTTPException(409, f"item is {d.get('status')}, not held")
    ns, key, value = tuple(d["namespace"]), d["key"], d["value"]
    store = get_store()
    before = store._current(ns, key)
    store.raw_batch([PutOp(ns, key, value)])
    db["memory_history"].insert_one({
        "namespace": list(ns), "key": key, "op": "release",
        "value_before": before, "value_after": value,
        "source": d.get("source"), "at": datetime.now(timezone.utc)})
    r = db["quarantine"].update_one({"_id": d["_id"], "status": "held"},
                                    {"$set": {"status": "released"}})
    if not r.matched_count:
        raise HTTPException(409, "item changed concurrently")
    return {"ok": True}


@app.post("/quarantine/{qid}/delete", dependencies=[Depends(guard)])
def delete(qid: str):
    db = _db()
    d = db["quarantine"].find_one({"_id": _oid(qid)})
    if not d:
        raise HTTPException(404, "not found")
    r = db["quarantine"].update_one({"_id": d["_id"], "status": "held"},
                                    {"$set": {"status": "deleted"}})
    if not r.matched_count:
        raise HTTPException(409, f"item is {d.get('status')}, not held")
    return {"ok": True}
