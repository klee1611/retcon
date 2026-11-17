import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type ModalProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Footer actions, rendered below the body. */
  footer?: ReactNode
}

/** Accessible modal: focus is moved in and trapped, Esc and backdrop click close, focus is restored. */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    panel.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      closeRef.current()
      return
    }
    if (e.key !== "Tab" || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    } else if (!panel.current.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-lg border bg-card text-card-foreground shadow-lg focus:outline-none sm:rounded-lg"
      >
        <h2 id={titleId} className="border-b px-5 py-4 text-base font-semibold">
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
