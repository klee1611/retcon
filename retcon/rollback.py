"""Event-based rollback driven by memory_history, scoped to one session."""
from bson import ObjectId
from bson.errors import InvalidId
from langgraph.store.base import PutOp

from retcon.store import _now

_ORDER = [("at", 1), ("_id", 1)]


def snapshot(db, session_id: str) -> dict:
    """The session's active memories as {(namespace tuple, key): value}."""
    return {
        (tuple(d["namespace"]), d["key"]): d["value"]
        for d in db["memories"].find({"namespace.0": session_id, "value.status": "active"})
    }


def _as_oid(history_id) -> ObjectId:
    if isinstance(history_id, ObjectId):
        return history_id
    try:
        return ObjectId(str(history_id))
    except (InvalidId, TypeError) as e:
        raise LookupError("unknown history event") from e


def rollback_to_event(db, store, history_id, session_id: str, *, preview: bool = False) -> dict:
    """Restore the session's memories to the state just before event `history_id`.

    That event and every later event in the session are undone. Returns
    {"history_id", "added", "removed", "changed"}, each change being
    {namespace, key, before, after}. With preview=True nothing is written.
    Raises LookupError if the event does not exist in this session.
    """
    if store.session_id != session_id:
        raise PermissionError("store is not bound to this session")
    target_id = _as_oid(history_id)
    rows = list(db["memory_history"].find({"session_id": session_id}).sort(_ORDER))
    cut = next((i for i, h in enumerate(rows) if h["_id"] == target_id), None)
    if cut is None:
        raise LookupError("unknown history event")

    target: dict = {}  # (ns, key) -> value before the event (None = absent)
    for h in rows[:cut]:
        target[(tuple(h["namespace"]), h["key"])] = h["value_after"]
    for h in rows[cut:]:  # keys first written at/after the event did not exist then
        target.setdefault((tuple(h["namespace"]), h["key"]), None)

    current = snapshot(db, session_id)
    diff = {"history_id": str(target_id), "added": [], "removed": [], "changed": []}
    ops = []
    for (ns, key), after in target.items():
        before = current.get((ns, key))
        if before == after:
            continue
        item = {"namespace": list(ns), "key": key, "before": before, "after": after}
        kind = "added" if before is None else "removed" if after is None else "changed"
        diff[kind].append(item)
        ops.append(PutOp(namespace=ns, key=key, value=after))
    if preview or not ops:
        return diff

    store.raw_batch(ops)
    now = _now()
    db["memory_history"].insert_many([  # only after the restore write succeeded
        {"session_id": session_id, "namespace": list(op.namespace), "key": op.key,
         "op": "rollback", "value_before": current.get((op.namespace, op.key)),
         "value_after": op.value, "source": None, "rolled_back_to": target_id,
         "retcon_enabled": bool(store.enabled), "at": now}
        for op in ops])
    return diff
