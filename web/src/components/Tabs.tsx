import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type TabDef = { id: string; label: string; content: ReactNode }

type TabsProps = {
  tabs: TabDef[]
  label: string
  /** Controlled mode: the parent owns the active tab. */
  value?: string
  onValueChange?: (id: string) => void
}

export function Tabs({ tabs, label, value, onValueChange }: TabsProps) {
  const [own, setOwn] = useState(tabs[0].id)
  const active = value ?? own
  const setActive = (id: string) => {
    setOwn(id)
    onValueChange?.(id)
  }
  const base = useId()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const move = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]
    setActive(next.id)
    refs.current[next.id]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") move(index + 1)
    else if (e.key === "ArrowLeft") move(index - 1)
    else if (e.key === "Home") move(0)
    else if (e.key === "End") move(tabs.length - 1)
    else return
    e.preventDefault()
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b">
        {tabs.map((t, i) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className="pt-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.id === active ? t.content : null}
        </div>
      ))}
    </div>
  )
}
