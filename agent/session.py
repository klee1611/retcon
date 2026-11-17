"""Session lifecycle and the 'what the user actually asked for' view of memory."""
from datetime import UTC, datetime

from retcon.store import TRUSTED_TYPES

SEED_SOURCE = {"type": "system", "id": "seed"}


def start_session(db, scenario, session_id: str, *, enabled: bool = True) -> dict:
    from retcon import make_store

    store = make_store(db, session_id=session_id, enabled=enabled)  # validates the id
    doc = {"_id": session_id, "scenario": scenario.id, "retcon_enabled": enabled,
           "created_at": datetime.now(UTC), "llm_calls_used": 0}
    db["sessions"].insert_one(doc)
    for m in scenario.seed:
        store.put((session_id, m.suffix), m.key, {
            "text": m.text, "source": dict(SEED_SOURCE),
            "readable_by": [session_id], "status": "active"})
    return doc


def user_memories(db, session_id: str) -> dict[str, str]:
    """key -> the latest value written by a trusted source in this session.

    Replays memory_history in order: a put/release/rollback whose value comes from a
    trusted source sets the key; an untrusted overwrite is ignored (so a poisoned
    write cannot change what the user asked for); deletes, forgets and rollbacks to
    'absent' clear it.
    """
    out: dict[str, str] = {}
    rows = db["memory_history"].find({"session_id": session_id}).sort([("at", 1), ("_id", 1)])
    for h in rows:
        after = h.get("value_after")
        if h["op"] in ("delete", "forget") or after is None:
            out.pop(h["key"], None)
        elif (after.get("source") or {}).get("type") in TRUSTED_TYPES:
            out[h["key"]] = after["text"]
    return out
