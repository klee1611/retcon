import type { Action, State, TimelineEvent } from "@/lib/api"

export type TourTab = "conversation" | "memory" | "activity"

export type TourStepDef = {
  /** Short heading shown on the card. */
  title: string
  text: string
  /** Values of `data-tour-target` to highlight. The first one that exists anchors the card. */
  targets: string[]
  /** Mobile tab that holds the targets. */
  tab: TourTab | null
  /** Fill the external-content textarea with the obvious attack preset. */
  prefill?: boolean
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    title: "Turn Retcon off",
    text: "Retcon is on. Turn it off to see what an unprotected agent does.",
    targets: ["switch"],
    tab: null,
  },
  {
    title: "Read the review",
    text: "This product review hides an instruction. Let the assistant read it.",
    targets: ["ext-submit", "ext-text"],
    tab: "conversation",
    prefill: true,
  },
  {
    title: "Ask for a refund",
    text: "Now ask for a refund. Use the highlighted suggestion.",
    targets: ["refund-chip"],
    tab: "conversation",
  },
  {
    title: "Undo the damage",
    text: 'Hijacked: the refund went to the attacker. Let\'s undo it. Click "Roll back to before this" on the highlighted change that wrote the poisoned memory, then confirm.',
    targets: ["rollback-btn", "hijacked", "poison"],
    tab: "activity",
  },
  {
    title: "Turn Retcon back on",
    text: "Turn Retcon back on.",
    targets: ["switch"],
    tab: null,
  },
  {
    title: "Same review, again",
    text: "Feed it the same review again.",
    targets: ["ext-submit", "ext-text"],
    tab: "conversation",
    prefill: true,
  },
  {
    title: "Blocked",
    text: "Blocked. The poisoned memory is held in quarantine, and the refund stays safe. Try the other attacks, or a normal review.",
    targets: ["quarantine"],
    tab: "activity",
  },
]

export const LAST_STEP = TOUR_STEPS.length - 1

export type TourState = {
  status: "off" | "prompt" | "active"
  step: number
  sessionId: string
  /** What the session looked like when the step began, so "new" events can be told apart. */
  baseTimeline: string[]
  baseQuarantine: number
}

const idle = (status: "off" | "prompt"): TourState => ({ status, step: 0, sessionId: "", baseTimeline: [], baseQuarantine: 0 })

export const initialTour = (seen: boolean): TourState => idle(seen ? "off" : "prompt")
export const offTour = (): TourState => idle("off")

const isOutside = (e: TimelineEvent) => !!e.source && e.source.type !== "conversation" && e.source.type !== "system"

/** The newest change that an outside source (the review) wrote into memory. */
export const findPoisonEvent = (timeline: TimelineEvent[]) => timeline.find((e) => e.op === "put" && isOutside(e)) ?? null

export const findHijackedAction = (actions: Action[]) =>
  actions.find((a) => a.verdict.result === "hijacked") ?? actions[0] ?? null

function begin(step: number, state: State): TourState {
  return {
    status: "active",
    step,
    sessionId: state.session_id,
    baseTimeline: state.timeline.map((e) => e.history_id),
    baseQuarantine: state.quarantine.length,
  }
}

export const startTour = (state: State) => begin(0, state)

/** Has the visitor done what this step asks for? Step 7 is the end and is never "done". */
export function stepDone(t: TourState, s: State): boolean {
  switch (t.step) {
    case 0:
      return !s.retcon_enabled
    case 1: {
      const known = new Set(t.baseTimeline)
      return s.timeline.some((e) => !known.has(e.history_id) && e.op === "put" && isOutside(e))
    }
    case 2:
      return s.actions.length > 0
    case 3:
      return s.timeline.some((e) => e.op === "rollback")
    case 4:
      return s.retcon_enabled
    case 5:
      return s.quarantine.length > t.baseQuarantine
    default:
      return false
  }
}

/**
 * Brings an active tour in line with the session. Returns the same object when nothing changed.
 * Steps whose condition is already met are skipped, so doing things out of order just moves ahead.
 */
export function syncTour(t: TourState, s: State): TourState {
  if (t.status !== "active") return t
  // A new session (Restart) begins the story again.
  let cur = t.sessionId === s.session_id ? t : begin(0, s)
  while (cur.step < LAST_STEP && stepDone(cur, s)) cur = begin(cur.step + 1, s)
  return cur
}

const KEY = "retcon:tour-seen"

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function markTourSeen() {
  try {
    window.localStorage.setItem(KEY, "1")
  } catch {
    /* storage unavailable (private mode): the prompt may show again, which is fine */
  }
}
