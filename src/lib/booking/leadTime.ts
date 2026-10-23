// Guest booking policy. The deployed setting is site_config/booking; the
// default here mirrors minimumBookingLeadTimeDays() in firestore.rules.
// Keep calendar dates separate from instants: a Guest's timezone is irrelevant.
import { DAY_MS } from './internal'

export const MINIMUM_BOOKING_LEAD_TIME_DAYS = 30
export const BOOKING_TIME_ZONE = 'Asia/Manila'

export type BookingDateValidation =
  | { ok: true }
  | {
      ok: false
      code: 'MINIMUM_BOOKING_LEAD_TIME' | 'INVALID_CHECK_IN_DATE' | 'BOOKING_WINDOW_CLOSED'
      reason: string
    }

/**
 * No Admin cut-off. The Hacienda keeps every future date open for check-in.
 *
 * A cut-off is a *calendar date*, not a duration. "24 months from whenever the
 * page was opened" would move under a Guest who leaves the tab open past
 * midnight, and a Guest who reloads could be told a date they were just shown
 * is closed. The Admin owns the last night and moves it as the season does.
 */
export const NO_BOOKINGS_CUTOFF = ''

const businessDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: BOOKING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's calendar date at the Hacienda, not in UTC or the browser's zone. */
export function bookingBusinessDate(now = new Date()): string {
  const parts = businessDateFormatter.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** UTC is used only for arithmetic on an already resolved Manila calendar date. */
export function minimumCheckInDate(
  now = new Date(),
  minimumLeadTimeDays = MINIMUM_BOOKING_LEAD_TIME_DAYS,
): string {
  const today = Date.parse(`${bookingBusinessDate(now)}T00:00:00Z`)
  return new Date(today + minimumLeadTimeDays * DAY_MS).toISOString().slice(0, 10)
}

/** Same fallback as the rules; a setting is a positive, whole number of days. */
export function configuredBookingLeadTimeDays(data: unknown): number {
  const days = (data as { minimumBookingLeadTimeDays?: unknown } | null)?.minimumBookingLeadTimeDays
  return typeof days === 'number' && Number.isInteger(days) && days > 0
    ? days
    : MINIMUM_BOOKING_LEAD_TIME_DAYS
}

/**
 * The Admin's last bookable check-in date, or `NO_BOOKINGS_CUTOFF` for "open".
 *
 * The value is the **last night** a Guest may start, not the last checkout: a
 * Booking that checks in on the last night still checks out the following day.
 * A malformed or impossible setting reads as "no cut-off" — the same forgiving
 * fallback the lead-time setting uses — and `firestore.rules` refuses to store
 * one, so the open fallback is only reachable for a hand-edited document.
 */
export function configuredBookingsOpenUntil(data: unknown): string {
  const raw = (data as { bookingsOpenUntil?: unknown } | null)?.bookingsOpenUntil
  if (typeof raw !== 'string' || raw === '' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NO_BOOKINGS_CUTOFF
  const time = Date.parse(`${raw}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== raw) return NO_BOOKINGS_CUTOFF
  return raw
}

/** The checkout that belongs to the last bookable night. */
export function lastBookableCheckOut(bookingsOpenUntil: string): string {
  if (!bookingsOpenUntil) return ''
  return new Date(Date.parse(`${bookingsOpenUntil}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
}

export function bookingsOpenUntilMessage(openUntil: string): string {
  return `Check-in is open only through ${openUntil}. Please choose a check-in on or before that date.`
}

/** Is this check-in past the Admin's cut-off? An absent cut-off is never past. */
export function isBeyondBookingWindow(checkInDate: string, bookingsOpenUntil = NO_BOOKINGS_CUTOFF): boolean {
  return bookingsOpenUntil !== NO_BOOKINGS_CUTOFF && checkInDate > bookingsOpenUntil
}

export function minimumBookingLeadTimeMessage(days = MINIMUM_BOOKING_LEAD_TIME_DAYS): string {
  return `This date is not available for advance booking. Please choose a check-in date at least ${days} days from today.`
}

/** An additional guest-creation constraint, never an availability decision. */
export function validateMinimumBookingLeadTime(
  checkInDate: string,
  now = new Date(),
  minimumLeadTimeDays = MINIMUM_BOOKING_LEAD_TIME_DAYS,
): BookingDateValidation {
  const time = typeof checkInDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(checkInDate)
    ? Date.parse(`${checkInDate}T00:00:00Z`)
    : NaN
  // Parsing alone would normalize February 30 into March: refuse it instead.
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== checkInDate) {
    return { ok: false, code: 'INVALID_CHECK_IN_DATE', reason: 'Check-in is not a valid calendar date' }
  }
  if (checkInDate < minimumCheckInDate(now, minimumLeadTimeDays)) {
    return { ok: false, code: 'MINIMUM_BOOKING_LEAD_TIME', reason: minimumBookingLeadTimeMessage(minimumLeadTimeDays) }
  }
  return { ok: true }
}

/**
 * The one date gate a Guest-facing surface should call.
 *
 * Lead time answers "how soon"; the booking window answers "how far". A Guest
 * can fail either one and the two are not interchangeable: a date may be well
 * past the lead time and still outside the season the Admin has opened. Keeping
 * them in one function means a caller cannot apply the 30-day rule and forget
 * the cut-off, which is exactly how a closed date would leak back into the
 * calendar after an Admin sets one.
 */
export function validateBookableCheckIn(
  checkInDate: string,
  now = new Date(),
  minimumLeadTimeDays = MINIMUM_BOOKING_LEAD_TIME_DAYS,
  bookingsOpenUntil = NO_BOOKINGS_CUTOFF,
): BookingDateValidation {
  const lead = validateMinimumBookingLeadTime(checkInDate, now, minimumLeadTimeDays)
  if (!lead.ok) return lead
  if (isBeyondBookingWindow(checkInDate, bookingsOpenUntil)) {
    return { ok: false, code: 'BOOKING_WINDOW_CLOSED', reason: bookingsOpenUntilMessage(bookingsOpenUntil) }
  }
  return { ok: true }
}
