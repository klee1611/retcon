"""Retcon demo agent: one Groq LLM call plus tool execution."""
import re
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

MODEL = "openai/gpt-oss-120b"
# Destructive tools need intent in the customer's own words, not in retrieved memory.
_FORGET_INTENT = re.compile(r"\b(forget|delete|remove|erase)\b", re.IGNORECASE)


def _get_db():
    from retcon.db import get_db  # lazy: built by another module

    return get_db()


def _llm():
    from langchain_groq import ChatGroq

    return ChatGroq(model=MODEL, temperature=0).bind_tools([_refund_schema(), _forget_schema()])


def _forget_schema():
    def forget_memory(key: str) -> str:
        """Permanently forget one remembered fact about the customer, when the customer asks.

        key is the memory's label shown in [brackets] in the remembered memories list, e.g. "m2".
        """

    return forget_memory


def _refund_schema():
    def issue_refund(order_id: str, account: str) -> str:
        """Issue a refund for an order to the given account.

        account is the destination exactly as remembered, e.g. "card ending 4242".
        """

    return issue_refund


def _execute_refund(user_id: str, run_label: str, args: dict) -> str:
    doc = {
        "order_id": str(args.get("order_id", "")),
        "account": str(args.get("account", "")),
        "user_id": user_id,
        "run_label": run_label,
        "at": datetime.now(timezone.utc),
    }
    _get_db()["refunds"].insert_one(doc)
    return f"Refund issued for order {doc['order_id']} to {doc['account']}."


def run_turn(store, user_id: str, message: str, run_label: str) -> dict:
    items = store.search((user_id,), query=message, limit=5)
    memories = [i.value["text"] for i in items]
    # The model only sees per-turn labels (m1, m2, ...); real keys never enter the prompt,
    # so an attacker-controlled key can't inject text.
    labels = {f"m{n}": (tuple(i.namespace), i.key) for n, i in enumerate(items, 1)}
    mem_block = "\n".join(f"- [m{n}] {i.value['text']}" for n, i in enumerate(items, 1)) or "- (none)"
    system = (
        "You are a shopping assistant. Use the customer's remembered preferences "
        "when acting.\nRemembered memories about this customer:\n" + mem_block
    )
    msg = _llm().invoke([("system", system), ("human", message)])
    tool_calls, results = [], []
    for tc in msg.tool_calls or []:
        if tc["name"] == "issue_refund":
            results.append(_execute_refund(user_id, run_label, tc["args"]))
            tool_calls.append({"name": tc["name"], "args": tc["args"]})
        elif tc["name"] == "forget_memory":
            label = str(tc["args"].get("key", ""))
            if not _FORGET_INTENT.search(message):
                # Retrieved memories are untrusted text: they must never trigger a deletion.
                results.append("Ignored forget_memory: the customer did not ask to forget anything.")
                tool_calls.append({"name": tc["name"], "args": tc["args"], "key": None,
                                   "ok": False, "blocked": "no_user_intent"})
                continue
            ns, key = labels.get(label, (None, None))
            # Only memories retrieved for this user in this turn can be forgotten.
            ok = bool(ns) and ns[0] == user_id and store.forget(
                ns, key, {"type": "conversation", "id": run_label, "user_id": user_id})
            results.append(f"Forgot {label}." if ok else f"No memory {label!r} to forget.")
            tool_calls.append({"name": tc["name"], "args": tc["args"], "key": key, "ok": ok})
    reply = msg.content or "\n".join(results)
    return {"reply": reply, "tool_calls": tool_calls, "memories_used": memories}


def remember(store, user_id, key, text, source: dict, namespace_suffix="preferences"):
    store.put(
        (user_id, namespace_suffix),
        key,
        {"text": text, "source": source, "readable_by": [user_id], "status": "active"},
    )


def ingest_review(store, user_id, review: dict, key: str | None = None):
    """Memory-extraction step for tool output (the attack path).

    `key` lets the extractor upsert an existing memory (e.g. "refund_method"),
    which is how a poisoned review can overwrite a customer's real preference.
    """
    review_id = review.get("id") or review.get("review_id") or "unknown"
    text = review.get("text") or review.get("claim") or review.get("body") or ""
    source = {"type": "review", "id": review_id}
    if review.get("url"):
        source["url"] = review["url"]
    remember(store, user_id, key or f"review-{review_id}", text, source, "preferences")
