import { Compass, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { State } from "@/lib/api"
import { cn } from "@/lib/utils"

type Props = {
  name: string
  state: State
  busy: boolean
  onToggle: (enabled: boolean) => void
  onRestart: () => void
  /** Shown only when a tour exists for this scenario. */
  onTour?: () => void
}

export function PlayHeader({ name, state, busy, onToggle, onRestart, onTour }: Props) {
  const on = state.retcon_enabled
  const { llm_calls_used: used, llm_calls_limit: limit } = state.usage
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <h1 className="min-w-0 text-lg font-semibold tracking-tight">{name}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Retcon firewall"
          data-tour-target="switch"
          disabled={busy}
          onClick={() => onToggle(!on)}
          className={cn(
            "flex items-center gap-3 rounded-full border-2 py-1 pl-1 pr-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60",
            on ? "border-primary bg-primary/10" : "border-danger/60 bg-danger/10",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-7 w-12 items-center rounded-full p-0.5 transition-colors",
              on ? "justify-end bg-primary" : "justify-start bg-muted-foreground/50",
            )}
          >
            <span className="h-6 w-6 rounded-full bg-background shadow" />
          </span>
          <span className="leading-tight">
            <span className={cn("block text-sm font-semibold", on ? "text-primary" : "text-danger")}>
              Retcon {on ? "ON" : "OFF"}
            </span>
            <span className="block text-xs text-muted-foreground">Firewall {on ? "on" : "off"}</span>
          </span>
        </button>
        <p className="text-sm text-muted-foreground" aria-label="AI calls used">
          <span className="tabular-nums text-foreground">
            {used} / {limit}
          </span>{" "}
          AI calls
        </p>
        {onTour ? (
          <Button variant="outline" size="sm" onClick={onTour}>
            <Compass aria-hidden="true" />
            Tour
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRestart} disabled={busy}>
          <RotateCcw aria-hidden="true" />
          Restart
        </Button>
      </div>
    </div>
  )
}
