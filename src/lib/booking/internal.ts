// ----------------------------------------------------------------------------
// Booking lifecycle — shared internals
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Date and money primitives the rest of the module shares. Not part of the
// module's interface: nothing here is re-exported from `src/lib/booking`.
//
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000

/** Parse an ISO `YYYY-MM-DD` date to a UTC timestamp, or null if it is not one. */
export function parseDate(iso: string | undefined | null): number | null {
  if (!iso) return null
  const time = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Parse an instant to a timestamp.
 *
 * Falls back to the current time rather than NaN: a corrupt `now` must not turn
 * every read-time rule into a crash on a Guest's screen.
 */
export function parseInstant(iso: string | number | Date): number {
  const time = typeof iso === 'number' ? iso : Date.parse(iso instanceof Date ? iso.toISOString() : iso)
  return Number.isNaN(time) ? Date.now() : time
}

/** Round to whole centavos — the smallest unit a Guest can actually send. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}
