"""Session cookie checks and the per-session lock (stored in the `sessions` doc)."""
import logging
import os
import secrets
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response

from server.errors import ApiError, session_not_found

COOKIE = "retcon_sid"
LOCK_SECONDS = 30
log = logging.getLogger("retcon.server")


def new_sid() -> str:
    return secrets.token_urlsafe(16)


def cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "1").strip().lower() not in ("0", "false", "no", "off")


def set_cookie(response: Response, sid: str) -> None:
    response.set_cookie(COOKIE, sid, max_age=86400, path="/api", httponly=True,
                        secure=cookie_secure(), samesite="strict")


def require_cookie(request: Request, sid: str) -> None:
    got = request.cookies.get(COOKIE)
    if not got or not secrets.compare_digest(got.encode(), sid.encode()):
        raise ApiError(403, "session_mismatch", "This is not your session.")


def get_session(db, sid: str) -> dict:
    doc = db["sessions"].find_one({"_id": sid})
    if doc is None:
        raise session_not_found()
    return doc


@contextmanager
def session_lock(db, sid: str):
    """One request at a time per session: atomic lock with a 30 s expiry."""
    now = datetime.now(UTC)
    token = secrets.token_hex(8)
    doc = db["sessions"].find_one_and_update(
        {"_id": sid, "$or": [{"lock_until": {"$exists": False}}, {"lock_until": None},
                             {"lock_until": {"$lt": now}}]},
        {"$set": {"lock_until": now + timedelta(seconds=LOCK_SECONDS), "lock_token": token}})
    if doc is None:
        get_session(db, sid)  # 404 if the session is gone, otherwise it is busy
        raise ApiError(409, "session_busy",
                       "Another request for this session is still running.", retry_after=2)
    try:
        yield
    finally:
        try:
            db["sessions"].update_one({"_id": sid, "lock_token": token},
                                      {"$unset": {"lock_until": "", "lock_token": ""}})
        except Exception:
            log.exception("could not release session lock")
