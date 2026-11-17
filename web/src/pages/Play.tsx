import { useState } from "react"
import { Link, useParams } from "react-router-dom"

import { Tabs } from "@/components/Tabs"
import { Button } from "@/components/ui/button"
import type { TimelineEvent } from "@/lib/api"
import { ActivityPanel } from "@/play/ActivityPanel"
import { ConversationPanel } from "@/play/ConversationPanel"
import { MemoryPanel } from "@/play/MemoryPanel"
import { PlayHeader } from "@/play/PlayHeader"
import { RollbackDialog } from "@/play/RollbackDialog"
import type { EndedReason } from "@/play/errors"
import { useMediaQuery } from "@/play/useMediaQuery"
import { usePlayground } from "@/play/usePlayground"

const ENDED: Record<EndedReason, { title: string; body: string }> = {
  quota: {
    title: "This session is out of AI calls",
    body: "Every session gets a fixed number of AI calls so the demo stays free to try. Start a new session to keep going.",
  },
  expired: {
    title: "This session has expired",
    body: "Sessions only last 24 hours. Start a new one to try again.",
  },
  mismatch: {
    title: "This is not your session",
    body: "This session belongs to a different browser. Start a new one of your own.",
  },
}

function Screen({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-10 text-center" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <div className="flex justify-center gap-2">{children}</div>
    </div>
  )
}

export function Play() {
  const { scenario: scenarioId = "" } = useParams<{ scenario: string }>()
  const pg = usePlayground(scenarioId)
  const { ps } = pg
  const desktop = useMediaQuery("(min-width: 1024px)")
  const [chatDraft, setChatDraft] = useState("")
  const [kind, setKind] = useState("")
  const [external, setExternal] = useState("")
  const [rollbackEvent, setRollbackEvent] = useState<TimelineEvent | null>(null)

  if (ps.phase === "loading") {
    return (
      <p role="status" className="py-20 text-center text-muted-foreground">
        Starting a session...
      </p>
    )
  }
  if (ps.phase === "unknown_scenario") {
    return (
      <Screen title="Scenario not found" body="That scenario does not exist, or is not available yet.">
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </Screen>
    )
  }
  if (ps.phase === "failed") {
    return (
      <Screen title="Could not start a session" body={ps.fatalText ?? "Please try again."}>
        <Button onClick={() => void pg.retry()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </Screen>
    )
  }
  if (ps.phase === "ended" || !ps.state || !ps.scenario) {
    const c = ENDED[ps.endedReason ?? "expired"]
    return (
      <Screen title={c.title} body={c.body}>
        <Button onClick={() => void pg.restart()}>Start a new session</Button>
        <Button variant="outline" asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </Screen>
    )
  }

  const { state, scenario } = ps
  const busy = ps.busy !== null
  const activeKind = kind || scenario.source_kinds[0]?.kind || ""

  const conversation = (
    <ConversationPanel
      scenario={scenario}
      transcript={ps.transcript}
      pending={ps.pending}
      busy={busy}
      ingestResults={ps.ingestResults}
      notice={ps.notice}
      drafts={{ chat: chatDraft, setChat: setChatDraft, kind: activeKind, setKind, external, setExternal }}
      onChat={pg.sendChat}
      onIngest={pg.sendIngest}
    />
  )
  const memory = <MemoryPanel memories={state.memories} usedKeys={ps.usedKeys} turn={ps.turn} />
  const activity = (
    <ActivityPanel state={state} busy={busy} onRollback={setRollbackEvent} onQuarantine={(q, k) => void pg.quarantineAction(q, k)} />
  )

  return (
    <div className="space-y-4">
      <PlayHeader
        name={scenario.name}
        state={state}
        busy={busy}
        onToggle={(v) => void pg.setRetcon(v)}
        onRestart={() => void pg.restart()}
      />
      {ps.banner ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <span>{ps.banner}</span>
          <button
            type="button"
            onClick={pg.dismiss}
            className="shrink-0 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {desktop ? (
        <div className="grid grid-cols-3 gap-6">
          <div className="min-w-0">{conversation}</div>
          <div className="min-w-0">{memory}</div>
          <div className="min-w-0">{activity}</div>
        </div>
      ) : (
        <Tabs
          label="Playground views"
          tabs={[
            { id: "conversation", label: "Conversation", content: conversation },
            { id: "memory", label: "Memory", content: memory },
            { id: "activity", label: "Activity", content: activity },
          ]}
        />
      )}
      {rollbackEvent ? (
        <RollbackDialog
          event={rollbackEvent}
          onClose={() => setRollbackEvent(null)}
          onPreview={pg.previewRollback}
          onConfirm={pg.confirmRollback}
        />
      ) : null}
    </div>
  )
}
