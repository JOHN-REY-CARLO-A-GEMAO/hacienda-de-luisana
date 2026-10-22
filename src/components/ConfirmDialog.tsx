import { useId, useRef } from 'react'
import { useOverlay } from './ui/overlay'

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
 *
 * Keyboard, focus and scroll behaviour come from the same `useOverlay` the
 * drawer and the invoice dialog use — this prompt keeps its own because it
 * opens with the confirm button focused, so Enter does what the person just
 * chose. It used to re-implement the whole contract, which is how the drawer
 * ended up without a scroll lock while this had no backdrop click handling.
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
  const panel = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const titleId = useId()
  const bodyId = useId()

  useOverlay(open, onCancel, panel, { initialFocus: confirmRef })

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
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="card relative w-full max-w-md p-7 outline-none"
      >
        <h2 id={titleId} className="h2">{title}</h2>
        <p id={bodyId} className="mt-3 text-sm text-forest-800/85 leading-relaxed whitespace-pre-line">{body}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
