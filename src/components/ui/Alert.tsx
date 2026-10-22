import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle, XCircle } from '../../lib/icons'

/**
 * One inline message shape for the whole site.
 *
 * The pages used to spell their own amber/red/emerald boxes out by hand, which
 * is how three slightly different "yellow" backgrounds ended up meaning the same
 * thing. `role` follows the tone: a failure interrupts a screen reader, a
 * success or an explanation does not.
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONE_CLASS: Record<AlertTone, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  danger: 'alert-danger',
}

export function Alert({
  tone = 'info',
  title,
  children,
  className = '',
  actions,
  role,
}: {
  tone?: AlertTone
  /** A short bold lead-in, when the message needs a headline. */
  title?: ReactNode
  children?: ReactNode
  className?: string
  actions?: ReactNode
  /**
   * Overrides how the message is announced. A danger tone interrupts by
   * default — right for an action that just failed, wrong for a standing
   * description of the evidence on screen (the booking page's reading of an
   * uploaded receipt, say), which would otherwise talk over the real error.
   */
  role?: 'alert' | 'status'
}) {
  const urgent = role ? role === 'alert' : tone === 'danger' || tone === 'warning'
  return (
    <div
      className={`alert ${TONE_CLASS[tone]} ${className}`}
      role={role ?? (urgent ? 'alert' : 'status')}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {tone === 'success' ? <CheckCircle size={16} /> : tone === 'danger' ? <XCircle size={16} /> : <AlertCircle size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          {title && <strong className="font-semibold">{title} </strong>}
          {children}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  )
}
