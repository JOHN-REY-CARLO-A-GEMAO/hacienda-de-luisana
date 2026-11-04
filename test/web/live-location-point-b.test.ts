// ----------------------------------------------------------------------------
// Point B: "where is the Guest relative to the hacienda?"
//
// The stream carries one point, and one point answers nothing on its own. These
// cases pin the two things that turn it into an answer a person can act on — a
// bearing and a straight-line distance — and the three things that keep the
// answer honest:
//
//   * it is never labelled as a driving distance;
//   * "at the property" is a statement about the *reading*, not an arrival
//     announcement, and it cannot flicker;
//   * no coordinate leaves the app to produce it.
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AT_PROPERTY_M,
  STRAIGHT_LINE_CAVEAT,
  bearingDegrees,
  bearingLabel,
  labelForDistance,
  proximitySentence,
  proximityTo,
} from '../../src/lib/liveLocationPolicy'
import { directionsUrl, evaluateReader } from '../../src/lib/liveLocationReader'

/** The hacienda's committed pin (src/config/site.ts). */
const HACIENDA = { lat: 14.1754304, lng: 121.519389 }
const SECRET = 'a'.repeat(32)
const T0 = Date.parse('2026-10-01T09:00:00.000Z')

/** A point `metres` away from the hacienda on a given bearing. */
function offsetBy(metres: number, bearingDeg: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const R = 6_371_008.8
  const from = HACIENDA
  const brng = toRad(bearingDeg)
  const lat1 = toRad(from.lat)
  const lng1 = toRad(from.lng)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(metres / R) + Math.cos(lat1) * Math.sin(metres / R) * Math.cos(brng),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(metres / R) * Math.cos(lat1),
      Math.cos(metres / R) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 }
}

describe('the bearing from a Guest to the Hacienda', () => {
  it('points the way a compass does: north, east, south, west', () => {
    // Bearing is measured FROM the Guest TO the hacienda, which is the direction
    // the owner thinks in: "they are coming from the north" means the bearing
    // points south.
    expect(bearingDegrees({ lat: HACIENDA.lat + 0.05, lng: HACIENDA.lng }, HACIENDA)).toBeCloseTo(180, 0)
    expect(bearingDegrees({ lat: HACIENDA.lat - 0.05, lng: HACIENDA.lng }, HACIENDA)).toBeCloseTo(0, 0)
    expect(bearingDegrees({ lat: HACIENDA.lat, lng: HACIENDA.lng - 0.05 }, HACIENDA)).toBeCloseTo(90, 0)
    expect(bearingDegrees({ lat: HACIENDA.lat, lng: HACIENDA.lng + 0.05 }, HACIENDA)).toBeCloseTo(270, 0)
  })

  it('rounds to the eight points a GPS fix can justify', () => {
    expect(bearingLabel(0).point).toBe('N')
    expect(bearingLabel(44).point).toBe('NE')
    expect(bearingLabel(90).point).toBe('E')
    expect(bearingLabel(135).point).toBe('SE')
    expect(bearingLabel(180).point).toBe('S')
    expect(bearingLabel(225).point).toBe('SW')
    expect(bearingLabel(270).point).toBe('W')
    expect(bearingLabel(315).point).toBe('NW')
    // Wrap-around: 350° is north, not north-west, and negatives are the same
    // direction as their positive equivalents.
    expect(bearingLabel(350).point).toBe('N')
    expect(bearingLabel(-45).point).toBe('NW')
    expect(bearingLabel(360).deg).toBe(0)
    expect(bearingLabel(45).full).toBe('north-east')
  })
})

describe('the distance is said the way a person reads it', () => {
  it('uses metres under a kilometre and one decimal above', () => {
    expect(labelForDistance(42)).toBe('~40 m')
    expect(labelForDistance(380)).toBe('~400 m')
    expect(labelForDistance(1_840)).toBe('~1.8 km')
    expect(labelForDistance(23_400)).toBe('~23.4 km')
  })

  it('never prints a number it does not have', () => {
    expect(labelForDistance(Number.NaN)).toBe('an unknown distance')
    expect(labelForDistance(-5)).toBe('an unknown distance')
    // Even a fix practically on top of the pin keeps a floor, so a rounding
    // artefact never reads as "0 m".
    expect(labelForDistance(1)).toBe('~10 m')
  })
})

describe('"at the property" is about the reading, not an announcement', () => {
  it('is true inside the threshold', () => {
    const here = proximityTo(offsetBy(20, 90), HACIENDA, 8)
    expect(here.kind).toBe('at-property')
    expect(proximitySentence(here)).toMatch(/At the Hacienda/)
  })

  it('widens to the accuracy the device reports, so it cannot flicker', () => {
    // A phone under a roof reports ±200 m. A "310 m away" claim from a reading
    // that admits ±200 m is not a claim worth drawing, and the next tick would
    // flip it anyway.
    expect(proximityTo(offsetBy(100, 0), HACIENDA, 200).kind).toBe('at-property')
    // With a good fix the same 100 m is a genuine distance.
    expect(proximityTo(offsetBy(100, 0), HACIENDA, 8).kind).toBe('away')
  })

  it('uses the hard floor, not only the accuracy, so a very good fix still says "here"', () => {
    expect(AT_PROPERTY_M).toBe(50)
    expect(proximityTo(offsetBy(45, 0), HACIENDA, 5).kind).toBe('at-property')
    expect(proximityTo(offsetBy(4_500, 0), HACIENDA, 5).kind).toBe('away')
  })

  it('never ends a session or claims an arrival, because it is only a label', () => {
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocationPolicy.ts'), 'utf8')
    const block = source.slice(source.indexOf('export function proximityTo'), source.indexOf('/** Initial bearing'))
    // No timer, no transition, no callback: the caller decides nothing from it.
    // (`isExpired` is absent from the function body; the slice runs to the next
    // doc comment, so it is asserted on the body rather than the whole module.)
    expect(block).not.toContain('stopSharing')
    expect(block).not.toContain('setTimeout')
    expect(block).not.toContain('endSession')
  })
})

describe('the proximity a reader draws', () => {
  const session = {
    guest_uid: 'guest-1',
    conversation_id: 'booking-bk_1',
    active: true,
    started_at_ms: T0,
    expires_at_ms: T0 + 30 * 60_000,
    duration_minutes: 30,
    stream_secret: SECRET,
  }
  const fix = (over: Record<string, unknown> = {}) => ({
    lat: HACIENDA.lat + 0.02,
    lng: HACIENDA.lng,
    accuracy_m: 10,
    at_ms: T0 + 3_000,
    seq: 1,
    guest_uid: 'guest-1',
    conversation_id: 'booking-bk_1',
    session_secret: SECRET,
    expires_at_ms: T0 + 30 * 60_000,
    ...over,
  })

  it('carries point B through when the caller gives one', () => {
    const frame = evaluateReader({ session, fix: fix(), nowMs: T0 + 4_000, destination: HACIENDA })
    expect(frame.kind).toBe('live')
    if (frame.kind !== 'live') throw new Error('unreachable')
    expect(frame.proximity?.kind).toBe('away')
    if (frame.proximity?.kind !== 'away') throw new Error('unreachable')
    // Two hundredths of a degree of latitude is about 2.2 km, due south.
    expect(frame.proximity.distanceM).toBeGreaterThan(2_000)
    expect(frame.proximity.bearing.point).toBe('S')
  })

  it('claims nothing when the caller has no point B', () => {
    // The reader must not invent the hacienda's address: it is passed in.
    const frame = evaluateReader({ session, fix: fix(), nowMs: T0 + 4_000 })
    expect(frame.kind).toBe('live')
    if (frame.kind !== 'live') throw new Error('unreachable')
    expect(frame.proximity).toBeNull()
  })

  it('claims nothing from a position that is not a position', () => {
    expect(proximityTo(null, HACIENDA).kind).toBe('unknown')
    expect(proximityTo({ lat: Number.NaN, lng: 121 }, HACIENDA).kind).toBe('unknown')
    expect(proximityTo({ lat: 999, lng: 121 }, HACIENDA).kind).toBe('unknown')
    expect(proximitySentence({ kind: 'unknown' })).toMatch(/cannot be worked out/i)
  })
})

describe('the driving distance is a link, never a request', () => {
  it('puts both points in a URL a person has to press', () => {
    const url = directionsUrl({ lat: 14.19, lng: 121.53 }, HACIENDA)
    expect(url).toContain('openstreetmap.org/directions')
    expect(url).toContain('14.19,121.53')
    expect(url).toContain(`${HACIENDA.lat},${HACIENDA.lng}`)
  })

  it('makes no routing call anywhere in the app', () => {
    // The privacy property depends on this: no provider learns a Guest's live
    // position without a person choosing to open a tab. A `fetch` to a routing
    // host, or a tile server, would break it silently.
    for (const file of [
      'src/lib/liveLocationReader.ts',
      'src/lib/liveLocation.ts',
      'src/pages/AdminLiveLocationPage.tsx',
    ]) {
      const source = readFileSync(join(__dirname, '../..', file), 'utf8')
      expect(source, `${file} must not call a routing service`).not.toMatch(
        /(fetch|axios)\([^)]*(osrm|openrouteservice|directions|googleapis|mapbox|here\.com)/i,
      )
      expect(source, `${file} must not embed a map`).not.toContain('<iframe')
    }
  })

  it('keeps the caveat next to the number, and says what it is not', () => {
    // The sentence an owner most easily misreads is the distance. The caveat is
    // exported so both apps say the same thing, and it names the thing the
    // number is not.
    expect(STRAIGHT_LINE_CAVEAT).toMatch(/straight-line/i)
    expect(STRAIGHT_LINE_CAVEAT).toMatch(/not the driving route/i)
  })
})
