/** Typed client for the Retcon API. Types mirror docs/06-interfaces.md (sections 1-4). */

export type Source = { type: string; id: string; label?: string }
export type MemoryValue = { text: string; source: Source }

export type Memory = {
  key: string
  text: string
  source: Source
  trust: number
  tainted: boolean
  updated_at: string
}

export type TimelineEvent = {
  history_id: string
  at: string
  op: "put" | "delete" | "forget" | "rollback" | "release"
  key: string
  before: MemoryValue | null
  after: MemoryValue | null
  source: Source | null
  retcon_enabled: boolean
}

export type QuarantineRule = "source_policy" | "attack_pattern" | "invalid_input" | "fail_closed"

export type QuarantineItem = {
  quarantine_id: string
  at: string
  key: string
  text: string
  source: Source
  rule: QuarantineRule
  reason: string
  status: "held" | "released" | "discarded"
}

export type Action = {
  action_id: string
  at: string
  type: string
  params: Record<string, string>
  summary: string
  retcon_enabled: boolean
  verdict: { result: "hijacked" | "ok"; reason: string }
}

export type SourceTrust = { type: string; id: string; trust: number; blocked: number; clean: number }

export type State = {
  session_id: string
  scenario: string
  retcon_enabled: boolean
  created_at: string
  expires_at: string
  usage: { llm_calls_used: number; llm_calls_limit: number }
  memories: Memory[]
  timeline: TimelineEvent[]
  quarantine: QuarantineItem[]
  actions: Action[]
  sources: SourceTrust[]
}

export type Health = {
  ok: boolean
  db?: "ok" | "down"
  version?: string
  daily_quota_left?: number
  [key: string]: unknown
}

export type PresetCategory = "attack_obvious" | "attack_subtle" | "attack_disguised" | "benign"

export type Scenario = {
  id: string
  name: string
  tagline: string
  user_role: string
  agent_role: string
  available: boolean
  source_kinds: { kind: string; label: string; trusted: boolean }[]
  presets: { id: string; kind: string; category: PresetCategory; label: string; text: string }[]
  chat_suggestions: string[]
}

export type MemoryUsed = { key: string; text: string; source: Source; tainted: boolean }

export type ChatResponse = {
  turn: { reply: string; memories_used: MemoryUsed[]; actions: Action[] }
  state: State
}

export type IngestCandidate = {
  key: string
  text: string
  outcome: "stored" | "quarantined"
  history_id?: string
  quarantine_id?: string
  rule?: QuarantineRule
  reason?: string
}

export type IngestResponse = { ingest: { candidates: IngestCandidate[] }; state: State }

export type DiffEntry = { key: string; before: MemoryValue | null; after: MemoryValue | null }

export type RollbackResponse = {
  diff: { history_id: string; added: DiffEntry[]; removed: DiffEntry[]; changed: DiffEntry[] }
  applied: boolean
  state: State
}

export type StateResponse = { state: State }

export type ApiErrorCode =
  | "invalid_request"
  | "input_too_long"
  | "unknown_scenario"
  | "forbidden_origin"
  | "session_mismatch"
  | "history_event_not_found"
  | "quarantine_item_not_found"
  | "session_not_found"
  | "session_busy"
  | "unsupported_media_type"
  | "session_quota_exhausted"
  | "ip_rate_limited"
  | "llm_unavailable"
  | "daily_quota_exhausted"
  | "db_unavailable"
  | "internal"
  | "network"

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | (string & {})
  readonly retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  const err = (body as { error?: unknown } | null | undefined)?.error
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown; message?: unknown; retry_after?: unknown }
    if (typeof e.code === "string" && typeof e.message === "string") {
      return new ApiError(
        res.status,
        e.code,
        e.message,
        typeof e.retry_after === "number" ? e.retry_after : undefined,
      )
    }
  }
  return new ApiError(res.status, "internal", `Request failed with status ${res.status}`)
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", signal }
  if (method === "POST") {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body ?? {})
  }
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError(0, "network", "Could not reach the server.")
  }
  if (!res.ok) throw await parseError(res)
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(res.status, "internal", "The server returned an unreadable response.")
  }
}

const sessionPath = (sid: string) => `/api/sessions/${encodeURIComponent(sid)}`

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const data = await request<Health>("GET", "/api/health", undefined, signal)
  if (typeof data !== "object" || data === null || typeof data.ok !== "boolean") {
    throw new ApiError(200, "internal", "Health check returned an unexpected response")
  }
  return data
}

export async function listScenarios(signal?: AbortSignal): Promise<Scenario[]> {
  const data = await request<{ scenarios: Scenario[] }>("GET", "/api/scenarios", undefined, signal)
  return data.scenarios
}

export const createSession = (scenario: string) =>
  request<StateResponse>("POST", "/api/sessions", { scenario })

export const getSession = (sid: string, signal?: AbortSignal) =>
  request<StateResponse>("GET", sessionPath(sid), undefined, signal)

export const chat = (sid: string, message: string) =>
  request<ChatResponse>("POST", `${sessionPath(sid)}/chat`, { message })

export const ingest = (sid: string, kind: string, text: string) =>
  request<IngestResponse>("POST", `${sessionPath(sid)}/ingest`, { kind, text })

export const toggle = (sid: string, enabled: boolean) =>
  request<StateResponse>("POST", `${sessionPath(sid)}/toggle`, { enabled })

export const rollback = (sid: string, historyId: string, preview: boolean) =>
  request<RollbackResponse>("POST", `${sessionPath(sid)}/rollback`, {
    history_id: historyId,
    preview,
  })

export const releaseQuarantine = (sid: string, qid: string) =>
  request<StateResponse>("POST", `${sessionPath(sid)}/quarantine/${encodeURIComponent(qid)}/release`, {})

export const discardQuarantine = (sid: string, qid: string) =>
  request<StateResponse>("POST", `${sessionPath(sid)}/quarantine/${encodeURIComponent(qid)}/discard`, {})
