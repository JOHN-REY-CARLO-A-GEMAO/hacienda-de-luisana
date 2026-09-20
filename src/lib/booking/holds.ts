// ----------------------------------------------------------------------------
// Booking lifecycle — the Date hold a Guest can read
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The countdown is the same fact everywhere it is shown, so the Guest's view and
// the Host's view cannot disagree about how long is left (ticket #12).
//
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/**
 * Read a Date hold's remaining time aloud.
 *
 * Rounds down: a Guest is never told they have time they do not have. Once
 * nothing is left the dates are released, which is the honest thing to say —
 * "0h 0m" reads like a clock that stopped rather than a hold that ran out.
 */
export function formatHoldCountdown(msRemaining: number): string {
  if (!(msRemaining > 0)) return 'Dates released'

  const hours = Math.floor(msRemaining / HOUR_MS)
  const minutes = Math.floor((msRemaining % HOUR_MS) / MINUTE_MS)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`

  const seconds = Math.floor((msRemaining % MINUTE_MS) / 1000)
  return `${minutes}m ${seconds}s`
}

/** An Accommodation as far as availability is concerned. */
export type UnitBearing = {
  id: string
  /** Units that can be held at once; absent means the whole Accommodation is one. */
  availableUnits?: number
}

/**
 * How many Bookings an Accommodation can hold at once.
 *
 * One, unless the Host has published more: the Main House is a single house, and
 * "Other / Ask Us" is not an Accommodation at all, so neither can be double-sold
 * on a unit count nobody wrote down.
 */
export function unitsForAccommodation(
  accommodationId: string,
  accommodations: readonly UnitBearing[],
): number {
  const found = accommodations.find((a) => a.id === accommodationId)
  return Math.max(1, found?.availableUnits ?? 1)
}
