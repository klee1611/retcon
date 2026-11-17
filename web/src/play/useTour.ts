import { useCallback, useState } from "react"

import type { State } from "@/lib/api"
import { initialTour, markTourSeen, offTour, startTour, syncTour, tourSeen, type TourState } from "./tour"

/** Tour progress derived from session state; the tour never calls the API itself. */
export function useTour(state: State | null, enabled: boolean) {
  const [raw, setRaw] = useState<TourState>(() => initialTour(tourSeen()))

  // Derive the current step from state while rendering (no effect, so no extra frame).
  let tour = raw
  if (state && enabled) {
    const next = syncTour(raw, state)
    if (next !== raw) {
      setRaw(next)
      tour = next
    }
  }
  if (!enabled && tour.status !== "off") tour = { ...tour, status: "off" }

  const start = useCallback(() => {
    markTourSeen()
    if (state) setRaw(syncTour(startTour(state), state))
  }, [state])

  const close = useCallback(() => {
    markTourSeen()
    setRaw(offTour())
  }, [])

  return { tour, start, close }
}
