import { useCallback, useEffect, useReducer, useRef } from "react"

import {
  ApiError,
  type Action,
  type IngestCandidate,
  type MemoryUsed,
  type RollbackResponse,
  type Scenario,
  type State,
} from "@/lib/api"
import { loadBackend, useBackendOverride, type Backend } from "@/lib/backend"
import { describeError, toApiError, type EndedReason } from "./errors"

export type ChatMessage =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; memories: MemoryUsed[]; actions: Action[] }

export type Busy = null | "chat" | "ingest" | "toggle" | "rollback" | "quarantine"

export type PlayState = {
  phase: "loading" | "ready" | "ended" | "unknown_scenario" | "failed"
  endedReason: EndedReason | null
  fatalText: string | null
  scenario: Scenario | null
  state: State | null
  transcript: ChatMessage[]
  pending: string | null
  usedKeys: string[]
  turn: number
  ingestResults: IngestCandidate[] | null
  busy: Busy
  banner: string | null
  notice: string | null
  nextId: number
}

const initial: PlayState = {
  phase: "loading",
  endedReason: null,
  fatalText: null,
  scenario: null,
  state: null,
  transcript: [],
  pending: null,
  usedKeys: [],
  turn: 0,
  ingestResults: null,
  busy: null,
  banner: null,
  notice: null,
  nextId: 1,
}

type Act =
  | { type: "reset" }
  | { type: "opened"; scenario: Scenario; state: State }
  | { type: "state"; state: State }
  | { type: "busy"; busy: Busy; pending?: string | null }
  | { type: "chat"; user: string; reply: string; memories: MemoryUsed[]; actions: Action[]; state: State }
  | { type: "ingest"; results: IngestCandidate[]; state: State }
  | { type: "error"; view: ReturnType<typeof describeError> }
  | { type: "failed"; text: string }
  | { type: "clearNotice" }

function reducer(s: PlayState, a: Act): PlayState {
  switch (a.type) {
    case "reset":
      return { ...initial }
    case "opened":
      return { ...initial, phase: "ready", scenario: a.scenario, state: a.state }
    case "state":
      // Memories may have changed (rollback, release, toggle), so the "used in
      // last reply" highlight would point at values the reply never saw.
      return { ...s, state: a.state, busy: null, banner: null, notice: null, usedKeys: [] }
    case "busy":
      return { ...s, busy: a.busy, pending: a.pending ?? null, notice: null }
    case "chat": {
      const id = s.nextId
      return {
        ...s,
        state: a.state,
        busy: null,
        pending: null,
        banner: null,
        notice: null,
        turn: s.turn + 1,
        usedKeys: a.memories.map((m) => m.key),
        nextId: id + 2,
        transcript: [
          ...s.transcript,
          { id, role: "user", text: a.user },
          { id: id + 1, role: "assistant", text: a.reply, memories: a.memories, actions: a.actions },
        ],
      }
    }
    case "ingest":
      return { ...s, state: a.state, busy: null, banner: null, notice: null, ingestResults: a.results, usedKeys: [] }
    case "error": {
      const base = { ...s, busy: null, pending: null }
      const v = a.view
      if (v.kind === "ended") return { ...base, phase: "ended", endedReason: v.reason }
      if (v.kind === "unknown_scenario") return { ...base, phase: "unknown_scenario" }
      if (v.kind === "banner") return { ...base, banner: v.text }
      return { ...base, notice: v.text }
    }
    case "failed":
      return { ...initial, phase: "failed", fatalText: a.text }
    case "clearNotice":
      return { ...s, notice: null, banner: null }
  }
}

/** One in-flight/created session per backend and scenario, so remounts (and StrictMode) reuse it. */
const sessions = new WeakMap<Backend, Map<string, Promise<{ scenario: Scenario; state: State }>>>()

async function create(b: Backend, scenarioId: string) {
  const [created, list] = await Promise.all([b.createSession(scenarioId), b.listScenarios()])
  const scenario = list.find((x) => x.id === scenarioId)
  if (!scenario || !scenario.available) {
    throw new ApiError(400, "unknown_scenario", "That scenario does not exist yet.")
  }
  return { scenario, state: created.state }
}

function open(b: Backend, scenarioId: string, fresh: boolean) {
  let map = sessions.get(b)
  if (!map) sessions.set(b, (map = new Map()))
  const known = map.get(scenarioId)
  const make = () => {
    const p = create(b, scenarioId)
    map.set(scenarioId, p)
    p.catch(() => map.delete(scenarioId))
    return p
  }
  if (fresh || !known) return make()
  return known.then(
    async (k) => {
      try {
        const [r, list] = await Promise.all([b.getSession(k.state.session_id), b.listScenarios()])
        return { scenario: list.find((x) => x.id === scenarioId) ?? k.scenario, state: r.state }
      } catch (e) {
        if (toApiError(e).code === "session_not_found") return make()
        throw e
      }
    },
    () => make(),
  )
}

export function usePlayground(scenarioId: string) {
  const override = useBackendOverride()
  const [ps, dispatch] = useReducer(reducer, initial)
  const backendRef = useRef<Backend | null>(override)
  const runId = useRef(0)
  const previews = useRef(new Map<string, Promise<{ ok: true; diff: RollbackResponse["diff"] } | { ok: false; message: string }>>())

  const start = useCallback(
    async (fresh: boolean) => {
      const id = ++runId.current
      dispatch({ type: "reset" })
      try {
        const b = override ?? (await loadBackend())
        backendRef.current = b
        const r = await open(b, scenarioId, fresh)
        if (id === runId.current) dispatch({ type: "opened", scenario: r.scenario, state: r.state })
      } catch (e) {
        if (id !== runId.current) return
        const view = describeError(toApiError(e))
        if (view.kind === "unknown_scenario") dispatch({ type: "error", view })
        else if (view.kind === "ended") dispatch({ type: "failed", text: "Could not start a session." })
        else dispatch({ type: "failed", text: view.text })
      }
    },
    [override, scenarioId],
  )

  useEffect(() => {
    void start(false)
    return () => {
      runId.current += 1
    }
  }, [start])

  const sid = ps.state?.session_id ?? null

  /** Runs a request; on failure maps the error, and refreshes state when it may be stale. */
  const guard = useCallback(
    async <T,>(busy: Exclude<Busy, null>, call: (b: Backend, sid: string) => Promise<T>, pending?: string) => {
      const b = backendRef.current
      if (!b || !sid) return { ok: false as const, message: "No active session." }
      dispatch({ type: "busy", busy, pending })
      try {
        return { ok: true as const, value: await call(b, sid) }
      } catch (e) {
        const view = describeError(toApiError(e))
        dispatch({ type: "error", view })
        if (view.kind === "notice" && view.refresh) {
          try {
            dispatch({ type: "state", state: (await b.getSession(sid)).state })
            dispatch({ type: "error", view })
          } catch {
            /* keep the notice */
          }
        }
        return { ok: false as const, message: view.kind === "ended" || view.kind === "unknown_scenario" ? "" : view.text }
      }
    },
    [sid],
  )

  const sendChat = useCallback(
    async (text: string) => {
      const r = await guard("chat", (b, id) => b.chat(id, text), text)
      if (!r.ok) return false
      const { turn, state } = r.value
      dispatch({ type: "chat", user: text, reply: turn.reply, memories: turn.memories_used, actions: turn.actions, state })
      return true
    },
    [guard],
  )

  const sendIngest = useCallback(
    async (kind: string, text: string) => {
      const r = await guard("ingest", (b, id) => b.ingest(id, kind, text))
      if (!r.ok) return false
      dispatch({ type: "ingest", results: r.value.ingest.candidates, state: r.value.state })
      return true
    },
    [guard],
  )

  const setRetcon = useCallback(
    async (enabled: boolean) => {
      const r = await guard("toggle", (b, id) => b.toggle(id, enabled))
      if (r.ok) dispatch({ type: "state", state: r.value.state })
    },
    [guard],
  )

  const quarantineAction = useCallback(
    async (qid: string, kind: "release" | "discard") => {
      const r = await guard("quarantine", (b, id) =>
        kind === "release" ? b.releaseQuarantine(id, qid) : b.discardQuarantine(id, qid),
      )
      if (r.ok) dispatch({ type: "state", state: r.value.state })
    },
    [guard],
  )

  const previewRollback = useCallback(
    async (historyId: string): Promise<{ ok: true; diff: RollbackResponse["diff"] } | { ok: false; message: string }> => {
      // One preview request per history event at a time: duplicates (StrictMode, re-opens) share it.
      const known = previews.current.get(historyId)
      if (known) return known
      const p = (async () => {
        const r = await guard("rollback", (b, id) => b.rollback(id, historyId, true))
        if (!r.ok) return r
        dispatch({ type: "state", state: r.value.state })
        return { ok: true as const, diff: r.value.diff }
      })().finally(() => previews.current.delete(historyId))
      previews.current.set(historyId, p)
      return p
    },
    [guard],
  )

  const confirmRollback = useCallback(
    async (historyId: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const r = await guard("rollback", (b, id) => b.rollback(id, historyId, false))
      if (!r.ok) return r
      dispatch({ type: "state", state: r.value.state })
      return { ok: true }
    },
    [guard],
  )

  return {
    ps,
    restart: () => start(true),
    retry: () => start(false),
    dismiss: () => dispatch({ type: "clearNotice" }),
    sendChat,
    sendIngest,
    setRetcon,
    quarantineAction,
    previewRollback,
    confirmRollback,
  }
}
