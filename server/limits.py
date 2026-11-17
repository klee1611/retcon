"""Quotas and rate limits. Every counter lives in MongoDB (`usage`), never in process memory."""
import hashlib
import os
from datetime import UTC, datetime

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from server.errors import ApiError


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def session_llm_limit() -> int:
    return _int("SESSION_LLM_CALLS", 30)


def max_input_chars() -> int:
    return _int("MAX_INPUT_CHARS", 2000)


def ip_sessions_per_hour() -> int:
    return _int("IP_SESSIONS_PER_HOUR", 5)


def daily_llm_limit() -> int:
    return _int("DAILY_LLM_CALLS", 1000)


def check_text(text: str) -> None:
    if len(text) > max_input_chars():
        raise ApiError(400, "input_too_long",
                       f"Text is limited to {max_input_chars()} characters.")


def check_session_quota(session_doc: dict) -> None:
    if session_doc.get("llm_calls_used", 0) >= session_llm_limit():
        raise ApiError(429, "session_quota_exhausted",
                       "This session has used all of its LLM calls.")


def client_ip(headers, client_host: str | None) -> str:
    real = headers.get("x-real-ip")
    if real:
        return real.strip()
    fwd = headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return client_host or "unknown"


def hash_ip(ip: str) -> str:
    salt = os.environ.get("IP_HASH_SALT", "retcon-dev-salt")
    return hashlib.sha256((salt + ip).encode()).hexdigest()


def check_ip_rate(db, ip: str, now: datetime | None = None) -> None:
    """Count one new-session attempt for this IP in the current hour; over the cap -> 429."""
    now = now or datetime.now(UTC)
    hour = now.strftime("%Y%m%d%H")
    doc = db["usage"].find_one_and_update(
        {"_id": f"ip:{hash_ip(ip)}:{hour}"},
        {"$inc": {"sessions": 1}, "$setOnInsert": {"created_at": now}},
        upsert=True, return_document=ReturnDocument.AFTER)
    if doc["sessions"] > ip_sessions_per_hour():
        retry = 3600 - (now.minute * 60 + now.second)
        raise ApiError(429, "ip_rate_limited",
                       "Too many sessions from this network. Try again later.", retry_after=retry)


def _daily_id(now: datetime) -> str:
    return f"daily:{now.strftime('%Y-%m-%d')}"


def _daily_error() -> ApiError:
    return ApiError(503, "daily_quota_exhausted", "The demo's LLM budget for today is used up.")


def daily_left(db, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    doc = db["usage"].find_one({"_id": _daily_id(now)}) or {}
    return max(0, daily_llm_limit() - doc.get("llm_calls", 0))


def check_daily_open(db) -> None:
    if daily_left(db) <= 0:
        raise _daily_error()


def consume_daily(db, now: datetime | None = None) -> None:
    """Atomically take one global LLM call, or raise 503 when today's budget is gone."""
    now = now or datetime.now(UTC)
    flt = {"_id": _daily_id(now), "llm_calls": {"$lt": daily_llm_limit()}}
    upd = {"$inc": {"llm_calls": 1}, "$setOnInsert": {"created_at": now}}
    try:
        res = db["usage"].update_one(flt, upd, upsert=True)
    except DuplicateKeyError:  # the doc exists and is at the limit (upsert collided on _id)
        raise _daily_error() from None
    if res.matched_count == 0 and res.upserted_id is None:
        raise _daily_error()
