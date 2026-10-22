// GENERATED FILE — DO NOT EDIT.
//
// @ts-nocheck — deliberate. This copy is *transpiled* here and *checked* where
// it is authored: `npx tsc -b` type-checks src/lib/booking under the web
// project's own settings, and `npm test` runs its tests. The Functions project
// sets `noUncheckedIndexedAccess`, which this module was not written against,
// and re-checking a mirror is how a generated file ends up being "fixed" here
// and drifted from the source. The freshness of the copy is what is enforced,
// by functions/test/booking-sync.test.ts.
// Source: src/lib/booking/<this file>.
// Regenerate with `npm run sync:pricing`; `npm run check:pricing` proves it is current.
// The Functions bundle cannot import the web tree at runtime, so the canonical
// pricing module is mirrored here. Change the arithmetic in src/lib/booking and
// re-sync — never edit this copy.

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

/** Parse a real ISO `YYYY-MM-DD` date to a UTC timestamp, or null otherwise. */
export function parseDate(iso: string | undefined | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const time = Date.parse(`${iso}T00:00:00Z`)
  // JavaScript normalises impossible dates (2026-02-30 → 2 March). A date used
  // for inventory must round-trip exactly or corrupt data could paint the wrong
  // night as free/occupied.
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) return null
  return time
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
