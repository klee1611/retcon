"""The single place the LLM is created and called (tests monkeypatch `get_llm`)."""
from dotenv import load_dotenv

from retcon.state import session_llm_limit

MODEL = "openai/gpt-oss-120b"


class LLMUnavailable(Exception):
    """The LLM call failed (timeout, rate limit, missing key...). Nothing was written."""


class SessionQuotaExhausted(Exception):
    """The session used all of its LLM calls (env SESSION_LLM_CALLS)."""


def get_llm():
    from langchain_groq import ChatGroq

    load_dotenv()
    return ChatGroq(model=MODEL, temperature=0, timeout=20)


def count_call(db, session_id: str) -> None:
    """Atomically take one call from the session's quota, or raise SessionQuotaExhausted."""
    res = db["sessions"].update_one(
        {"_id": session_id, "llm_calls_used": {"$lt": session_llm_limit()}},
        {"$inc": {"llm_calls_used": 1}})
    if res.matched_count == 0:
        raise SessionQuotaExhausted(session_id)


def call(db, session_id: str, messages, tools=None):
    """One counted LLM call. Any failure becomes LLMUnavailable."""
    count_call(db, session_id)
    try:
        model = get_llm()
        if tools:
            model = model.bind_tools(tools)
        return model.invoke(messages)
    except Exception as e:
        raise LLMUnavailable(f"{type(e).__name__}: {e}") from e
