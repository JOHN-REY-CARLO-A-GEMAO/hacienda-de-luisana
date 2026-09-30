// ----------------------------------------------------------------------------
// Live location: the policy, and the two stores it refuses to blur together.
//
// The feature's whole claim is that a Guest's position is never a record. These
// cases are where that claim is either true or a sentence in a document:
//
//   - a fix is sent on a cadence, not on every GPS tick
//   - a session is bounded to an hour whatever the browser asked for
//   - the stream node expires with the session, and the rules refuse a write
//     past it, so a stopped session cannot be revived by a stale callback
//   - an Admin is shown a node only when its secret matches the consented
//     Firestore session, and only while that session is active and unexpired
//   - nothing anywhere accepts a coordinate in Firestore
//
// `firestore.rules` and `database.rules.json` hold the other halves; the rules
// suites are `test/rules/firestore-rules.test.ts` and
// `test/web/realtime-database-rules.test.ts`.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MAX_SHARE_MINUTES,
  MIN_PUBLISH_DISTANCE_M,
  MIN_PUBLISH_INTERVAL_MS,
  SHARE_DURATIONS,
  checkFix,
  chooseDuration,
  distanceM,
  expiryFor,
  formatAge,
  formatCountdown,
  isExpired,
  isStale,
  newSessionSecret,
  secondsLeft,
  shouldPublishFix,
  startFailureMessage,
  type LocationFix,
  type LocationSession,
} from '../../src/lib/liveLocationPolicy'
import { LOCATION_SESSIONS_COLLECTION, LIVE_LOCATION_PATH, canShareLocation } from '../../src/lib/liveLocation'

const T0 = Date.parse('2026-10-01T09:00:00.000Z')

/**
 * The object literal `publishFix` hands to the Realtime Database, as source.
 *
 * Read as text on purpose: `publishFix` reaches the network, so a unit test
 * cannot call it. The payload is the only place a bug like the `.ttl` key can
 * live, and it is a literal, so the literal is what gets asserted.
 */
function fixPayload(): string {
  const source = readFileSync(join(__dirname, '../../src/lib/liveLocation.ts'), 'utf8')
  const start = source.indexOf('const payload = {')
  const end = source.indexOf('const { set } = await import', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

const session = (over: Partial<LocationSession> = {}): LocationSession => ({
  id: 'convo-1',
  conversation_id: 'convo-1',
  guest_uid: 'guest-uid-1',
  active: true,
  started_at_ms: T0,
  expires_at_ms: T0 + 30 * 60_000,
  duration_minutes: 30,
  stream_secret: 'a'.repeat(32),
  ...over,
})

const fix = (over: Partial<LocationFix> = {}): LocationFix => ({
  lat: 14.1,
  lng: 121.3,
  accuracy_m: 12,
  at_ms: T0 + 5_000,
  seq: 1,
  guest_uid: 'guest-uid-1',
  conversation_id: 'convo-1',
  session_secret: 'a'.repeat(32),
  expires_at_ms: T0 + 30 * 60_000,
  ...over,
})

describe('choosing how long to share', () => {
  it('offers the three windows a Messenger-style share is expected to have', () => {
    expect([...SHARE_DURATIONS]).toEqual([15, 30, 60])
  })

  it('clamps a browser that asks for longer than the backend allows', () => {
    const result = chooseDuration(6 * 60)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toBe(MAX_SHARE_MINUTES)
  })

  it('refuses a window that is not one', () => {
    expect(chooseDuration(0).ok).toBe(false)
    expect(chooseDuration(Number.NaN).ok).toBe(false)
  })

  it('ends a session on the clock, not on the tab staying open', () => {
    expect(expiryFor(T0, 15)).toBe(T0 + 15 * 60_000)
    // Even a caller that skips chooseDuration() cannot buy more than an hour.
    expect(expiryFor(T0, 9999)).toBe(T0 + MAX_SHARE_MINUTES * 60_000)
    expect(isExpired(T0 + 30 * 60_000 + 1, T0 + 30 * 60_000)).toBe(false)
    expect(isExpired(T0 + 30 * 60_000, T0 + 30 * 60_000)).toBe(true)
  })

  it('counts down for the Guest in mm:ss', () => {
    expect(formatCountdown(T0 + 27 * 60_000 + 43_000, T0)).toBe('27:43')
    expect(secondsLeft(T0 + 1_000, T0 + 10_000)).toBe(0)
  })
})

describe('a GPS chip reports a position every second; we do not send every one', () => {
  it('always sends the first fix, or a stationary Guest is never seen', () => {
    expect(shouldPublishFix({ next: { lat: 14.1, lng: 121.3 }, nowMs: T0 }).publish).toBe(true)
  })

  it('holds a fix back inside the interval', () => {
    const last = { at: { lat: 14.1, lng: 121.3 }, atMs: T0 }
    const verdict = shouldPublishFix({ next: { lat: 14.1005, lng: 121.3 }, last, nowMs: T0 + 1_000 })
    expect(verdict.publish).toBe(false)
    expect(verdict.publish === false && verdict.reason).toBe('too soon')
    expect(MIN_PUBLISH_INTERVAL_MS).toBe(3_000)
  })

  it('holds a fix back when the Guest has not moved', () => {
    const last = { at: { lat: 14.1, lng: 121.3 }, atMs: T0 }
    const verdict = shouldPublishFix({ next: { lat: 14.10001, lng: 121.3 }, last, nowMs: T0 + 10_000 })
    expect(verdict.publish).toBe(false)
    expect(verdict.publish === false && verdict.reason).toBe('not far enough')
  })

  it('sends once both the interval has passed and the Guest has moved', () => {
    const last = { at: { lat: 14.1, lng: 121.3 }, atMs: T0 }
    // ~22 m north, five seconds later.
    const verdict = shouldPublishFix({ next: { lat: 14.1002, lng: 121.3 }, last, nowMs: T0 + 5_000 })
    expect(verdict.publish).toBe(true)
    expect(MIN_PUBLISH_DISTANCE_M).toBe(10)
  })

  it('refuses a position that is not a position', () => {
    expect(shouldPublishFix({ next: { lat: Number.NaN, lng: 121.3 }, nowMs: T0 }).publish).toBe(false)
    expect(shouldPublishFix({ next: { lat: 400, lng: 121.3 }, nowMs: T0 }).publish).toBe(false)
  })

  it('measures distance the way a map does', () => {
    // Luisiana, Laguna → about 3.4 km.
    const metres = distanceM({ lat: 14.1003, lng: 121.3017 }, { lat: 14.1003, lng: 121.3017 })
    expect(metres).toBe(0)
    expect(distanceM({ lat: 14.1, lng: 121.3 }, { lat: 14.11, lng: 121.3 })).toBeGreaterThan(1_000)
  })
})

describe('what the Admin is allowed to render', () => {
  it('renders a live fix that matches the consented session', () => {
    const checked = checkFix(fix(), session(), T0 + 6_000)
    expect(checked.ok).toBe(true)
  })

  it('refuses a node whose secret does not match the Firestore session', () => {
    // A node nobody can correlate to a consent is inert, whatever it contains.
    const checked = checkFix(fix({ session_secret: 'b'.repeat(32) }), session(), T0 + 6_000)
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.reason).toBe('secret')
  })

  it("refuses another Guest's position, and another conversation's", () => {
    expect(checkFix(fix({ guest_uid: 'guest-uid-2' }), session(), T0 + 6_000).ok).toBe(false)
    expect(checkFix(fix({ conversation_id: 'convo-9' }), session(), T0 + 6_000).ok).toBe(false)
  })

  it('refuses an expired session even if the node has not been swept yet', () => {
    const closed = session({ expires_at_ms: T0 + 60_000 })
    const checked = checkFix(fix({ expires_at_ms: T0 + 60_000, at_ms: T0 + 5_000 }), closed, T0 + 61_000)
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.reason).toBe('expired')
  })

  it('refuses a session the Guest already stopped', () => {
    expect(checkFix(fix(), session({ active: false }), T0 + 6_000).ok).toBe(false)
  })

  it('refuses a node shaped like nothing, and a position outside the world', () => {
    expect(checkFix(null, session(), T0 + 6_000).ok).toBe(false)
    expect(checkFix({ lat: 1 }, session(), T0 + 6_000).ok).toBe(false)
    expect(checkFix(fix({ lat: 91 }), session(), T0 + 6_000).ok).toBe(false)
  })

  it('refuses a node dated in the future — a device cannot have been there yet', () => {
    expect(checkFix(fix({ at_ms: T0 + 10 * 60_000 }), session(), T0 + 6_000).ok).toBe(false)
  })

  it('says how stale a fix is, and when to stop calling it live', () => {
    expect(isStale(T0, T0 + 3_000)).toBe(false)
    expect(isStale(T0, T0 + 25_000)).toBe(true)
    expect(formatAge(T0, T0 + 3_000)).toBe('just now')
    expect(formatAge(T0, T0 + 12_000)).toBe('12 seconds ago')
    expect(formatAge(T0, T0 + 120_000)).toBe('2 minutes ago')
  })
})

describe('the session secret', () => {
  it('is 32 hex characters from the platform CSPRNG', () => {
    const secret = newSessionSecret()
    expect(secret).toMatch(/^[0-9a-f]{32}$/)
    expect(newSessionSecret()).not.toBe(secret)
  })
})

describe('refusals are refusals, not silence', () => {
  it('never reports a share that did not happen as one that did', () => {
    expect(startFailureMessage('permission-denied')).toMatch(/permission was refused/i)
    expect(startFailureMessage('permission-denied')).toMatch(/nothing is being shared/i)
    expect(startFailureMessage('no-firebase')).toMatch(/cloud connection/i)
    expect(startFailureMessage('no-database')).toMatch(/no live-location channel/i)
    expect(startFailureMessage('unavailable')).toMatch(/could not get a position/i)
    expect(startFailureMessage('refused')).toMatch(/refused/i)
  })

  it('offers nothing when there is no session to attach to', () => {
    // This build has no Firebase project (`npm test` runs in demo mode), so the
    // control must be visibly unavailable rather than apparently available.
    expect(canShareLocation('guest-uid-1')).toBe(false)
    expect(canShareLocation(undefined)).toBe(false)
  })
})

describe('where each half of the feature is stored', () => {
  it('keeps the session in Firestore and the position in the realtime stream', () => {
    expect(LOCATION_SESSIONS_COLLECTION).toBe('location_sessions')
    expect(LIVE_LOCATION_PATH).toBe('live_location')
  })

  it('lets no rule anywhere store a coordinate in Firestore', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    const block = rules.slice(rules.indexOf('match /location_sessions/{sessionId}'))
    // The rule that makes "ephemeral" true rather than aspirational: a document
    // carrying a position is refused, whatever shape the position takes.
    expect(block).toContain("!request.resource.data.keys().hasAny([")
    for (const field of ["'lat'", "'lng'", "'latitude'", "'longitude'", "'position'"]) {
      expect(block).toContain(field)
    }
    // And the fields a session *does* carry.
    expect(block).toContain("'stream_secret'")
    expect(block).toContain("'expires_at'")
  })

  it('never writes to the retired tracking collection', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    expect(rules).toMatch(/match \/tracking_sessions\/\{\w+\} \{\s*allow read, create, update: if false;/)
  })

  it('sends a fix the Realtime Database will actually accept', () => {
    // The regression this whole file could not see for a release. `publishFix`
    // used to write a `'.ttl'` field beside the nine real ones, believing the
    // server would expire the node. Two things were wrong with that: Realtime
    // Database has no per-node TTL on any plan, and a key containing `.` is
    // rejected by the client SDK before the write leaves the browser — so every
    // fix threw `contains an invalid key (.ttl)` and the feature never once
    // published a position. Neither the rules suite (which reads the rules
    // file) nor the emulator suite (which had never been run, because the
    // Database emulator had never been downloaded) could see it. Only the
    // payload can.
    const payload = fixPayload()
    expect(payload).not.toContain("'.ttl'")
    expect(payload).not.toContain('expireAt')
    // And no server-expiry API is called anywhere in the module.
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocation.ts'), 'utf8')
    expect(source).not.toMatch(/expireAt/)
  })

  it('sends exactly the nine fields the rules validate, and no tenth', () => {
    // Ties the client's payload to `database.rules.json`: if one side grows a
    // field the other does not know about, one of these two assertions is the
    // one that fails.
    const keys = [...fixPayload().matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual([
      'accuracy_m',
      'at_ms',
      'conversation_id',
      'expires_at_ms',
      'guest_uid',
      'lat',
      'lng',
      'seq',
      'session_secret',
    ])
  })

  it('arms the server-side disconnect cleanup when a session opens', () => {
    // The deletion the Guest's own device cannot be trusted to make. It is not
    // the guarantee — the rules are — but without it an abandoned node waits in
    // the database for the Admin's next visit.
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocation.ts'), 'utf8')
    expect(source).toContain('onDisconnect')
    expect(source).toMatch(/onDisconnect\(reference\)\.remove\(\)/)
    expect(source).toContain('armDisconnectCleanup(input.convoId, input.uid)')
  })
})
