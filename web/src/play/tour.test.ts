import { describe, expect, it } from "vitest"

import type { State } from "@/lib/api"
import { startTour, syncTour } from "./tour"

const review = { type: "review", id: "r1" }
const baseState = (over: Partial<State> = {}): State => ({
  session_id: "s1",
  scenario: "shopping",
  retcon_enabled: true,
  created_at: "",
  expires_at: "",
  usage: { llm_calls_used: 0, llm_calls_limit: 30 },
  memories: [],
  timeline: [],
  quarantine: [],
  actions: [],
  sources: [],
  ...over,
})
const ev = (id: string, op: "put" | "rollback", source = review) => ({
  history_id: id,
  at: "",
  op,
  key: "refund_method",
  before: null,
  after: null,
  source: op === "rollback" ? null : source,
  retcon_enabled: false,
})

describe("syncTour", () => {
  it("stays on a step until its condition is met", () => {
    const s = baseState()
    const t = startTour(s)
    expect(syncTour(t, s)).toBe(t)
    expect(t.step).toBe(0)
  })

  it("skips ahead when Retcon is already off", () => {
    const s = baseState({ retcon_enabled: false })
    expect(syncTour(startTour(s), s).step).toBe(1)
  })

  it("only counts review events that are new since the step began", () => {
    const old = baseState({ retcon_enabled: false, timeline: [ev("a", "put")] })
    const t = syncTour(startTour(old), old)
    expect(t.step).toBe(1)
    expect(syncTour(t, old)).toBe(t)
    const conv = baseState({ retcon_enabled: false, timeline: [ev("b", "put", { type: "conversation", id: "c" }), ev("a", "put")] })
    expect(syncTour(t, conv).step).toBe(1)
    const next = baseState({ retcon_enabled: false, timeline: [ev("c", "put"), ev("a", "put")] })
    expect(syncTour(t, next).step).toBe(2)
  })

  it("moves through rollback, re-enable and quarantine", () => {
    let s = baseState({ retcon_enabled: false })
    let t = syncTour(startTour(s), s)
    expect(t.step).toBe(1)
    s = { ...s, timeline: [ev("a", "put")] }
    t = syncTour(t, s)
    expect(t.step).toBe(2)
    s = { ...s, actions: [{ action_id: "x" } as State["actions"][number]] }
    t = syncTour(t, s)
    expect(t.step).toBe(3)
    s = { ...s, timeline: [ev("r", "rollback"), ...s.timeline] }
    t = syncTour(t, s)
    expect(t.step).toBe(4)
    s = { ...s, retcon_enabled: true }
    t = syncTour(t, s)
    expect(t.step).toBe(5)
    s = { ...s, quarantine: [{ quarantine_id: "q" } as State["quarantine"][number]] }
    t = syncTour(t, s)
    expect(t.step).toBe(6)
    expect(syncTour(t, s)).toBe(t)
  })

  it("starts over on a new session", () => {
    const s = baseState({ retcon_enabled: false })
    const t = syncTour(startTour(s), s)
    expect(t.step).toBe(1)
    const fresh = baseState({ session_id: "s2" })
    expect(syncTour(t, fresh).step).toBe(0)
  })
})
