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
 * `Confirmed` is retired: a paid stay used to read as `Reserved`.
 * `KYC Submitted` is retired with Government ID KYC.
 * `Approved` is the confirmation the Admin writes when they accept a
 * downpayment screenshot. A Booking is not confirmed before that decision
 * (ADR-0012). Historical documents stored as `Approved` with no proof and no
 * verified payment still read as `Payment Pending` — see `interpretStoredStatus`.
 */

export const BOOKING_STATUSES = [
  'Pending',
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
  // Government ID KYC removed: pre-review documents read as `Pending` again.
  kycsubmitted: 'Pending',
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

/**
 * Read a stored Booking's status, including the one legacy spelling that a
 * string alone cannot settle.
 *
 * Documents written as `Approved` before the downpayment-first change
 * (ADR-0012) were waiting for payment and carried no proof. Those still read
 * as `Payment Pending`. A Booking the Admin has accepted under the current
 * rule carries the screenshot and `payment_status: verified`, and reads as
 * `Approved`.
 */
export function interpretStoredStatus(
  stored: string | undefined | null,
  hints?: { payment_status?: string | null; payment_proof_url?: string | null },
): BookingStatus {
  const normalized = normalizeStatus(stored)
  if (!hints || fold(stored ?? '') !== 'approved') return normalized
  const proven = Boolean(hints.payment_proof_url?.trim()) && hints.payment_status === 'verified'
  return proven ? 'Approved' : 'Payment Pending'
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
  // The confirmation decision (ADR-0012): the Admin accepts the downpayment
  // screenshot, or declines it. Nothing else confirms a Booking.
  Pending: ['Approved', 'Rejected', 'Cancelled', 'Expired'],
  // Confirmed. The stay can begin, or the Guest / Admin can withdraw it.
  Approved: ['Checked-In', 'Cancelled'],
  // Historical bookings that were opened for payment before ADR-0012.
  'Payment Pending': ['Payment Verified', 'Rejected', 'Cancelled'],
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
