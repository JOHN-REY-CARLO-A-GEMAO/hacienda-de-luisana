import { ACCOMMODATIONS } from '../../config/site'
import type { Booking } from '../../lib/storage'

/**
 * The readings a signed-in page needs about one Booking, in one place.
 *
 * These were spelled out again in `AccountPage`, `BookingStatusPage` and the
 * invoice — four copies of `ACCOMMODATIONS.find(...)`, three of a peso
 * formatter, two of a day count. They are presentation only: every figure comes
 * off the stored Booking, and nothing here decides what a Booking is allowed to
 * be. That stays with `src/lib/booking`.
 */

/** The Accommodation record behind a Booking's `accommodation` id. */
export function accommodationOf(id: string) {
  return ACCOMMODATIONS.find((accommodation) => accommodation.id === id)
}

export function accommodationName(id: string): string {
  const known = accommodationOf(id)
  if (known) return known.name
  // A Booking can name an Accommodation the catalogue has since retired. A Guest
  // should read "House A Camping", not the raw key that happens to be stored.
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/**
 * The photograph for a Booking's accommodation.
 *
 * A booking without one falls back to the Hacienda's own dusk shot — the same
 * frame the homepage hero uses — so a Guest page never shows a broken or empty
 * image slot. Returns `null` only if there is no image anywhere at all.
 */
export function accommodationImage(id: string): string | null {
  const own = accommodationOf(id)?.images?.[0]
  return own ?? ACCOMMODATIONS.find((a) => a.images?.[0])?.images?.[0] ?? null
}

/** What a Guest calls their Booking: the reference they were emailed. */
export function bookingReference(booking: Booking): string {
  return booking.ref_id || booking.id.slice(0, 8).toUpperCase()
}

/** Whole days from today to check-in. Negative once the stay has begun. */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const target = new Date(dateStr)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

/** "Fri 12 Dec" — a date a Guest can place in a week without parsing ISO. */
export function shortDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "6 Oct 2026" — a date as a document writes it: no weekday, year included. */
export function calendarDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "December 2026" — for "member since" and other month-precision facts. */
export function monthYear(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

/** Peso, no centavos: the amounts on a Guest page are whole pesos. */
export function peso(amount: number): string {
  return `₱${amount.toLocaleString('en-PH')}`
}

/** `1 night` / `3 nights`, so no sentence has to spell the plural itself. */
export function nightsPhrase(nights: number): string {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`
}

/** `1 guest` / `9 guests`. */
export function guestsPhrase(guests: number): string {
  return `${guests} ${guests === 1 ? 'guest' : 'guests'}`
}

/**
 * How many nights a Booking is for.
 *
 * A stay is counted in nights — that is what the rate is charged in and what a
 * Guest plans around — so the page never asks anybody to subtract two dates.
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = new Date(checkIn)
  const to = new Date(checkOut)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000))
}

export type StaySpan = {
  /** For the date margin: "Nov", or "Nov – Dec" when the stay crosses one. */
  month: string
  /** For the date margin: "20 – 22". */
  days: string
  /** For the date margin: "2026", or both years when it crosses one. */
  year: string
  /** The full range, written out: "20 – 22 November 2026". */
  long: string
  /** "Friday to Sunday" — the shape of the week the stay sits in. */
  weekdays: string
}

/**
 * The two readings of one date range: the margin's compact stamp and the
 * sentence the masthead sets at display size.
 *
 * Written by hand rather than through `Intl.formatRange` because the range is
 * the point: a Guest reads "20 – 22 November", not "November 20 – November 22",
 * and a stay that crosses a month or a year says so instead of repeating the
 * year twice.
 */
export function staySpan(checkIn: string, checkOut: string): StaySpan {
  const from = new Date(checkIn)
  const to = new Date(checkOut)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { month: '', days: checkIn, year: '', long: `${checkIn} → ${checkOut}`, weekdays: '' }
  }

  const month = (date: Date, style: 'short' | 'long') =>
    date.toLocaleDateString('en-PH', { month: style })
  const weekday = (date: Date) => date.toLocaleDateString('en-PH', { weekday: 'long' })

  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
  const sameYear = from.getFullYear() === to.getFullYear()

  const long = sameMonth
    ? `${from.getDate()} – ${to.getDate()} ${month(from, 'long')} ${from.getFullYear()}`
    : sameYear
      ? `${from.getDate()} ${month(from, 'long')} – ${to.getDate()} ${month(to, 'long')} ${from.getFullYear()}`
      : `${from.getDate()} ${month(from, 'long')} ${from.getFullYear()} – ${to.getDate()} ${month(to, 'long')} ${to.getFullYear()}`

  return {
    month: sameMonth ? month(from, 'short') : `${month(from, 'short')} – ${month(to, 'short')}`,
    days: `${from.getDate()} – ${to.getDate()}`,
    year: sameYear ? String(from.getFullYear()) : `${from.getFullYear()} – ${to.getFullYear()}`,
    long,
    weekdays: `${weekday(from)} to ${weekday(to)}`,
  }
}

/**
 * The line that says how far away a stay is, or `null` once it has no useful
 * answer (a stay that ended, or a booking that never had dates).
 */
export function countdownLabel(checkIn: string, checkOut: string, now: Date = new Date()): string | null {
  const days = daysUntil(checkIn, now)
  if (days > 1) return `${days} days away`
  if (days === 1) return 'Check-in tomorrow'
  if (days === 0) return 'Check-in today'
  if (daysUntil(checkOut, now) >= 0) return 'You are staying now'
  return null
}

/**
 * The five stages a Guest experiences, in order.
 *
 * A Booking's canonical statuses are the Admin's vocabulary and there are twelve
 * of them; a Guest is never waiting to find out which. This collapses them onto
 * the five questions a Guest actually asks — was it received, was it accepted,
 * is it paid, am I there, is it over — and it is a real sequence, which is what
 * licenses it to be drawn as one.
 */
export const STAY_STAGES = ['Requested', 'Reviewed', 'Paid', 'Your stay', 'Complete'] as const

const STAGE_INDEX: Record<string, number> = {
  Pending: 0,
  Approved: 1,
  'Payment Pending': 1,
  'Payment Verified': 2,
  Reserved: 2,
  'Checked-In': 3,
  Staying: 3,
  'Checked-Out': 4,
  Completed: 4,
}

/**
 * The stage a status sits on, or `null` when the Booking ended without a stay.
 *
 * `Rejected`, `Cancelled` and `Expired` are not earlier points on the same line:
 * drawing them as "stage 0 of 5" would tell a Guest they are still in progress.
 * They get their own notice instead.
 */
export function stageIndex(status: string): number | null {
  return STAGE_INDEX[status] ?? null
}

export const isClosedWithoutStay = (status: string): boolean =>
  status === 'Rejected' || status === 'Cancelled' || status === 'Expired'
