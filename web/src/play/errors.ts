import { ApiError } from "@/lib/api"

export type EndedReason = "quota" | "expired" | "mismatch"

export type ErrorView =
  | { kind: "ended"; reason: EndedReason }
  | { kind: "unknown_scenario" }
  /** Persistent, site-level problem. */
  | { kind: "banner"; text: string }
  /** Transient problem tied to the last action. `refresh` means local state may be stale. */
  | { kind: "notice"; text: string; refresh?: boolean }

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError(0, "internal", "Something went wrong.")
}

/** Maps API error codes to UI per docs/06-interfaces.md section 1. */
export function describeError(e: ApiError): ErrorView {
  switch (e.code) {
    case "session_quota_exhausted":
      return { kind: "ended", reason: "quota" }
    case "session_not_found":
      return { kind: "ended", reason: "expired" }
    case "session_mismatch":
      return { kind: "ended", reason: "mismatch" }
    case "unknown_scenario":
      return { kind: "unknown_scenario" }
    case "session_busy":
      return {
        kind: "notice",
        text: `Another request is still running. Try again${e.retryAfter ? ` in ${e.retryAfter} seconds` : " in a moment"}.`,
      }
    case "llm_unavailable":
      return { kind: "notice", text: "This turn failed, try again. Nothing was changed." }
    case "daily_quota_exhausted":
      return {
        kind: "banner",
        text: "The demo has used up its AI budget for today. Please come back tomorrow.",
      }
    case "db_unavailable":
      return { kind: "banner", text: "The demo's database is unreachable right now. Please try again later." }
    case "network":
      return { kind: "banner", text: "You appear to be offline, or the server is unreachable. Check your connection and try again." }
    case "ip_rate_limited":
      return {
        kind: "banner",
        text: `Too many sessions started from your network. Try again${e.retryAfter ? ` in ${Math.ceil(e.retryAfter / 60)} minutes` : " later"}.`,
      }
    case "history_event_not_found":
    case "quarantine_item_not_found":
      return { kind: "notice", text: "That item changed in the meantime. The view was refreshed.", refresh: true }
    case "input_too_long":
      return { kind: "notice", text: "That text is longer than 2,000 characters." }
    case "invalid_request":
      return { kind: "notice", text: "The request was not valid. Check the text and try again." }
    default:
      return { kind: "notice", text: "Something went wrong. Please try again." }
  }
}
