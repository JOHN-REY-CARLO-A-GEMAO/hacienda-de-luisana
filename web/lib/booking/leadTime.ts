// Guest booking policy. The deployed setting is site_config/booking; the
// default here mirrors minimumBookingLeadTimeDays() in firestore.rules.
// Keep calendar dates separate from instants: a Guest's timezone is irrelevant.
import { DAY_MS } from './internal'

export const MINIMUM_BOOKING_LEAD_TIME_DAYS = 30
export const BOOKING_TIME_ZONE = 'Asia/Manila'

export type BookingDateValidation =
  | { ok: true }
  | { ok: false; code: 'MINIMUM_BOOKING_LEAD_TIME' | 'INVALID_CHECK_IN_DATE'; reason: string }

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
