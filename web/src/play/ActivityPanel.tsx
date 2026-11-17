import { Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { State, TimelineEvent } from "@/lib/api"
import { ActionLine, Badge, Empty, MemoryText, SectionTitle, TrustBar, formatTime, sourceLabel } from "./ui"

type Props = {
  state: State
  busy: boolean
  onRollback: (e: TimelineEvent) => void
  onQuarantine: (qid: string, kind: "release" | "discard") => void
}

const OP_LABEL: Record<TimelineEvent["op"], string> = {
  put: "Saved",
  delete: "Deleted",
  forget: "Forgot",
  rollback: "Rolled back",
  release: "Released",
}

export function ActivityPanel({ state, busy, onRollback, onQuarantine }: Props) {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold">Activity</h2>
      <section aria-label="Timeline">
        <SectionTitle count={state.timeline.length}>Timeline</SectionTitle>
        {state.timeline.length === 0 ? (
          <Empty>No memory changes yet.</Empty>
        ) : (
          <ol className="space-y-2">
            {state.timeline.map((e) => (
              <li key={e.history_id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.op === "rollback" ? "accent" : "neutral"}>{OP_LABEL[e.op]}</Badge>
                  <span className="font-mono text-xs font-semibold">{e.key}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatTime(e.at)}</span>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <p>
                    <span className="text-muted-foreground">Before: </span>
                    <MemoryText value={e.before} />
                  </p>
                  <p>
                    <span className="text-muted-foreground">After: </span>
                    <MemoryText value={e.after} />
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-xs text-muted-foreground">
                    Source: {sourceLabel(e.source)}. Retcon was {e.retcon_enabled ? "on" : "off"}.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onRollback(e)}
                    aria-label={`Roll back to before this: ${OP_LABEL[e.op]} ${e.key}`}
                  >
                    <Undo2 aria-hidden="true" />
                    Roll back to before this
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Quarantine">
        <SectionTitle count={state.quarantine.length}>Quarantine</SectionTitle>
        {state.quarantine.length === 0 ? (
          <Empty>Nothing held. With Retcon on, suspicious memory writes wait here for your decision.</Empty>
        ) : (
          <ul className="space-y-2">
            {state.quarantine.map((q) => (
              <li key={q.quarantine_id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={q.status === "held" ? "accent" : "neutral"}>
                    {q.status === "held" ? "Held" : q.status === "released" ? "Released" : "Discarded"}
                  </Badge>
                  <span className="font-mono text-xs font-semibold">{q.key}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatTime(q.at)}</span>
                </div>
                <p className="mt-1 break-words">{q.text}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  Rule: <span className="font-mono">{q.rule}</span>. {q.reason} Source: {sourceLabel(q.source)}.
                </p>
                {q.status === "held" ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onQuarantine(q.quarantine_id, "release")}
                      aria-label={`Release ${q.key} into memory`}
                    >
                      Release
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onQuarantine(q.quarantine_id, "discard")}
                      aria-label={`Discard ${q.key}`}
                    >
                      Discard
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Actions">
        <SectionTitle count={state.actions.length}>Actions</SectionTitle>
        {state.actions.length === 0 ? (
          <Empty>The assistant has not taken any action yet. Ask for a refund.</Empty>
        ) : (
          <ul className="space-y-2">
            {state.actions.map((a) => (
              <li key={a.action_id}>
                <ActionLine action={a} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTime(a.at)}. Retcon was {a.retcon_enabled ? "on" : "off"}.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Source trust">
        <SectionTitle count={state.sources.length}>Source trust</SectionTitle>
        {state.sources.length === 0 ? (
          <Empty>No outside sources have been read yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {state.sources.map((s) => (
              <li key={`${s.type}:${s.id}`} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-mono text-xs">
                    {s.type}:{s.id}
                  </span>
                  <TrustBar value={s.trust} label={`Trust of ${s.type} ${s.id}`} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.blocked} blocked, {s.clean} clean
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
