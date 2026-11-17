"""Session lifecycle and the 'what the user actually asked for' view of memory."""
import logging
from datetime import UTC, datetime

from pymongo.errors import DuplicateKeyError

from retcon.store import TRUSTED_TYPES

PREFERENCES = "preferences"
log = logging.getLogger("retcon.agent")

SEED_SOURCE = {"type": "system", "id": "seed"}


class SessionStartError(Exception):
    """A session could not be created (duplicate id or seeding failed); nothing is left behind."""


_SESSION_DATA = ("memories", "memory_history", "quarantine", "sources", "actions")


def _cleanup(db, session_id: str) -> None:
    for name in _SESSION_DATA:
        field = "namespace.0" if name == "memories" else "session_id"
        try:
            db[name].delete_many({field: session_id})
        except Exception:  # best effort; the 24h TTL reaps the rest
            log.warning("cleanup of %s failed for %s", name, session_id, exc_info=True)


def start_session(db, scenario, session_id: str, *, enabled: bool = True) -> dict:
    """Seed first, then insert the session doc, so a failure never leaves a half-made session."""
    from retcon import make_store

    store = make_store(db, session_id=session_id, enabled=enabled)  # validates the id
    if db["sessions"].find_one({"_id": session_id}, {"_id": 1}):
        raise SessionStartError(f"session id already exists: {session_id}")
    try:
        for m in scenario.seed:
            store.put((session_id, m.suffix), m.key, {
                "text": m.text, "source": dict(SEED_SOURCE),
                "readable_by": [session_id], "status": "active"})
        doc = {"_id": session_id, "scenario": scenario.id, "retcon_enabled": enabled,
               "created_at": datetime.now(UTC), "llm_calls_used": 0}
        db["sessions"].insert_one(doc)
    except DuplicateKeyError as e:  # lost a race: the other session owns this id's data
        raise SessionStartError(f"session id already exists: {session_id}") from e
    except Exception:
        _cleanup(db, session_id)
        raise
    return doc


def user_memories(db, session_id: str) -> dict[str, str]:
    """key -> the latest preferences value written by a trusted source in this session.

    Replay is keyed by (namespace, key); only the `preferences` namespace is returned.

    Replays memory_history in order: a put/release/rollback whose value comes from a
    trusted source sets the key; an untrusted overwrite is ignored (so a poisoned
    write cannot change what the user asked for); deletes, forgets and rollbacks to
    'absent' clear it.
    """
    out: dict[tuple, str] = {}
    rows = db["memory_history"].find({"session_id": session_id}).sort([("at", 1), ("_id", 1)])
    for h in rows:
        after = h.get("value_after")
        k = (tuple(h.get("namespace") or ()), h["key"])
        if h["op"] in ("delete", "forget") or after is None:
            out.pop(k, None)
        elif (after.get("source") or {}).get("type") in TRUSTED_TYPES:
            out[k] = after["text"]
    return {key: text for (ns, key), text in out.items() if len(ns) > 1 and ns[1] == PREFERENCES}
