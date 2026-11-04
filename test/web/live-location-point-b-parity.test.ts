// ----------------------------------------------------------------------------
// Point B exists twice, and must not drift.
//
// `src/lib/liveLocationPolicy.ts` is the canonical implementation: it has the
// unit tests, and both clients answer to the same rules. The Admin's Flutter app
// cannot import TypeScript, so `lib/core/live_location/proximity.dart` is a
// hand-written mirror of it — every constant, every rounding rule, every
// sentence.
//
// A mirror with no test is a fork waiting to happen, and the failure mode is
// quiet in the worst way: the app and the website would show the same Guest at
// two different distances, and the owner would have to decide which screen to
// believe. This suite reads both files and refuses to let them disagree.
//
// It is a source-invariant test on purpose. It cannot run Dart — there is no
// Flutter SDK in this environment — so it checks what a drifting copy gets wrong
// first: a threshold value, a rounding rule, the words, and where the numbers
// come from.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AT_PROPERTY_M, STRAIGHT_LINE_CAVEAT } from '../../src/lib/liveLocationPolicy'

const read = (relative: string) => readFileSync(join(__dirname, '../..', relative), 'utf8')

const web = read('src/lib/liveLocationPolicy.ts')
const dart = read('lib/core/live_location/proximity.dart')
const panel = read('lib/views/inbox/live_location_panel.dart')

describe('the Dart mirror of point B agrees with the web module', () => {
  it('uses the same thresholds the web module actually exports', () => {
    // Read the real constant rather than re-typing it, so this fails on a change
    // to either side.
    expect(web).toContain(`export const AT_PROPERTY_M = ${AT_PROPERTY_M}`)
    expect(dart).toContain(`const double kAtPropertyM = ${AT_PROPERTY_M}`)

    expect(web).toContain('const EARTH_RADIUS_M = 6_371_008.8')
    expect(dart).toContain('const double kEarthRadiusM = 6371008.8')

    // The app's own "still nearby" display threshold, which the web page does
    // not have — recorded here so a change to it is a deliberate change.
    expect(dart).toContain('const double kNearbyM = 1500')
  })

  it('says "at the property" the same way, and about the same thing', () => {
    const sentence = 'At the Hacienda — within the accuracy of the reading.'
    expect(web).toContain(sentence)
    expect(dart).toContain(sentence)
  })

  it('falls back to the same sentence when the position is unusable', () => {
    const sentence = 'The distance from the Hacienda cannot be worked out from this position.'
    expect(web).toContain(sentence)
    expect(dart).toContain(sentence)
  })

  it('rounds a distance the same way, including the tilde', () => {
    // Metres below a kilometre, one decimal above, never a bare exact number:
    // a GPS fix does not support that precision.
    expect(web).toContain('`~${Math.max(10, rounded)} m`')
    expect(web).toContain('`~${(metres / 1_000).toFixed(1)} km`')
    expect(dart).toContain("'~${math.max(10, rounded)} m'")
    expect(dart).toContain("'~${(metres / 1000).toStringAsFixed(1)} km'")
  })

  it('uses the same eight compass points and the same words', () => {
    // 22.5° sectors centred on each point: 350° reads as north, not north-west.
    for (const word of ['north', 'north-east', 'south-east', 'south-west', 'north-west']) {
      expect(web).toContain(`'${word}'`)
      expect(dart).toContain(`'${word}'`)
    }
    expect(web).toContain('Math.round(wrapped / 45)')
    expect(dart).toContain('(wrapped / 45).round()')
  })

  it('carries the straight-line caveat in the same words', () => {
    // The sentence that stops "~1.8 km" being read as a drive. Rendered as
    // visible text on both surfaces, never a tooltip and never a hover.
    expect(web).toContain(STRAIGHT_LINE_CAVEAT)
    expect(dart).toContain(STRAIGHT_LINE_CAVEAT)
    expect(panel).toContain('kStraightLineCaveat')
  })
})

describe('the Admin panel measures from the hacienda, never from itself', () => {
  it('is rendered, not merely defined', () => {
    // A helper nothing calls is a helper that rots.
    expect(panel).toContain('_ProximityStrip(')
    expect(panel).toContain('proximityTo(')
  })

  it("takes point B from the app's own hacienda constant", () => {
    // The hacienda's pin, already in the app for the directions link. Not a
    // second copy, and not the Admin's own position.
    expect(panel).toContain('AppConstants.resortLatitude')
    expect(panel).toContain('AppConstants.resortLongitude')
    expect(panel).not.toMatch(/\b14\.1754304\b/)
    expect(panel).not.toMatch(/\b121\.519389\b/)
  })

  it('never asks the Admin for their own location', () => {
    // The single most important property of point B: the answer must be the
    // same for an owner sitting in Manila as for one standing at the gate. Any
    // geolocation call in this panel would break that, silently.
    expect(panel).not.toContain('Geolocator')
    expect(panel).not.toContain('geolocation')
    expect(panel).not.toContain('getCurrentPosition')
    expect(panel).not.toContain('positionStream')
  })

  it('never presents the distance as a route or an arrival', () => {
    // The words that would turn a measurement into a promise.
    expect(panel).not.toMatch(/\bETA\b|arriving in|minutes away by road|driving distance/)
    expect(dart).not.toMatch(/\bETA\b|arriving in|minutes away by road|driving distance/)
  })
})
