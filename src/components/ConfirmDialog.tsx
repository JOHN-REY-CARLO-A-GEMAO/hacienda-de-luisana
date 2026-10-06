import { useEffect, useRef } from 'react'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The deliberate second input in front of an action that cannot be undone.
 *
 * Two buttons, always both present, and Escape / backdrop / Cancel all mean the
 * same thing: nothing happens. `danger` paints the confirm button red and is
 * for the actions that release dates or delete a record.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-5"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="absolute inset-0 bg-forest-900/45 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-[28px] bg-white border border-forest-900/5 shadow-card p-7"
      >
        <h2 className="font-serif text-2xl text-forest-900">{title}</h2>
        <p className="mt-3 text-sm text-forest-800/85 leading-relaxed">{body}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn-ghost text-xs" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? 'btn inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all duration-300 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50'
                : 'btn-primary text-xs'
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}