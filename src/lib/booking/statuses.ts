// ----------------------------------------------------------------------------
// Booking lifecycle — statuses and transitions
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The canonical Booking statuses and the legal transitions between them.
// Vocabulary: CONTEXT.md § Booking status.
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------


/**
 * The canonical Booking statuses, in lifecycle order followed by the terminal
 * branches (CONTEXT.md § Booking status).
 *
 * `Confirmed` is retired: the paid state is `Reserved`.
 */

export const BOOKING_STATUSES = [
  'Pending',
  'KYC Submitted',
  'Approved',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Checked-In',
  'Staying',
  'Checked-Out',
  'Completed',
  'Rejected',
  'Cancelled',
  'Expired',
] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/** Statuses that are no longer written, but are still stored in old documents. */
const RETIRED_STATUSES: Record<string, BookingStatus> = {
  // Spec #9: the web `Confirmed` status is retired in favour of `Reserved`.
  confirmed: 'Reserved',
}

/** Fold a stored status string to something comparable: lowercase, no separators. */
function fold(status: string): string {
  return status.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

const CANONICAL_BY_FOLDED = new Map<string, BookingStatus>(
  BOOKING_STATUSES.map((status) => [fold(status), status]),
)

/**
 * Read a stored status as a canonical Booking status.
 *
 * Old documents are migrated here rather than rewritten in Firestore: a stored
 * `Confirmed` reads as `Reserved`, the casing and snake_case the Flutter guest
 * app writes reads as its canonical form, and anything missing or unrecognised
 * reads as `Pending` — the start of the lifecycle, never a status that grants
 * access or money.
 */
export function normalizeStatus(stored: string | undefined | null): BookingStatus {
  if (!stored) return 'Pending'
  const folded = fold(stored)
  const canonical = CANONICAL_BY_FOLDED.get(folded)
  if (canonical) return canonical
  return RETIRED_STATUSES[folded] ?? 'Pending'
}

// ----------------------------------------------------------------------------
// Transitions
// ----------------------------------------------------------------------------

/**
 * The legal transitions out of each Booking status.
 *
 * Deliberately a whitelist: anything not listed here is refused, so a surface
 * cannot invent a shortcut past the Admin's review (ADR-0001) or past payment
 * verification.
 *
 * `Expired` is reachable only from the statuses that are still waiting for
 * review — the Date hold is the claim a Booking places on its dates *while it
 * waits*, and it lasts 24 hours (CONTEXT.md § Date hold). Once the Admin has
 * approved, the dates are firmly held and no hold expiry can release them.
 */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  Pending: ['KYC Submitted', 'Rejected', 'Cancelled', 'Expired'],
  'KYC Submitted': ['Approved', 'Rejected', 'Cancelled', 'Expired'],
  Approved: ['Payment Pending', 'Rejected', 'Cancelled'],
  'Payment Pending': ['Payment Verified', 'Cancelled'],
  'Payment Verified': ['Reserved', 'Cancelled'],
  Reserved: ['Checked-In', 'Cancelled'],
  'Checked-In': ['Staying'],
  Staying: ['Checked-Out'],
  'Checked-Out': ['Completed'],
  // Terminal: nothing releases a finished, refused, cancelled or expired Booking.
  Completed: [],
  Rejected: [],
  Cancelled: [],
  Expired: [],
}

/** Can a Booking move from `from` to `to`? Unknown statuses can never move. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}
