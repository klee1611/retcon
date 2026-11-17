"""Build the API's `State` object (docs/06-interfaces.md) for one session."""
from datetime import UTC, datetime, timedelta

from retcon.db import SESSION_TTL_SECONDS
from retcon.store import TRUST_START, TRUSTED_TYPES

LLM_CALLS_LIMIT = 30
TIMELINE_LIMIT = 100


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _value(v: dict | None) -> dict | None:
    if not v:
        return None
    return {"text": v.get("text", ""), "source": v.get("source") or {"type": "unknown", "id": "unknown"}}


def is_tainted(source: dict | None) -> bool:
    return (source or {}).get("type") not in TRUSTED_TYPES


def action_view(doc: dict) -> dict:
    return {"action_id": str(doc["_id"]), "at": iso(doc["created_at"]), "type": doc["type"],
            "params": doc["params"], "summary": doc["summary"],
            "retcon_enabled": doc["retcon_enabled"], "verdict": doc["verdict"]}


def session_state(db, session_doc: dict) -> dict:
    sid = session_doc["_id"]
    prefix = f"{sid}|"
    created = session_doc["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)

    trust = {d["_id"]: d["trust"] for d in db["sources"].find({"session_id": sid})}
    memories = []
    for d in db["memories"].find({"namespace.0": sid, "value.status": "active"}):
        v = d["value"]
        src = v.get("source") or {"type": "unknown", "id": "unknown"}
        t = trust.get(f"{prefix}{src.get('type')}:{src.get('id')}", TRUST_START)
        at = d.get("updated_at") or d.get("created_at") or created
        memories.append({"key": d["key"], "text": v.get("text", ""), "source": src,
                         "trust": t, "tainted": is_tainted(src), "updated_at": iso(at)})
    memories.sort(key=lambda m: m["key"])

    timeline = [{
        "history_id": str(h["_id"]), "at": iso(h["at"]), "op": h["op"], "key": h["key"],
        "before": _value(h.get("value_before")), "after": _value(h.get("value_after")),
        "source": h.get("source"), "retcon_enabled": h.get("retcon_enabled", True),
    } for h in db["memory_history"].find({"session_id": sid})
        .sort([("at", -1), ("_id", -1)]).limit(TIMELINE_LIMIT)]

    quarantine = [{
        "quarantine_id": str(q["_id"]), "at": iso(q["created_at"]), "key": q["key"],
        "text": q["value"].get("text", ""), "source": q["source"], "rule": q["rule"],
        "reason": q["reason"], "status": q["status"],
    } for q in db["quarantine"].find({"session_id": sid}).sort([("created_at", -1), ("_id", -1)])]

    actions = [action_view(a) for a in db["actions"].find({"session_id": sid})
               .sort([("created_at", -1), ("_id", -1)])]

    sources = []
    for d in db["sources"].find({"session_id": sid}):
        sid_part = d["_id"].removeprefix(prefix)
        if sid_part.startswith("type:"):  # per-type aggregate, not a concrete source
            continue
        sources.append({"type": d.get("type", ""), "id": sid_part.split(":", 1)[-1],
                        "trust": d["trust"], "blocked": d.get("blocked", 0),
                        "clean": d.get("clean", 0)})
    sources.sort(key=lambda s: (s["type"], s["id"]))

    return {
        "session_id": sid, "scenario": session_doc["scenario"],
        "retcon_enabled": session_doc["retcon_enabled"],
        "created_at": iso(created),
        "expires_at": iso(created + timedelta(seconds=SESSION_TTL_SECONDS)),
        "usage": {"llm_calls_used": session_doc.get("llm_calls_used", 0),
                  "llm_calls_limit": LLM_CALLS_LIMIT},
        "memories": memories, "timeline": timeline, "quarantine": quarantine,
        "actions": actions, "sources": sources,
    }
