import { useEffect, useId, useLayoutEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { LAST_STEP, TOUR_STEPS } from "./tour"

const CARD_W = 320
const GAP = 12

type Rect = { left: number; top: number; right: number; bottom: number }

const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

function targetEls(targets: string[]) {
  return targets
    .map((t) => document.querySelector<HTMLElement>(`[data-tour-target="${t}"]`))
    .filter((el): el is HTMLElement => el !== null)
}

/** Picks a spot beside the anchor that stays on screen and does not cover any highlighted element. */
function place(card: HTMLElement, targets: string[]) {
  const els = targetEls(targets)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = card.offsetHeight
  const w = Math.min(CARD_W, vw - 16)
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - w - 8))
  const clampY = (y: number) => Math.max(8, Math.min(y, vh - h - 8))
  let best = { left: vw - w - 16, top: vh - h - 16 }
  if (els.length > 0) {
    const rects = els.map((el) => el.getBoundingClientRect()).map((r) => ({
      left: r.left - 6,
      top: r.top - 6,
      right: r.right + 6,
      bottom: r.bottom + 6,
    }))
    const a = rects[0]
    const candidates = [
      { left: clampX(a.left), top: a.bottom + GAP },
      { left: clampX(a.left), top: a.top - GAP - h },
      { left: a.left - GAP - w, top: clampY(a.top) },
      { left: a.right + GAP, top: clampY(a.top) },
    ]
    const fits = (c: { left: number; top: number }) =>
      c.left >= 8 &&
      c.top >= 8 &&
      c.left + w <= vw - 8 &&
      c.top + h <= vh - 8 &&
      !rects.some((r) => overlaps({ left: c.left, top: c.top, right: c.left + w, bottom: c.top + h }, r))
    best = candidates.find(fits) ?? best
  }
  card.style.width = `${w}px`
  card.style.left = `${best.left}px`
  card.style.top = `${best.top}px`
}

type Props = {
  step: number
  desktop: boolean
  onSkip: () => void
}

export function TourCard({ step, desktop, onSkip }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const def = TOUR_STEPS[step]
  const last = step === LAST_STEP

  // Bring the target into view (smooth only if the visitor allows motion), then move focus to the card.
  useEffect(() => {
    const [anchor] = targetEls(def.targets)
    anchor?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" })
    ref.current?.focus({ preventScroll: true })
  }, [step, def.targets])

  // Anchor the card on desktop; on mobile CSS pins it to the bottom as a sheet.
  useLayoutEffect(() => {
    const card = ref.current
    if (!card) return
    if (!desktop) {
      card.style.cssText = ""
      return
    }
    const update = () => place(card, def.targets)
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    // Content moves when state arrives or panels grow; re-measure a few times as it settles.
    const timers = [150, 400, 900].map((ms) => window.setTimeout(update, ms))
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      timers.forEach(window.clearTimeout)
    }
  })

  // Esc leaves the tour, unless a real modal (the rollback dialog) is open and owns Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      onSkip()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onSkip])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      data-testid="tour-card"
      className={
        desktop
          ? "fixed z-40 rounded-lg border bg-card p-4 text-card-foreground shadow-lg focus:outline-none motion-safe:transition-[top,left] motion-safe:duration-200"
          : "fixed inset-x-0 bottom-0 z-40 max-h-[45vh] overflow-y-auto rounded-t-lg border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground shadow-lg focus:outline-none"
      }
    >
      <p id={titleId} className="text-xs font-semibold uppercase tracking-wide text-primary">
        Guided tour: step {step + 1} of {TOUR_STEPS.length}
      </p>
      <p id={bodyId} className="mt-1 text-sm">
        {def.text}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={i <= step ? "h-1.5 w-4 rounded-full bg-primary" : "h-1.5 w-4 rounded-full bg-muted"} />
          ))}
        </div>
        {last ? (
          <Button size="sm" onClick={onSkip}>
            Finish
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip tour
          </Button>
        )}
      </div>
    </div>
  )
}

export function TourPrompt({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <section
      aria-label="Guided tour"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <p className="text-sm">New here? See what an AI agent does when a product review tries to hijack it.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onStart}>
          Take the 1-minute tour
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          No thanks
        </Button>
      </div>
    </section>
  )
}
