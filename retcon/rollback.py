"""Snapshot and time-travel rollback driven by memory_history."""
from datetime import UTC, datetime

from langgraph.store.base import PutOp

from retcon.store import _now


def snapshot(db) -> dict:
    """Current active memories as {(namespace tuple, key): value}."""
    return {
        (tuple(d["namespace"]), d["key"]): d["value"]
        for d in db["memories"].find({"value.status": "active"})
    }


def rollback_to(db, store, at: datetime, user_id: str | None = None) -> dict:
    """Restore memories to their state at `at`. Returns {added, removed, changed}.

    If `user_id` is given, only namespaces whose first element equals it are touched.
    """
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    target: dict = {}  # (ns, key) -> value at `at` (None = absent)
    def mine(h):
        return user_id is None or (h["namespace"] and h["namespace"][0] == user_id)

    for h in db["memory_history"].find({"at": {"$lte": at}}).sort([("at", 1), ("_id", 1)]):
        if mine(h):
            target[(tuple(h["namespace"]), h["key"])] = h["value_after"]
    # keys first written after `at` have no entry above: they did not exist then
    for h in db["memory_history"].find({"at": {"$gt": at}}):
        if mine(h):
            target.setdefault((tuple(h["namespace"]), h["key"]), None)

    current = snapshot(db)
    diff = {"added": [], "removed": [], "changed": []}
    ops, rows = [], []
    for (ns, key), after in target.items():
        before = current.get((ns, key))
        if before == after:
            continue
        item = {"namespace": list(ns), "key": key, "before": before, "after": after}
        if before is None:
            diff["added"].append(item)
        elif after is None:
            diff["removed"].append(item)
        else:
            diff["changed"].append(item)
        ops.append(PutOp(namespace=ns, key=key, value=after))
        rows.append({
            "namespace": list(ns), "key": key, "op": "rollback",
            "value_before": before, "value_after": after, "source": None})
    if ops:
        store.raw_batch(ops)
        for r in rows:  # only after the restore write succeeded
            r["at"] = _now()
            db["memory_history"].insert_one(r)
    return diff
