import type { ReactNode } from "react"

import type { Action, MemoryValue, Source } from "@/lib/api"
import { cn } from "@/lib/utils"

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  title?: string
  tone?: "neutral" | "danger" | "success" | "accent"
  children: ReactNode
  className?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
        tone === "success" && "border-success/40 bg-success/10 text-success",
        tone === "accent" && "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Action["verdict"] }) {
  return verdict.result === "hijacked" ? (
    <Badge tone="danger">Hijacked</Badge>
  ) : (
    <Badge tone="success">OK</Badge>
  )
}

export function ActionLine({ action }: { action: Action }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        action.verdict.result === "hijacked" ? "border-danger/40 bg-danger/5" : "bg-background",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={action.verdict} />
        <span className="min-w-0 break-words">{action.summary}</span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">{action.verdict.reason}</p>
    </div>
  )
}

export const sourceLabel = (s: Source | null) => (s ? s.label || `${s.type}:${s.id}` : "system")

export function MemoryText({ value }: { value: MemoryValue | null }) {
  if (!value) return <span className="italic text-muted-foreground">(nothing)</span>
  return <span className="break-words">{value.text}</span>
}

export function TrustBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{v}</span>
    </div>
  )
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
      {count !== undefined ? <span className="font-normal normal-case">({count})</span> : null}
    </h3>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>
  )
}

export const formatTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
