import { useEffect, useRef, useState } from "react"

import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import type { DiffEntry, RollbackResponse, TimelineEvent } from "@/lib/api"
import { MemoryText, SectionTitle } from "./ui"

type Diff = RollbackResponse["diff"]

type Props = {
  event: TimelineEvent
  onClose: () => void
  onPreview: (id: string) => Promise<{ ok: true; diff: Diff } | { ok: false; message: string }>
  onConfirm: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>
}

function Group({ title, entries }: { title: string; entries: DiffEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div>
      <SectionTitle count={entries.length}>{title}</SectionTitle>
      <ul className="space-y-2">
        {entries.map((d) => (
          <li key={d.key} className="rounded-md border p-3 text-sm">
            <p className="font-mono text-xs font-semibold">{d.key}</p>
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">Now: </span>
              <MemoryText value={d.before} />
            </p>
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">After rollback: </span>
              <MemoryText value={d.after} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RollbackDialog({ event, onClose, onPreview, onConfirm }: Props) {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const previewRef = useRef(onPreview)
  useEffect(() => {
    previewRef.current = onPreview
  })

  useEffect(() => {
    let cancelled = false
    void previewRef.current(event.history_id).then((r) => {
      if (cancelled) return
      if (r.ok) setDiff(r.diff)
      else setError(r.message || "Could not preview the rollback.")
    })
    return () => {
      cancelled = true
    }
  }, [event.history_id])

  const total = diff ? diff.added.length + diff.removed.length + diff.changed.length : 0

  const confirm = async () => {
    setConfirming(true)
    const r = await onConfirm(event.history_id)
    if (r.ok) onClose()
    else {
      setConfirming(false)
      setError(r.message || "Could not roll back.")
    }
  }

  return (
    <Modal
      title="Roll back to before this change?"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={!diff || confirming || total === 0}>
            {confirming ? "Rolling back..." : "Confirm rollback"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" aria-live="polite">
        <p className="text-sm text-muted-foreground">
          This undoes the change to <span className="font-mono">{event.key}</span> and everything after it. The
          rollback itself is recorded, so you can undo it too.
        </p>
        {!diff && !error ? <p className="text-sm">Loading preview...</p> : null}
        {error ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {diff ? (
          total === 0 ? (
            <p className="text-sm">Nothing would change. Memory is already in that state.</p>
          ) : (
            <div className="space-y-4">
              <Group title="Restored" entries={diff.added} />
              <Group title="Removed" entries={diff.removed} />
              <Group title="Changed" entries={diff.changed} />
            </div>
          )
        ) : null}
      </div>
    </Modal>
  )
}
