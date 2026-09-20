// ----------------------------------------------------------------------------
// Booking lifecycle — dates, holds and availability
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Date-overlap, the 24-hour Date hold and its read-time expiry.
//
// ADR-0002 — nothing in the backend ever releases a hold, so every surface that
// answers "is this Accommodation free?" applies the same rule here.
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

import { normalizeStatus, type BookingStatus } from './statuses'
import { DAY_MS, parseDate, parseInstant } from './internal'

/**
 * Do two stays claim the same night?
 *
 * A stay owns the nights from its check-in date up to, but not including, its
 * check-out date — check-out is 12:00 NN and the next check-in is 2:00 PM the
 * same day, so a handover is not a clash. Unparseable dates never overlap: a
 * corrupt read must not silently block the calendar.
 */
export function datesOverlap(
  checkInA: string,
  checkOutA: string,
  checkInB: string,
  checkOutB: string,
): boolean {
  const inA = parseDate(checkInA)
  const outA = parseDate(checkOutA)
  const inB = parseDate(checkInB)
  const outB = parseDate(checkOutB)
  if (inA === null || outA === null || inB === null || outB === null) return false
  return inA < outB && inB < outA
}

/** Whole nights between two ISO dates; never negative, never zero-length. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const inMs = parseDate(checkIn)
  const outMs = parseDate(checkOut)
  if (inMs === null || outMs === null) return 1
  return Math.max(1, Math.round((outMs - inMs) / DAY_MS))
}

// ----------------------------------------------------------------------------
// Date holds
// ----------------------------------------------------------------------------

/** How long a submitted Booking holds its dates while it waits for review. */
export const DATE_HOLD_MS = DAY_MS

/**
 * The statuses whose Booking still claims its dates.
 *
 * The four terminal statuses are the ones that release them: completing a stay
 * returns the Accommodation to the pool, and Rejected / Cancelled / Expired all
 * release the dates as part of reaching that status (G1).
 */
const DATE_HOLDING_STATUSES: readonly BookingStatus[] = [
  'Pending',
  'KYC Submitted',
  'Approved',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Checked-In',
  'Staying',
  'Checked-Out',
]

/**
 * The statuses the Host has already committed dates to.
 *
 * A Booking still waiting for review holds its dates against *other Guests*
 * (they are the reason a search says "taken"), but it does not block another
 * Booking's approval: two Guests may queue for the same one-unit Accommodation
 * and the Host approves whichever they choose. Counting the queue at approval
 * would make a one-unit Accommodation unapprovable forever.
 */
const COMMITTED_STATUSES: readonly BookingStatus[] = [
  'Approved',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Checked-In',
  'Staying',
  'Checked-Out',
]

/**
 * The statuses whose Date hold still runs down: everything waiting for the
 * Host's review. Once a Booking is Approved the dates are firmly held, so no
 * hold expiry can release them (CONTEXT.md § Date hold, flow §2 step 6b).
 */
const EXPIRABLE_STATUSES: readonly BookingStatus[] = ['Pending', 'KYC Submitted']

/** The slice of a stored Booking the availability rules need. */
export type DateHoldFields = {
  status: BookingStatus | string
  hold_expires_at?: string | null
}

/** Does a Booking in this status claim its dates? */
export function holdsDates(status: BookingStatus): boolean {
  return DATE_HOLDING_STATUSES.includes(status)
}

/** Is this status still counting down its Date hold? */
export function isHoldExpirable(status: BookingStatus): boolean {
  return EXPIRABLE_STATUSES.includes(status)
}

/**
 * Has this Booking's Date hold run out, as at `now`?
 *
 * The hold is alive up to and including its expiry instant, and gone the
 * moment after it: a Guest watching a countdown that reaches zero is not told
 * their dates vanished a millisecond early.
 *
 * A Booking waiting for review with no recorded hold expiry reads as expired:
 * nothing in the backend ever releases a hold (ADR-0002), so an absent expiry
 * must not become a permanent claim on the dates.
 */
export function isHoldExpired(booking: DateHoldFields, now: string | number | Date = Date.now()): boolean {
  const status = normalizeStatus(booking.status)
  if (!isHoldExpirable(status)) return false
  if (!booking.hold_expires_at) return true
  return parseInstant(now) > parseInstant(booking.hold_expires_at)
}

/**
 * Milliseconds of Date hold a Guest has left, as at `now` — never negative.
 * A Booking that is no longer waiting for review has no hold counting down.
 */
export function holdMsRemaining(booking: DateHoldFields, now: string | number | Date = Date.now()): number {
  const status = normalizeStatus(booking.status)
  if (!isHoldExpirable(status) || !booking.hold_expires_at) return 0
  return Math.max(0, parseInstant(booking.hold_expires_at) - parseInstant(now))
}

/**
 * The status a Booking reads as, as at `now`.
 *
 * This is ADR-0002's read-time rule in one place: every surface that answers
 * "what state is this Booking in?" — the Guest's view, the Host's list, the
 * approval-time re-check — calls this instead of reading the stored field, so
 * no two surfaces can disagree about an expired hold. The stored document is
 * not rewritten by reading it.
 */
export function effectiveStatus(booking: DateHoldFields, now: string | number | Date = Date.now()): BookingStatus {
  const status = normalizeStatus(booking.status)
  return isHoldExpired(booking, now) ? 'Expired' : status
}

// ----------------------------------------------------------------------------
// Availability
// ----------------------------------------------------------------------------

/** The dates a request or a re-check is asking about. */
export type DateRange = {
  accommodation: string
  check_in: string
  check_out: string
}

/** A stored Booking as far as availability is concerned. */
export type HoldBearingBooking = DateRange & {
  id: string
  status: BookingStatus | string
  hold_expires_at?: string | null
}

export type AvailabilityOptions = {
  /** Read-time instant for the expiry rule. Defaults to the moment of the call. */
  now?: string | number | Date
  /**
   * How many units of the Accommodation can be held at once. Omitted means
   * availability is unknown, so nothing is reported as a conflict: the
   * Accommodation rate card is the Host's to publish, and this module invents
   * no numbers.
   */
  unitsAvailable?: number
  /** Booking to leave out — the approval-time re-check must not conflict with itself. */
  excludeId?: string
  /**
   * Count only the Bookings the Host has already committed the dates to, rather
   * than everything still holding them. This is what the approval-time re-check
   * uses (G2); a Guest-facing availability check leaves it off and sees the
   * queue as well.
   */
  forApproval?: boolean
}

/**
 * Which stored Bookings stand in the way of these dates?
 *
 * One rule, used at submit and at approval (G2). A Booking stands in the way
 * when it is for the same Accommodation, its nights overlap, it still holds its
 * dates as at `now`, and — for a multi-unit Accommodation — every unit is
 * already taken. Conflicts are returned in check-in order so a caller can show
 * the Guest the nearest clash first.
 */
export function findDateConflicts<T extends HoldBearingBooking>(
  request: DateRange,
  bookings: readonly T[],
  options: AvailabilityOptions = {},
): T[] {
  const { unitsAvailable, excludeId, forApproval } = options
  const now = options.now ?? Date.now()
  if (!unitsAvailable || unitsAvailable < 1) return []

  const overlapping = bookings.filter((booking) => {
    if (booking.id === excludeId) return false
    if (booking.accommodation !== request.accommodation) return false
    const status = effectiveStatus(booking, now)
    const counts = forApproval ? COMMITTED_STATUSES.includes(status) : holdsDates(status)
    if (!counts) return false
    return datesOverlap(request.check_in, request.check_out, booking.check_in, booking.check_out)
  })

  // One Booking takes one unit of its Accommodation: which of the two camping
  // units a Guest gets is the Host's to allocate, and is not modelled here.
  if (overlapping.length < unitsAvailable) return []

  return [...overlapping].sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0))
}

/** Are these dates free, by the same rule `findDateConflicts` applies? */
export function isAvailable<T extends HoldBearingBooking>(
  request: DateRange,
  bookings: readonly T[],
  options: AvailabilityOptions = {},
): boolean {
  return findDateConflicts(request, bookings, options).length === 0
}

/** How far either side of the requested dates to look for a free window. */
const DEFAULT_SEARCH_DAYS = 60

export type AlternativeDateOptions = AvailabilityOptions & {
  /** How many windows to offer. Default 3 — enough to choose from, not a list to trawl. */
  limit?: number
  /** Days to search on either side of the requested check-in. Default 60. */
  searchDays?: number
}

/**
 * The nearest free windows of the same length, when the Guest's dates are taken.
 *
 * Used by the clash path: refusing an approval or a request is only half an
 * answer, and the other half is somewhere the Guest could go instead. Windows
 * come back nearest-first in either direction, with the later one winning a tie
 * because postponing a trip is easier than bringing it forward. Empty when the
 * requested dates are free — there is nothing to suggest.
 */
export function suggestAlternativeDates<T extends HoldBearingBooking>(
  request: DateRange,
  bookings: readonly T[],
  options: AlternativeDateOptions = {},
): DateRange[] {
  const limit = options.limit ?? 3
  const searchDays = options.searchDays ?? DEFAULT_SEARCH_DAYS
  const nights = nightsBetween(request.check_in, request.check_out)
  const requested = parseDate(request.check_in)
  if (requested === null || nights < 1 || limit < 1) return []

  // Free already: suggesting elsewhere would only invite the Host to move a
  // Guest who does not need moving.
  if (findDateConflicts(request, bookings, options).length === 0) return []

  const candidates: { range: DateRange; distance: number; offset: number }[] = []
  for (let offset = -searchDays; offset <= searchDays; offset += 1) {
    if (offset === 0) continue
    const checkIn = requested + offset * DAY_MS
    const range: DateRange = {
      accommodation: request.accommodation,
      check_in: isoDate(checkIn),
      check_out: isoDate(checkIn + nights * DAY_MS),
    }
    if (findDateConflicts(range, bookings, options).length > 0) continue
    candidates.push({ range, distance: Math.abs(offset), offset })
  }

  return candidates
    .sort((a, b) => a.distance - b.distance || b.offset - a.offset)
    .slice(0, limit)
    .map((candidate) => candidate.range)
}

/** Local-date ISO string (YYYY-MM-DD) for a UTC ms timestamp. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
