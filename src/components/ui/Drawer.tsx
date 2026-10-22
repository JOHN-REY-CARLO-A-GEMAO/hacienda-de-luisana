import { useId, useRef, type ReactNode } from 'react'
import { Close } from '../../lib/icons'
import { useOverlay } from './overlay'

/**
 * The two overlay shapes: a panel that slides in from the right, and a centred
 * dialog. Both are layered over the page the Guest is already on — neither is a
 * route — and both get their keyboard, focus and scroll behaviour from
 * `useOverlay`, so no surface can forget one of them.
 */

/** A panel that slides in from the right: notifications, filters, detail. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  headerAction,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** A quiet action beside the title (e.g. "Mark all read"). */
  headerAction?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useOverlay(open, onClose, panel)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      <div
        className="absolute inset-0 bg-forest-950/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-cream-50 shadow-float outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-forest-900/10 px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="h3">
              {title}
            </h2>
            {description && <p className="mt-1 text-xs text-forest-700/80">{description}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerAction}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Close size={20} />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

/** A centered dialog for a self-contained task, such as reading an invoice. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean
  onClose: () => void
  /** Visually hidden when the content carries its own heading. */
  title: string
  children: ReactNode
  width?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useOverlay(open, onClose, panel)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="presentation">
      <div className="fixed inset-0 bg-forest-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative my-auto w-full ${width} outline-none`}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
