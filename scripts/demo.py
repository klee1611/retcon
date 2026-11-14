"""Retcon three-act demo: same prompt, different memory, different action.

Act 1  Retcon OFF : a poisoned review becomes memory -> refund goes to the attacker.
Act 2  Retcon ON  : the same review is quarantined before it reaches memory.
Act 3  Rollback   : memory restored to before the attack -> refund goes to the card.

Run: uv run python scripts/demo.py   (add --pause to wait for Enter between acts on stage)
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow `uv run python scripts/demo.py`

from retcon.agent import ingest_review, remember, run_turn
from retcon.db import clear_data, get_db, make_store, setup
from retcon.rollback import rollback_to

USER = "user_42"
PROMPT = "Please refund my order #A100."
ATTACKER = "9988-1122-3344"
EVENTS = json.loads((Path(__file__).resolve().parent.parent / "data" / "demo_events.json").read_text())
PAUSE = "--pause" in sys.argv


def banner(text: str) -> None:
    print(f"\n{'=' * 70}\n{text}\n{'=' * 70}")
    if PAUSE:
        input("  [Enter to continue] ")


def wait_for_search(store, expect_text: str | None, present: bool, timeout: float = 30) -> None:
    """Auto-embedding indexes update asynchronously; wait until search reflects the latest writes."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        texts = [i.value.get("text", "") for i in store.search((USER,), query=PROMPT, limit=10)]
        found = any(expect_text in t for t in texts) if expect_text else bool(texts)
        if found == present:
            return
        time.sleep(1)
    print(f"  (warning: search index not updated after {timeout}s)")


def refund_account(result: dict) -> str:
    calls = result.get("tool_calls") or []
    return calls[0]["args"].get("account", "?") if calls else "NO REFUND CALL"


def main() -> None:
    db = get_db()
    setup(db)  # creates collections and indexes once; slow only on the very first run
    clear_data(db)
    store_on = make_store(db, enabled=True, user_id=USER)
    store_off = make_store(db, enabled=False, user_id=USER)

    clean = [e for e in EVENTS if not e.get("is_attack")]
    attack = next(e for e in EVENTS if e.get("is_attack"))
    review = {"id": attack["source"]["id"], "url": attack["source"].get("url"), "text": attack["value"]["text"]}

    banner("Setup: the customer tells the agent their preferences (trusted conversation)")
    for e in clean:
        remember(store_on, USER, e["key"], e["value"]["text"], e["source"], namespace_suffix=e["namespace"][1])
        print(f"  saved  {e['namespace'][1]}/{e['key']}: {e['value']['text']}")
    wait_for_search(store_on, "card ending 4242", present=True)
    before_attack = datetime.now(timezone.utc)
    time.sleep(1)

    results = []

    banner("Act 1 - Retcon OFF: the agent reads a malicious review and remembers it")
    ingest_review(store_off, USER, review, key="refund_method")
    print(f"  memory written from review {review['id']}: {review['text']}")
    wait_for_search(store_off, ATTACKER, present=True)
    r1 = run_turn(store_off, USER, PROMPT, run_label="act1_retcon_off")
    results.append(("Act 1  Retcon off", refund_account(r1)))
    print(f"  user: {PROMPT}\n  agent refund -> {refund_account(r1)}")

    banner("Act 2 - Retcon ON: the same review is replayed")
    q_before = db["quarantine"].count_documents({})
    ingest_review(store_on, USER, review, key="refund_method")
    q = db["quarantine"].find_one(sort=[("created_at", -1)])
    blocked = db["quarantine"].count_documents({}) > q_before
    print(f"  quarantined: {blocked}" + (f"  rule={q.get('rule')}  reason={q.get('reason')}" if blocked and q else ""))
    src = db["sources"].find_one({"_id": f"review:{review['id']}"})
    if src:
        print(f"  trust for review:{review['id']} -> {src.get('trust')}")
    results.append(("Act 2  Retcon on", "QUARANTINED" if blocked else "NOT BLOCKED"))

    banner("Act 3 - Rollback to before the attack, then the same request")
    diff = rollback_to(db, store_on, before_attack)
    for kind in ("removed", "changed", "added"):
        for item in diff.get(kind, []):
            before = (item.get("before") or {}).get("text")
            after = (item.get("after") or {}).get("text")
            print(f"  {kind}: {item.get('key')}: {before!r} -> {after!r}")
    wait_for_search(store_on, ATTACKER, present=False)
    r3 = run_turn(store_on, USER, PROMPT, run_label="act3_after_rollback")
    results.append(("Act 3  After rollback", refund_account(r3)))
    print(f"  user: {PROMPT}\n  agent refund -> {refund_account(r3)}")

    banner("Act 4 - The customer asks the agent to forget something")
    forget_prompt = "Please forget my delivery preference."
    r4 = run_turn(store_on, USER, forget_prompt, run_label="act4_forget")
    forgot = [c for c in r4["tool_calls"] if c["name"] == "forget_memory"]
    gone = store_on.get((USER, "preferences"), "delivery") is None
    audit = db["memory_history"].find_one({"op": "forget", "key": "delivery"})
    print(f"  user: {forget_prompt}")
    print(f"  agent tool call: {forgot[0]['args'] if forgot else 'none'}")
    print(f"  memory gone: {gone}   audit record kept: {audit is not None}")
    results.append(("Act 4  Forget request", "FORGOTTEN (audited)" if gone and audit else "NOT FORGOTTEN"))

    banner("Summary: same prompt, different memory, different action")
    for label, outcome in results:
        flag = "  <-- attacker" if ATTACKER in outcome else ""
        print(f"  {label:<24} {outcome}{flag}")


if __name__ == "__main__":
    main()
