"""Human review of quarantined writes: release into memory or discard."""
from bson import ObjectId
from bson.errors import InvalidId
from langgraph.store.base import PutOp


def _as_oid(quarantine_id) -> ObjectId:
    if isinstance(quarantine_id, ObjectId):
        return quarantine_id
    try:
        return ObjectId(str(quarantine_id))
    except (InvalidId, TypeError) as e:
        raise LookupError("unknown quarantine item") from e


def _claim(db, session_id: str, quarantine_id, status: str) -> dict:
    """Atomically move a held item of this session to `status`; LookupError if it isn't held."""
    doc = db["quarantine"].find_one_and_update(
        {"_id": _as_oid(quarantine_id), "session_id": session_id, "status": "held"},
        {"$set": {"status": status}})
    if doc is None:
        raise LookupError("unknown or already handled quarantine item")
    return doc


def release(db, store, session_id: str, quarantine_id) -> dict:
    """Write the held value into memory without checks and record a 'release' event."""
    if store.session_id != session_id:
        raise PermissionError("store is not bound to this session")
    doc = _claim(db, session_id, quarantine_id, "released")
    ns, key, value = tuple(doc["namespace"]), doc["key"], doc["value"]
    try:
        before = store._current(ns, key)
        store.raw_batch([PutOp(namespace=ns, key=key, value=value)])
    except BaseException:
        db["quarantine"].update_one({"_id": doc["_id"]}, {"$set": {"status": "held"}})
        raise
    history_id = store._history(ns, key, "release", before, value, doc.get("source"))
    return {"quarantine_id": str(doc["_id"]), "history_id": str(history_id)}


def discard(db, session_id: str, quarantine_id) -> dict:
    doc = _claim(db, session_id, quarantine_id, "discarded")
    return {"quarantine_id": str(doc["_id"])}
