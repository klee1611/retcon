"""One chat turn: retrieve memories, one LLM call, execute tools, judge actions."""
import re
from datetime import UTC, datetime

from agent import llm
from agent.session import user_memories
from retcon.state import action_view, is_external, is_tainted

# Destructive tools need intent in the customer's own words, not in retrieved memory.
_FORGET_INTENT = re.compile(r"\b(forget|delete|remove|erase)\b", re.IGNORECASE)
# "don't forget to ..." is a reminder, not a request to delete anything.
_NEGATED_FORGET = re.compile(r"\b(don'?t|do\s+not|never|not)\s+(to\s+)?forget\b", re.IGNORECASE)
MAX_TOOL_CALLS = 3
FALLBACK_REPLY = "I couldn't complete that request."


def _has_forget_intent(message: str) -> bool:
    return bool(_FORGET_INTENT.search(_NEGATED_FORGET.sub(" ", message)))


def _names_memory(message: str, key: str) -> bool:
    """The user's message mentions the memory: its key as words, or a >=4-letter word of it."""
    text = message.lower()
    phrase = re.sub(r"[_-]+", " ", key.lower()).strip()
    if phrase and phrase in text:
        return True
    words = {w for w in re.findall(r"[a-z]+", phrase) if len(w) >= 4}
    return any(re.search(rf"\b{re.escape(w)}\b", text) for w in words)


def forget_memory(key: str) -> str:
    """Permanently forget one remembered fact about the user, only when the user asks.

    key is the memory's label shown in [brackets] in the remembered memories list, e.g. "m2".
    """
    raise NotImplementedError("schema only; run_turn handles the call")


def run_turn(db, store, scenario, session_id: str, message: str) -> dict:
    if store.session_id != session_id:
        raise PermissionError("store is not bound to this session")
    items = store.search((session_id,), query=message, limit=5)
    # The model only sees per-turn labels (m1, m2, ...); real keys never enter the prompt,
    # so an attacker-controlled key cannot inject text.
    labels = {f"m{n}": i for n, i in enumerate(items, 1)}
    block = "\n".join(f"- [{lab}] {i.value['text']}" for lab, i in labels.items()) or "- (none)"
    system = f"{scenario.system_prompt}\n\nRemembered memories about this user:\n{block}"
    msg = llm.call(db, session_id, [("system", system), ("human", message)],
                   [*scenario.tools(), forget_memory])  # raises LLMUnavailable: nothing written yet

    tool_names = {t.__name__ for t in scenario.tools()}
    actions, notes, refused, blocked = [], [], [], []
    for tc in list(msg.tool_calls or [])[:MAX_TOOL_CALLS]:
        if not isinstance(tc, dict):
            continue
        name, args = tc.get("name"), tc.get("args")
        if not isinstance(args, dict):
            args = {}
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
            if not _has_forget_intent(message):
                # Retrieved memories are untrusted text: they must never trigger a deletion.
                blocked.append("no_user_intent")
                refused.append("I did not forget anything: you did not ask me to.")
            elif item is None or not _names_memory(message, item.key):
                if item is not None:
                    blocked.append("not_named_by_user")
                refused.append("I did not forget anything: tell me which memory to forget.")
            elif not store.forget(
                    tuple(item.namespace), item.key,
                    {"type": "conversation", "id": f"chat-{session_id}"}):
                refused.append(f"I could not find a memory {label!r} to forget.")
            else:
                notes.append(f"Forgot {label}.")

    notes.extend(refused)
    memories_used = [{"key": i.key, "text": i.value["text"], "source": i.value.get("source"),
                      "external": is_external(i.value.get("source")),
                      "tainted": is_tainted(i.value.get("source"), i.namespace)} for i in items]
    content = msg.content.strip() if isinstance(msg.content, str) else ""
    reply = content or "\n".join(notes) or FALLBACK_REPLY
    if content and refused:  # the reply must not contradict what actually happened
        reply = "\n".join([content, *refused])
    turn = {"reply": reply, "memories_used": memories_used, "actions": actions}
    if blocked:
        turn["blocked"] = blocked
    return turn
