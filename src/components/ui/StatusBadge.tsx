import type { BookingStatus } from '../../lib/booking'
import { CheckCircle, Clock, Sparkle, XCircle } from '../../lib/icons'

/**
 * The single booking-status badge.
 *
 * A status appears on the booking list, the status page, the account summary
 * and the invoice. Those are different contexts and may show different
 * *detail*, but they must not show different *colours*: a Guest who learns that
 * amber means "waiting" in one place cannot be shown green for the same state
 * in another. The tone map below is the only place those colours are written.
 *
 * Statuses are grouped by what they mean to the Guest, not by their position in
 * the Admin's workflow:
 *   success   — the Hacienda has accepted it or the stay happened
 *   pending   — waiting on the Hacienda
 *   danger    — it ended without a stay
 *   neutral   — a historical/administrative state
 */
export type StatusTone = 'success' | 'pending' | 'danger' | 'neutral'

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  neutral: 'bg-cream-100 text-forest-700',
}

/** Guest-facing meaning of each canonical status. */
export function statusTone(status: BookingStatus | string): StatusTone {
  switch (status) {
    case 'Approved':
    case 'Reserved':
    case 'Checked-In':
    case 'Staying':
    case 'Checked-Out':
    case 'Completed':
      return 'success'
    case 'Pending':
    case 'Payment Pending':
      return 'pending'
    case 'Rejected':
    case 'Cancelled':
    case 'Expired':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** One plain-language sentence per status, for a detail view. */
export function statusMeaning(status: BookingStatus | string): string {
  switch (status) {
    case 'Approved':
      return 'The Hacienda accepted your downpayment screenshot. This stay is confirmed.'
    case 'Reserved':
      return 'This stay is paid and reserved.'
    case 'Checked-In':
    case 'Staying':
      return 'You are checked in.'
    case 'Checked-Out':
    case 'Completed':
      return 'This stay is finished.'
    case 'Rejected':
      return 'The Hacienda declined the downpayment proof. This stay is not confirmed, and the dates have been released.'
    case 'Expired':
      return 'The 24-hour review window ran out before a decision. The dates are free again.'
    case 'Cancelled':
      return 'This booking was withdrawn. It is not a confirmed stay.'
    case 'Payment Pending':
    case 'Payment Verified':
      return 'Your payment is being recorded. The Hacienda confirms the stay before it is reserved.'
    default:
      return 'Your downpayment screenshot is with the Hacienda. The booking stays Pending until it is approved — it is not confirmed yet.'
  }
}

/** A page title for the status page — the decision, not the workflow word. */
export function statusHeadline(status: BookingStatus | string): string {
  switch (status) {
    case 'Approved':
      return 'Your stay is confirmed'
    case 'Reserved':
      return 'Your stay is reserved'
    case 'Checked-In':
    case 'Staying':
      return 'You are checked in'
    case 'Checked-Out':
    case 'Completed':
      return 'This stay is complete'
    case 'Rejected':
      return 'This booking was not approved'
    case 'Expired':
      return 'This booking expired'
    case 'Cancelled':
      return 'This booking was cancelled'
    case 'Payment Pending':
    case 'Payment Verified':
      return 'Your payment is being recorded'
    default:
      return 'Waiting for the Hacienda'
  }
}

function StatusIcon({ tone, size }: { tone: StatusTone; size: number }) {
  if (tone === 'success') return <CheckCircle size={size} />
  if (tone === 'pending') return <Clock size={size} />
  if (tone === 'danger') return <XCircle size={size} />
  return <Sparkle size={size} />
}

export function StatusBadge({
  status,
  size = 'sm',
  withIcon = true,
  label,
}: {
  status: BookingStatus | string
  size?: 'sm' | 'md'
  withIcon?: boolean
  /** Overrides the visible text (the status is still used for the tone). */
  label?: string
}) {
  const tone = statusTone(status)
  return (
    <span
      className={`badge ${size === 'md' ? 'px-3 py-1.5' : ''} ${TONE_CLASS[tone]}`}
      data-status={status}
      data-tone={tone}
    >
      {withIcon && <StatusIcon tone={tone} size={size === 'md' ? 14 : 12} />}
      {label ?? status}
    </span>
  )
}

/** The matching round icon tile, for a list row that leads with the status. */
export function StatusIconTile({ status, size = 40 }: { status: BookingStatus | string; size?: number }) {
  const tone = statusTone(status)
  return (
    <span
      className={`rounded-full flex items-center justify-center shrink-0 ${TONE_CLASS[tone]}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <StatusIcon tone={tone} size={Math.round(size * 0.4)} />
    </span>
  )
}
