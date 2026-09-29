// ----------------------------------------------------------------------------
// Message retention — how long a finished conversation is kept, and when it is
// scheduled to go.
//
// A Booking is a record the hacienda keeps: money moved, a stay happened, an
// Activity log says who did what. A conversation is chat. The two are stored in
// two places on purpose — `bookings` and `conversations` — so that the first can
// be kept for years while the second is disposable.
//
// Nothing here deletes anything. Firestore Security Rules cannot delete on a
// schedule; the only thing they can do is refuse a write. So this module is the
// *policy* — pure, unit-tested, and the same arithmetic on both sides:
//
//   Active booking  →  messages kept, no expiry stamped
//   Booking done    →  `messages_expires_at` = completed_at + CHAT_RETENTION_DAYS
//   After that      →  a scheduled backend job sweeps the thread (see
//                      docs/MESSAGING.md § 4 for the mechanism and the deploy).
//
// The field is only ever written by the Admin (firestore.rules keeps a Guest's
// update to the four fields that make a message bubble up the inbox), so a
// Guest cannot shorten the window and erase a thread the hacienda is keeping.
// ----------------------------------------------------------------------------

/** Where the expiry is stamped, and the only field that carries the policy. */
export const RETENTION_FIELD = 'messages_expires_at'

/**
 * How long a finished conversation is kept, in days.
 *
 * Ninety days is the figure the hacienda publishes: long enough for a Guest to
 * come back to a quote or a settled question, short enough that a decade of
 * casual questions is not still on the books. Change the number here, redeploy;
 * it is one constant rather than a settings screen, and the Admin overrides it
 * per conversation through `retentionExpiry` when a stay needs longer.
 */
export const CHAT_RETENTION_DAYS = 90

/**
 * The Booking statuses that end a thread's useful life.
 *
 * A Booking that is still Pending, Approved, Checked-In or Staying keeps its
 * conversation: that is exactly when somebody is asking questions. Only a
 * terminal status — nothing more will happen on this Booking — starts the
 * clock. Mirrors the terminal branches in CONTEXT.md § Stay.
 */
export const RETENTION_ELIGIBLE_STATUSES = [
  'Completed',
  'Cancelled',
  'Rejected',
  'Expired',
] as const

export type RetentionEligibleStatus = (typeof RETENTION_ELIGIBLE_STATUSES)[number]

/** Is this a Booking status that starts the retention clock? */
export function isRetentionEligible(status: string | null | undefined): boolean {
  return RETENTION_ELIGIBLE_STATUSES.includes((status ?? '') as RetentionEligibleStatus)
}

/** Days, as a Firestore TTL field, as a Date. Whole days only — no hours. */
export function retentionExpiry(
  closedAt: Date | string | number,
  days: number = CHAT_RETENTION_DAYS,
): Date {
  const start = closedAt instanceof Date ? closedAt : new Date(closedAt)
  const whole = Math.max(1, Math.floor(days))
  return new Date(start.getTime() + whole * 24 * 60 * 60 * 1000)
}

/**
 * The patch a conversation's Admin writes when a Booking reaches a terminal
 * status, or null when it must not have one yet.
 *
 * Null is the important half: an active Booking has no expiry, so a thread that
 * is still being written cannot be scheduled away by a job that ran early.
 */
export function retentionPatch(input: {
  status: string | null | undefined
  closedAt: Date | string | number
  days?: number
}): { [RETENTION_FIELD]: Date } | null {
  if (!isRetentionEligible(input.status)) return null
  return { [RETENTION_FIELD]: retentionExpiry(input.closedAt, input.days) }
}

/**
 * The other half of the policy: has this thread's retention window closed?
 *
 * The Admin app uses it to say "scheduled for deletion" rather than opening a
 * thread that is about to be swept, and a test uses it to prove the arithmetic
 * rather than restating it.
 */
export function retentionElapsed(
  expiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (expiresAt == null) return false
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return false
  return at.getTime() <= now.getTime()
}

/** Whole days left before the sweep, floored at 0. Null when nothing is stamped. */
export function retentionDaysLeft(
  expiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): number | null {
  if (expiresAt == null) return null
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return null
  const ms = at.getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000))
}
