import type { Memory } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge, Empty, TrustBar, sourceLabel } from "./ui"

export function MemoryPanel({ memories, usedKeys, turn }: { memories: Memory[]; usedKeys: string[]; turn: number }) {
  return (
    <section aria-labelledby="mem-h" className="space-y-3">
      <div>
        <h2 id="mem-h" className="text-sm font-semibold">
          Memory
        </h2>
        <p className="text-xs text-muted-foreground">What the assistant currently remembers. Trust is the score of where each memory came from.</p>
      </div>
      {memories.length === 0 ? (
        <Empty>No memories yet. Chat or let the assistant read something.</Empty>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => {
            const used = usedKeys.includes(m.key)
            return (
              <li
                // Changing the key on each turn restarts the highlight animation.
                key={used ? `${m.key}-${turn}` : m.key}
                data-used={used ? "true" : undefined}
                className={cn(
                  "rounded-lg border bg-card p-3 text-sm",
                  m.tainted && "border-danger/40",
                  used && "memory-used",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{m.key}</span>
                  {m.tainted ? <Badge tone="danger">tainted</Badge> : null}
                  {used ? <Badge tone="accent">used in last reply</Badge> : null}
                </div>
                <p className="mt-1 break-words">{m.text}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 break-words">
                    Source: {m.source.type} ({sourceLabel(m.source)})
                  </span>
                  <TrustBar value={m.trust} label={`Trust of ${m.key}`} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
