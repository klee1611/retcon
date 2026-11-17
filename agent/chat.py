"""One chat turn: retrieve memories, one LLM call, execute tools, judge actions."""
import re
from datetime import UTC, datetime

from agent import llm
from agent.session import user_memories
from retcon.state import action_view, is_tainted

# Destructive tools need intent in the customer's own words, not in retrieved memory.
_FORGET_INTENT = re.compile(r"\b(forget|delete|remove|erase)\b", re.IGNORECASE)


def forget_memory(key: str) -> str:
    """Permanently forget one remembered fact about the user, only when the user asks.

    key is the memory's label shown in [brackets] in the remembered memories list, e.g. "m2".
    """
    raise NotImplementedError("schema only; run_turn handles the call")


def run_turn(db, store, scenario, session_id: str, message: str) -> dict:
    items = store.search((session_id,), query=message, limit=5)
    # The model only sees per-turn labels (m1, m2, ...); real keys never enter the prompt,
    # so an attacker-controlled key cannot inject text.
    labels = {f"m{n}": i for n, i in enumerate(items, 1)}
    block = "\n".join(f"- [{lab}] {i.value['text']}" for lab, i in labels.items()) or "- (none)"
    system = f"{scenario.system_prompt}\n\nRemembered memories about this user:\n{block}"
    msg = llm.call(db, session_id, [("system", system), ("human", message)],
                   [*scenario.tools(), forget_memory])  # raises LLMUnavailable: nothing written yet

    tool_names = {t.__name__ for t in scenario.tools()}
    actions, notes = [], []
    for tc in msg.tool_calls or []:
        name, args = tc["name"], tc.get("args") or {}
        if name in tool_names:
            result = scenario.execute(name, args)
            verdict = scenario.verdict(name, result.params, user_memories(db, session_id))
            doc = {"session_id": session_id, "type": name, "params": result.params,
                   "summary": result.summary, "retcon_enabled": store.enabled,
                   "verdict": {"result": verdict.result, "reason": verdict.reason},
                   "created_at": datetime.now(UTC)}
            doc["_id"] = db["actions"].insert_one(doc).inserted_id
            actions.append(action_view(doc))
            notes.append(result.reply_hint)
        elif name == "forget_memory":
            label = str(args.get("key", ""))
            item = labels.get(label)
            if not _FORGET_INTENT.search(message):
                # Retrieved memories are untrusted text: they must never trigger a deletion.
                notes.append("I did not forget anything: you did not ask me to.")
            elif item is None or not store.forget(
                    tuple(item.namespace), item.key,
                    {"type": "conversation", "id": f"chat-{session_id}"}):
                notes.append(f"I could not find a memory {label!r} to forget.")
            else:
                notes.append(f"Forgot {label}.")

    memories_used = [{"key": i.key, "text": i.value["text"], "source": i.value.get("source"),
                      "tainted": is_tainted(i.value.get("source"))} for i in items]
    reply = msg.content if isinstance(msg.content, str) and msg.content.strip() else "\n".join(notes)
    return {"reply": reply, "memories_used": memories_used, "actions": actions}
