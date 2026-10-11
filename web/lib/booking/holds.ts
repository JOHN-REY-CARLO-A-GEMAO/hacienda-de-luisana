// ----------------------------------------------------------------------------
// Booking lifecycle — the Date hold a Guest can read
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The countdown is the same fact everywhere it is shown, so the Guest's view and
// the Admin's view cannot disagree about how long is left (ticket #12).
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
  /**
   * Units that can be held at once; absent means the whole Accommodation is one.
   *
   * The build-time catalogue figure. The published rates document is preferred
   * where there is one — see `unitsForAccommodation`.
   */
  availableUnits?: number
}

/**
 * How many Bookings an Accommodation can hold at once.
 *
 * Read from the published rates document's `available_units` when one is
 * published, because that is where the Admin states a Accommodation's physical
 * inventory and both apps read it from there. The build-time catalogue is the
 * fallback for demo mode and for a document published before the field existed.
 *
 * One unit is the floor, never zero: an Accommodation nobody published a unit
 * count for is not a number of units, so it cannot be double-sold on a figure
 * that was never written down.
 *
 * Distinct from `units_per_booking`, which is how many units one Booking takes.
 * The A-House is two units and one unit per Booking, and the two must not be
 * read as one number.
 */
export function unitsForAccommodation(
  accommodationId: string,
  accommodations: readonly UnitBearing[],
  published?: { accommodations?: Record<string, { available_units?: number }> } | null,
): number {
  const publishedUnits = published?.accommodations?.[accommodationId]?.available_units
  if (Number.isInteger(publishedUnits) && (publishedUnits as number) >= 1) {
    return publishedUnits as number
  }
  const found = accommodations.find((a) => a.id === accommodationId)
  return Math.max(1, found?.availableUnits ?? 1)
}
