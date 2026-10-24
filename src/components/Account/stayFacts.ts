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
  return accommodationOf(id)?.name ?? id
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
