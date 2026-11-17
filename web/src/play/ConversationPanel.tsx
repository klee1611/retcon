import { useEffect, useRef, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import type { IngestCandidate, PresetCategory, Scenario } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "./usePlayground"
import { ActionLine, Badge, SectionTitle, sourceLabel } from "./ui"

export const MAX_CHARS = 2000

export type Drafts = {
  chat: string
  setChat: (v: string) => void
  kind: string
  setKind: (v: string) => void
  external: string
  setExternal: (v: string) => void
}

const CATEGORY_LABEL: Record<PresetCategory, string> = {
  attack_obvious: "Attack: obvious",
  attack_subtle: "Attack: subtle",
  attack_disguised: "Attack: disguised",
  benign: "Benign",
}
const CATEGORY_ORDER: PresetCategory[] = ["attack_obvious", "attack_subtle", "attack_disguised", "benign"]

type Props = {
  scenario: Scenario
  transcript: ChatMessage[]
  pending: string | null
  busy: boolean
  drafts: Drafts
  ingestResults: IngestCandidate[] | null
  notice: string | null
  onChat: (text: string) => Promise<boolean>
  onIngest: (kind: string, text: string) => Promise<boolean>
}

function Counter({ id, n }: { id: string; n: number }) {
  return (
    <span id={id} className={cn("text-xs tabular-nums", n >= MAX_CHARS ? "text-danger" : "text-muted-foreground")}>
      {n.toLocaleString("en-US")} / {MAX_CHARS.toLocaleString("en-US")}
    </span>
  )
}

export function ConversationPanel({
  scenario,
  transcript,
  pending,
  busy,
  drafts,
  ingestResults,
  notice,
  onChat,
  onIngest,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [transcript.length, pending])

  const submitChat = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    if (await onChat(t)) drafts.setChat("")
  }
  const onChatSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submitChat(drafts.chat)
  }
  const onExternalSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!drafts.external.trim() || busy) return
    void onIngest(drafts.kind, drafts.external)
  }

  const presetsByCat = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: scenario.presets.filter((p) => p.category === c && p.kind === drafts.kind),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="space-y-6">
      <section aria-labelledby="chat-h" className="space-y-3">
        <h2 id="chat-h" className="text-sm font-semibold">
          Conversation
          <span className="ml-2 font-normal text-muted-foreground">
            {scenario.user_role} and {scenario.agent_role.toLowerCase()}
          </span>
        </h2>
        <div
          role="log"
          aria-label="Conversation transcript"
          aria-live="polite"
          className="max-h-[26rem] min-h-40 space-y-4 overflow-y-auto rounded-lg border bg-card p-3"
        >
          {transcript.length === 0 && !pending ? (
            <p className="p-2 text-sm text-muted-foreground">
              Ask the {scenario.agent_role.toLowerCase()} for something to get started.
            </p>
          ) : null}
          {transcript.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {m.text}
                </p>
              </div>
            ) : (
              <div key={m.id} className="max-w-[92%] space-y-2">
                <p className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">{m.text}</p>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Used memories</p>
                  {m.memories.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {m.memories.map((u) => (
                        <li key={u.key} className="min-w-0">
                          <span
                            title={`${u.text} (source: ${sourceLabel(u.source)})`}
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                              u.tainted ? "border-danger/50 bg-danger/10 text-danger" : "bg-background",
                            )}
                          >
                            <span className="truncate">
                              {u.key}: {u.text}
                            </span>
                            {u.tainted ? <span className="shrink-0 font-semibold">tainted</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {m.actions.length > 0 ? (
                  <ul className="space-y-1.5" aria-label="Actions taken">
                    {m.actions.map((a) => (
                      <li key={a.action_id}>
                        <ActionLine action={a} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ),
          )}
          {pending ? (
            <>
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {pending}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">Assistant is thinking...</p>
            </>
          ) : null}
          <div ref={endRef} />
        </div>

        {scenario.chat_suggestions.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Suggested messages">
            {scenario.chat_suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitChat(s)}
                  className="rounded-full border px-3 py-1 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <form onSubmit={onChatSubmit} className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Message to the {scenario.agent_role.toLowerCase()}
          </label>
          <input
            id="chat-input"
            value={drafts.chat}
            onChange={(e) => drafts.setChat(e.target.value)}
            maxLength={MAX_CHARS}
            disabled={busy}
            autoComplete="off"
            placeholder="Type a message"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button type="submit" disabled={busy || !drafts.chat.trim()}>
            Send
          </Button>
        </form>
        {notice ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {notice}
          </p>
        ) : null}
      </section>

      <hr className="border-border" />

      <section aria-labelledby="ext-h" className="space-y-3">
        <div>
          <h2 id="ext-h" className="text-sm font-semibold">
            External content
          </h2>
          <p className="text-xs text-muted-foreground">
            Text from outside the conversation, such as a product review. The assistant reads it and may try to save
            what it learns as memory.
          </p>
        </div>

        <form onSubmit={onExternalSubmit} className="space-y-3">
          {scenario.source_kinds.length > 1 ? (
            <div>
              <label htmlFor="ext-kind" className="mb-1 block text-xs text-muted-foreground">
                Kind of content
              </label>
              <select
                id="ext-kind"
                value={drafts.kind}
                onChange={(e) => drafts.setKind(e.target.value)}
                disabled={busy}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {scenario.source_kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-2">
            {presetsByCat.map((g) => (
              <div key={g.category} role="group" aria-label={CATEGORY_LABEL[g.category]} className="flex flex-wrap items-center gap-1.5">
                <span className="w-full text-xs text-muted-foreground sm:w-auto sm:min-w-32">
                  {CATEGORY_LABEL[g.category]}
                </span>
                {g.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => drafts.setExternal(p.text)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      g.category !== "benign" && "border-danger/40",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="ext-text" className="text-xs text-muted-foreground">
                Content to read
              </label>
              <Counter id="ext-count" n={drafts.external.length} />
            </div>
            <textarea
              id="ext-text"
              value={drafts.external}
              onChange={(e) => drafts.setExternal(e.target.value)}
              maxLength={MAX_CHARS}
              rows={5}
              disabled={busy}
              aria-describedby="ext-count"
              placeholder="Write your own, or pick an example above"
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
          <Button type="submit" disabled={busy || !drafts.external.trim()} className="w-full sm:w-auto">
            Let the assistant read it
          </Button>
        </form>

        {ingestResults ? (
          <div aria-live="polite" className="space-y-2">
            <SectionTitle>Result of the last read</SectionTitle>
            {ingestResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">The assistant found nothing worth remembering.</p>
            ) : (
              <ul className="space-y-2">
                {ingestResults.map((c, i) => (
                  <li
                    key={`${c.key}-${i}`}
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      c.outcome === "quarantined" ? "border-primary/40 bg-primary/5" : "bg-background",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={c.outcome === "quarantined" ? "accent" : "neutral"}>
                        {c.outcome === "quarantined" ? "Quarantined" : "Stored"}
                      </Badge>
                      <span className="font-mono text-xs">{c.key}</span>
                    </div>
                    <p className="mt-1 break-words">{c.text}</p>
                    {c.outcome === "quarantined" ? (
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        Rule: <span className="font-mono">{c.rule}</span>. {c.reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
