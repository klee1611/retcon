"""Let the agent read outside content (a review, an email...) and remember from it."""
import hashlib
import json
import re
import uuid

from agent import llm

MAX_CANDIDATES = 3
_BAD = re.compile(r"[^A-Za-z0-9_-]+")


def slugify_key(raw, n: int) -> str:
    """Make a model-proposed key inert: [A-Za-z0-9_-]{1,64}, fallback note-<n>."""
    key = _BAD.sub("-", str(raw or "")).strip("-")[:64].strip("-")
    return key or f"note-{n}"


def _json_values(content: str):
    """Yield JSON lists/objects found in the text: a fenced block first, then any [ or {."""
    dec = json.JSONDecoder()
    texts = [m.group(1) for m in re.finditer(r"```(?:json)?\s*(.*?)```", content, re.DOTALL)]
    texts.append(content)
    for text in texts:
        try:
            v = json.loads(text.strip())
            if isinstance(v, (list, dict)):
                yield v
        except ValueError:
            pass
        for m in re.finditer(r"[\[{]", text):
            try:
                v, _ = dec.raw_decode(text, m.start())
            except ValueError:
                continue
            if isinstance(v, (list, dict)):
                yield v


def _parse(content) -> list[dict]:
    if not isinstance(content, str):
        return []
    data = next(_json_values(content), [])
    if isinstance(data, dict):
        data = data.get("memories", data.get("candidates", [data] if "text" in data else []))
    if not isinstance(data, list):
        return []
    return [d for d in data if isinstance(d, dict) and isinstance(d.get("text"), str)
            and d["text"].strip()]


def _prompt(existing: list[str], kind: str, text: str) -> list[tuple[str, str]]:
    keys = ", ".join(existing) or "(none)"
    system = (
        "You maintain long-term memory for an assistant. Read the content below and extract "
        f"at most {MAX_CANDIDATES} factual observations about the product or the customer "
        "that are worth remembering. Reply with "
        'only a JSON array like [{"key": "short_snake_case_key", "text": "the fact"}], or [] '
        f"if there is nothing worth remembering.\nExisting preference keys: {keys}.\n"
        "If a fact updates an existing preference, reuse that exact key so it is replaced; "
        "otherwise choose a new short key.")
    return [("system", system), ("human", f"Content ({kind}):\n{text}")]


def ingest(db, store, scenario, session_id: str, kind: str, text: str) -> dict:
    if store.session_id != session_id:
        raise PermissionError("store is not bound to this session")
    if kind not in {k.kind for k in scenario.source_kinds}:
        raise ValueError(f"unknown source kind {kind!r}")
    existing = sorted(d["key"].lower() for d in db["memories"].find(
        {"namespace": [session_id, "preferences"], "value.status": "active"}, {"key": 1}))
    msg = llm.call(db, session_id, _prompt(existing, kind, text))  # raises before any write

    source = {"type": kind, "id": hashlib.sha256(text.encode()).hexdigest()[:12]}
    nonce = uuid.uuid4().hex
    candidates = []
    for n, raw in enumerate(_parse(msg.content)[:MAX_CANDIDATES], 1):
        key, body = slugify_key(raw.get("key"), n).lower(), raw["text"].strip()[:500]
        # An existing preference key is the poisoning path (stays in preferences, where
        # untrusted writes are blocked); anything new goes to notes and gets the full checks.
        ns = (session_id, "preferences" if key in existing else "notes")
        ingest_id = f"{nonce}:{n}"  # unique per call and candidate; outcomes are matched by it
        store.put(ns, key, {"text": body, "source": {**source, "ingest_id": ingest_id},
                            "readable_by": [session_id], "status": "active"})
        base = {"key": key, "text": body}
        h = db["memory_history"].find_one(
            {"session_id": session_id, "key": key, "op": "put",
             "source.ingest_id": ingest_id})
        if h:
            candidates.append({**base, "outcome": "stored", "history_id": str(h["_id"])})
            continue
        q = db["quarantine"].find_one(
            {"session_id": session_id, "key": key, "source.ingest_id": ingest_id})
        if q:
            candidates.append({**base, "outcome": "quarantined",
                               "quarantine_id": str(q["_id"]), "rule": q["rule"],
                               "reason": q["reason"]})
        else:  # never drop a candidate silently
            candidates.append({**base, "outcome": "quarantined", "rule": "fail_closed",
                               "reason": "the outcome of this write could not be determined"})
    return {"candidates": candidates}


__all__ = ["ingest", "slugify_key"]
