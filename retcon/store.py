"""RetconStore: MongoDBStore subclass that checks, quarantines, and records writes.

Every memory belongs to one session: the first namespace element is the
session id. A store bound to a session (``for_session``) can only read and
write that session's namespaces, and every bookkeeping document it writes
(history, quarantine, sources) carries ``session_id`` so it can be scoped
and expired.
"""
import copy
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime

from langgraph.store.base import GetOp, Item, ListNamespacesOp, PutOp, SearchOp
from langgraph.store.mongodb import MongoDBStore
from pymongo_search_utils.pipeline import autoembedding_vector_search_stage

from retcon.db import ATTACK_INDEX, EMBED_MODEL

TRUSTED_TYPES = {"conversation", "system"}  # anything else, incl. "unknown", is untrusted
SIMILARITY_THRESHOLD = 0.78   # tuned: poison 0.87, reworded attack 0.80, benign untrusted <=0.71
LOW_TRUST = 40
CHECK_TIMEOUT = 5.0           # seconds; exceeded -> fail_closed
TRUST_START, TRUST_BLOCK_PENALTY = 50, 30

_INSTRUCTION_RE = re.compile(
    r"\b(always|never|send|ignore|transfer|must|forward|redirect|wire|reroute|override|disregard|instead)\b",
    re.IGNORECASE,
)
_ACCOUNT_RE = re.compile(r"\b\d{4}[-\s]\d{4}[-\s]\d{4}\b|\b\d{9,}\b")
UNKNOWN_SOURCE = {"type": "unknown", "id": "unknown"}
# Keys may come from untrusted input (e.g. a review id), so keep them inert.
_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_pool = ThreadPoolExecutor(max_workers=4)


@dataclass
class Decision:
    allowed: bool
    rule: str = ""
    reason: str = ""


def _now() -> datetime:
    return datetime.now(UTC)


def source_key(source: dict) -> str:
    return f"{source.get('type')}:{source.get('id')}"


def type_key(source: dict) -> str:
    return f"type:{source.get('type')}"


_META_FIELDS = {"source", "readable_by", "status"}


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            yield from _strings(v)


def _all_text(value: dict) -> str:
    """Every string in the value (keys and leaves) except metadata fields."""
    return "\n".join(_strings({k: v for k, v in value.items() if k not in _META_FIELDS}))


class RetconStore(MongoDBStore):
    def __init__(self, collection, *, db, enabled=True, session_id=None, **kwargs):
        super().__init__(collection, **kwargs)
        self.db = db
        self.enabled = enabled
        self.session_id = session_id

    def for_session(self, session_id: str, *, enabled: bool) -> "RetconStore":
        """A cheap view of this store bound to one session.

        MongoDBStore.__init__ makes several round trips (index checks), so a
        process builds one base store and hands out shallow copies per request.
        """
        if self.session_id is not None:
            raise PermissionError("store is already bound to a session")
        if not isinstance(session_id, str) or not _KEY_RE.fullmatch(session_id):
            raise ValueError("session_id must match [A-Za-z0-9_-]{1,64}")
        view = copy.copy(self)
        view.session_id = session_id
        view.enabled = enabled
        return view

    # ---- session scoping ---------------------------------------------
    def _in_session(self, namespace) -> bool:
        return self.session_id is None or (
            bool(namespace) and namespace[0] == self.session_id)

    def _sid(self, namespace) -> str | None:
        return self.session_id or (namespace[0] if namespace else None)

    def _source_ids(self, source: dict) -> list[str]:
        """Trust is tracked per session, so one visitor can't poison another's."""
        prefix = f"{self.session_id}|" if self.session_id else ""
        return [prefix + source_key(source), prefix + type_key(source)]

    # ---- checks -------------------------------------------------------
    def trust(self, source: dict) -> int:
        ids = self._source_ids(source)
        found = {d["_id"]: d["trust"]
                 for d in self.db["sources"].find({"_id": {"$in": ids}})}
        return min(found.get(i, TRUST_START) for i in ids)

    def best_attack_score(self, text: str) -> float:
        stage = autoembedding_vector_search_stage(
            query=text, search_field="text", index_name=ATTACK_INDEX,
            model=EMBED_MODEL, top_k=1,
        )
        pipe = [stage, {"$set": {"score": {"$meta": "vectorSearchScore"}}}]
        docs = list(self.db["attack_patterns"].aggregate(pipe))
        return docs[0]["score"] if docs else 0.0

    def warm_up(self) -> None:
        """Run one attack-pattern query so the first real check isn't cold."""
        try:
            self.best_attack_score("warm up")
        except Exception:  # noqa: BLE001, S110 - warm-up is best effort
            pass

    def _check(self, namespace, key, value) -> Decision:
        source, text = value["source"], _all_text(value)
        untrusted = source.get("type") not in TRUSTED_TYPES
        if untrusted and ("preferences" in namespace or _INSTRUCTION_RE.search(text)
                          or _ACCOUNT_RE.search(text)):
            return Decision(False, "source_policy",
                            f"untrusted source '{source.get('type')}' may not write "
                            "preferences or instruction-like memories")
        if untrusted or self.trust(source) < LOW_TRUST:
            score = self.best_attack_score(text)
            if score >= SIMILARITY_THRESHOLD:
                return Decision(False, "attack_pattern",
                                f"text resembles a known attack pattern (score {score:.2f})")
        return Decision(True, "ok", "")

    def check(self, namespace, key, value) -> Decision:
        try:
            if (not namespace or not isinstance(value, dict)
                    or not isinstance(value.get("text"), str)
                    or not isinstance(value.get("source"), dict)):
                return Decision(False, "invalid_input",
                                "namespace must be non-empty, source a dict, "
                                "and value must have a string 'text'")
            if not isinstance(key, str) or not _KEY_RE.fullmatch(key):
                return Decision(False, "invalid_input",
                                "key must match [A-Za-z0-9_-]{1,64}")
            return _pool.submit(self._check, tuple(namespace), key, value).result(
                timeout=CHECK_TIMEOUT)
        except BaseException as e:  # noqa: BLE001 - timeout or any error -> fail closed
            return Decision(False, "fail_closed", f"check failed: {type(e).__name__}")

    # ---- bookkeeping --------------------------------------------------
    def _current(self, namespace, key):
        doc = self.collection.find_one(
            {"namespace_str": self.sep.join(namespace), "key": key})
        return doc["value"] if doc else None

    def _history(self, namespace, key, op, before, after, source):
        return self.db["memory_history"].insert_one({
            "session_id": self._sid(namespace),
            "namespace": list(namespace), "key": key, "op": op,
            "value_before": before, "value_after": after,
            "source": source, "retcon_enabled": bool(self.enabled), "at": _now(),
        }).inserted_id

    def _update_source(self, source: dict, blocked: bool) -> None:
        """Atomically update trust for the source id and the per-type aggregate."""
        delta = -TRUST_BLOCK_PENALTY if blocked else 1
        for k in self._source_ids(source):
            self.db["sources"].update_one({"_id": k}, [{"$set": {
                "session_id": self.session_id,
                "type": source.get("type"),
                "created_at": {"$ifNull": ["$created_at", "$$NOW"]},
                "trust": {"$min": [100, {"$max": [0, {"$add": [
                    {"$ifNull": ["$trust", TRUST_START]}, delta]}]}]},
                "blocked": {"$add": [{"$ifNull": ["$blocked", 0]}, 1 if blocked else 0]},
                "clean": {"$add": [{"$ifNull": ["$clean", 0]}, 0 if blocked else 1]},
                "updated_at": _now(),
            }}], upsert=True)

    # ---- write path ---------------------------------------------------
    def batch(self, ops):
        ops = list(ops)
        for op in ops:  # all-or-nothing scope check, before any side effect
            if isinstance(op, PutOp) and not self._in_session(op.namespace):
                raise PermissionError("namespace is outside this session")
        kept, keep_flags, pending = [], [], []  # pending: history rows, written after the write
        for op in ops:
            if not isinstance(op, PutOp):
                kept.append(op); keep_flags.append(True); continue
            if op.value is None:  # delete: always passes, recorded
                pending.append((op.namespace, op.key, "delete",
                                self._current(op.namespace, op.key), None, None))
                kept.append(op); keep_flags.append(True); continue
            value = dict(op.value)
            if not isinstance(value.get("source"), dict) and "source" in value:
                bad_source = True
                source = dict(UNKNOWN_SOURCE)
            else:
                bad_source = False
                value.setdefault("source", dict(UNKNOWN_SOURCE))
                source = value["source"]
            if op.namespace:
                value.setdefault("readable_by", [op.namespace[0]])
            value.setdefault("status", "active")
            op = op._replace(value=value)
            if self.enabled:
                if bad_source or not op.namespace:
                    d = Decision(False, "invalid_input",
                                 "namespace must be non-empty and source a dict")
                else:
                    d = self.check(op.namespace, op.key, value)
                if not d.allowed:
                    self._quarantine(op, value, source, d)
                    if d.rule != "fail_closed":  # infra failures don't punish the source
                        self._update_source(source, blocked=True)
                    keep_flags.append(False)
                    continue
                self._update_source(source, blocked=False)
            pending.append((op.namespace, op.key, "put",
                            self._current(op.namespace, op.key), value, source))
            kept.append(op); keep_flags.append(True)
        inner = iter(super().batch(kept))
        results = [self._filter_result(op, next(inner)) if keep else None
                   for op, keep in zip(ops, keep_flags)]
        for row in pending:
            self._history(*row)
        return results

    def _quarantine(self, op, value, source, d: Decision) -> None:
        self.db["quarantine"].insert_one({
            "session_id": self._sid(op.namespace),
            "namespace": list(op.namespace), "key": op.key,
            "value": value, "source": source, "reason": d.reason,
            "rule": d.rule, "created_at": _now(), "status": "held"})

    def _filter_result(self, op, result):
        """Apply the read rules to GetOp/SearchOp results that came through batch()."""
        if isinstance(op, GetOp):
            return result if self._visible_item(result) else None
        if isinstance(op, SearchOp):
            return [i for i in result if self._visible_item(i)]
        if isinstance(op, ListNamespacesOp):
            return [ns for ns in result if self._in_session(ns)]
        return result

    # abatch is inherited: it runs self.batch in an executor.

    def delete(self, namespace, key):
        # MongoDBStore.delete bypasses batch, so route it through ours.
        self.batch([PutOp(namespace=namespace, key=key, value=None)])

    def forget(self, namespace, key, source: dict) -> bool:
        """Delete a memory on request and keep an audit record of who asked.

        Returns False if there was nothing to forget. Only the memory's own
        namespace owner should call this (enforced by the agent's tool).
        """
        if not self._in_session(namespace):
            return False
        before = self._current(namespace, key)
        if before is None:
            return False
        super().batch([PutOp(namespace=namespace, key=key, value=None)])
        self._history(namespace, key, "forget", before, None, source)
        return True

    def raw_batch(self, ops):
        """Underlying MongoDBStore write with no checks or history (used by rollback)."""
        ops = list(ops)
        if not all(self._in_session(op.namespace) for op in ops):
            raise PermissionError("namespace is outside this session")
        return super().batch(ops)

    # ---- read path ----------------------------------------------------
    def _visible_item(self, item: Item | None) -> bool:
        if item is None or not self._in_session(item.namespace):
            return False
        value = item.value
        if value.get("status", "active") != "active":
            return False
        return self.session_id is None or self.session_id in value.get("readable_by", [])

    def get(self, namespace, key, **kwargs):
        if not self._in_session(namespace):
            return None
        item = super().get(namespace, key, **kwargs)
        return item if self._visible_item(item) else None

    def list_namespaces(self, *, prefix=None, **kwargs):
        if self.session_id is not None:
            if prefix is None:
                prefix = (self.session_id,)
            elif not self._in_session(prefix):  # also rejects a "*" wildcard first element
                return []
        return super().list_namespaces(prefix=prefix, **kwargs)

    def search(self, namespace_prefix, /, *, limit=10, **kwargs):
        if not self._in_session(namespace_prefix):
            return []  # includes the empty prefix, which would span every session
        items = super().search(namespace_prefix, limit=limit * 5 if limit else limit,
                               **kwargs)
        items = [i for i in items if self._visible_item(i)]
        return items[:limit] if limit else items
