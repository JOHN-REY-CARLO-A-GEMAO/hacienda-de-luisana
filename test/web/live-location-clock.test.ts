// ----------------------------------------------------------------------------
// Live location: the clock, the reload, and the reader.
//
// Three bugs this file exists to keep fixed, all of them found by reading the
// feature rather than by running it:
//
//   1. `expires_at` was the *device's* `now + chosen minutes`, compared by the
//      rules against the *server's* clock. A phone a second fast could not open
//      the 60-minute share at all, and every fix was then refused as "the
//      server refused the update".
//   2. Nothing ever read `location_sessions` back, so a reload lost the panel
//      while the consent — and the Admin's access to a position — stayed live.
//   3. `checkFix` gated a position that no web surface could display, and one
//      refused write ended a share that was working.
//
// Each case is a statement the rest of the feature depends on, so an edit that
// reopens one of them fails here first.
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CLOCK_GUARD_MS,
  MAX_SHARE_MINUTES,
  NO_CLOCK_SKEW,
  WINDOW_GUARD_MS,
  clockSkewFrom,
  isExpired,
  resumableSession,
  shareWindow,
  type LocationSession,
} from '../../src/lib/liveLocationPolicy'
import { evaluateReader, readerStopMessage } from '../../src/lib/liveLocationReader'

const T0 = Date.parse('2026-10-01T09:00:00.000Z')
const SECRET = 'a'.repeat(32)

const session = (over: Partial<LocationSession> = {}): LocationSession => ({
  id: 'booking-bk_1',
  conversation_id: 'booking-bk_1',
  guest_uid: 'guest-1',
  active: true,
  started_at_ms: T0,
  expires_at_ms: T0 + 30 * 60_000,
  duration_minutes: 30,
  stream_secret: SECRET,
  ...over,
})

const fix = (over: Record<string, unknown> = {}) => ({
  lat: 14.185,
  lng: 121.51,
  accuracy_m: 12,
  at_ms: T0 + 3_000,
  seq: 1,
  guest_uid: 'guest-1',
  conversation_id: 'booking-bk_1',
  session_secret: SECRET,
  expires_at_ms: T0 + 30 * 60_000,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. The clock
// ---------------------------------------------------------------------------

describe('the sharing window is stated on the server\'s clock', () => {
  it('never asks for more than the Guest chose, whatever the clock says', () => {
    for (const offsetMs of [-120_000, -1_000, 0, 1_000, 120_000]) {
      const window = shareWindow({ nowMs: T0, minutes: 60, skew: { offsetMs, serverTimeMs: T0 + offsetMs, certain: true } })
      // Both figures end the share no later than the moment the Guest asked for
      // — a fast clock must not buy a longer window, and a slow one must not
      // postdate it on the server.
      expect(window.serverMs).toBeLessThanOrEqual(T0 + 60 * 60_000 + offsetMs)
      expect(window.localMs).toBeLessThanOrEqual(T0 + 60 * 60_000)
      expect(window.durationMs).toBe(60 * 60_000)
    }
  })

  it('leaves the rules an hour to compare against, not a millisecond', () => {
    // The exact bug: `firestore.rules` refuses `expires_at > request.time + 1h`.
    // A device 30 seconds fast used to ask for `now + 1h`, which is 1h + 30s on
    // the server — refused, and the *longest* share was the one that failed.
    const deviceIsFast = { offsetMs: -30_000, serverTimeMs: T0 - 30_000, certain: true }
    const window = shareWindow({ nowMs: T0, minutes: 60, skew: deviceIsFast })
    const onServerClock = T0 + deviceIsFast.offsetMs // what the server reads when this runs
    expect(window.serverMs - onServerClock).toBe(60 * 60_000 - WINDOW_GUARD_MS)
    expect(window.serverMs).toBeLessThan(onServerClock + 60 * 60_000)
  })

  it('pulls the window in by a whole minute when the clock could not be measured', () => {
    const window = shareWindow({ nowMs: T0, minutes: 15, skew: null })
    expect(window.localMs).toBe(T0 + 15 * 60_000 - CLOCK_GUARD_MS)
    // With no estimate the two figures are the same instant: there is nothing
    // to convert by, and pretending otherwise would be a guess.
    expect(window.serverMs).toBe(window.localMs)
  })

  it('clamps the request to the longest share the rules allow', () => {
    const window = shareWindow({ nowMs: T0, minutes: MAX_SHARE_MINUTES + 500, skew: NO_CLOCK_SKEW })
    expect(window.durationMs).toBe(MAX_SHARE_MINUTES * 60_000)
  })

  it('brackets the offset from a round trip, and never runs ahead of the server', () => {
    // Requested at 09:00:00.900 local, stamped 09:00:00.000 server (this device
    // is 900 ms fast), answered 400 ms later.
    const measured = clockSkewFrom({ requestedAtMs: T0 + 900, receivedAtMs: T0 + 1_300, stampMs: T0 })
    expect(measured).not.toBeNull()
    // The server had certainly not reached the stamp before `receivedAtMs`, so
    // the low end of the bracket is the one a window is built from.
    expect(measured!.offsetMs).toBe(-1_300)
    expect(measured!.serverTimeMs).toBe(T0)
    // A four-hundred-millisecond round trip is read to within its own width,
    // which is inside the tolerance the window's guard band covers.
    expect(measured!.certain).toBe(true)

    // A slow one is not, and the estimator says so rather than pretending: the
    // bracket is the round trip's width, so a laggy connection is a wide one.
    const slow = clockSkewFrom({ requestedAtMs: T0, receivedAtMs: T0 + 9_000, stampMs: T0 + 4_500 })
    expect(slow!.certain).toBe(false)
    // The low end is what a window is built from, so even the wide bracket is
    // safe in the direction that matters — never longer than asked for.
    expect(slow!.offsetMs).toBe(-4_500)
  })

  it('refuses to invent an offset from values that are not times', () => {
    expect(clockSkewFrom({ requestedAtMs: Number.NaN, receivedAtMs: T0, stampMs: T0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. The reload
// ---------------------------------------------------------------------------

describe('a session is resumed from the store, not from memory', () => {
  it('takes up a live consent that belongs to this Guest', () => {
    const resumed = resumableSession(session(), T0 + 60_000)
    expect(resumed).toEqual(session())
  })

  it('refuses a session the Guest stopped, so a reload cannot reopen it', () => {
    // `firestore.rules` refuses `active: false -> true` on the document. A client
    // that resumed a stopped session would hold a panel that says "sharing"
    // while the Admin's read is refused.
    expect(resumableSession(session({ active: false }), T0 + 60_000)).toBeNull()
  })

  it('refuses a session whose window has closed', () => {
    expect(resumableSession(session({ expires_at_ms: T0 + 1_000 }), T0 + 1_000)).toBeNull()
    expect(resumableSession(session({ expires_at_ms: T0 + 1_000 }), T0 + 999)).not.toBeNull()
  })

  it('refuses a document that is not a session: no secret, no window, a bad duration', () => {
    expect(resumableSession(null, T0)).toBeNull()
    expect(resumableSession({}, T0)).toBeNull()
    expect(resumableSession({ ...session(), stream_secret: 'short' }, T0)).toBeNull()
    expect(resumableSession({ ...session(), expires_at_ms: undefined }, T0)).toBeNull()
    expect(resumableSession({ ...session(), duration_minutes: 0 }, T0)).toBeNull()
    expect(resumableSession({ ...session(), duration_minutes: 120 }, T0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. The reader
// ---------------------------------------------------------------------------

describe('what the Admin may draw, and what it says instead', () => {
  it('says nothing is being shared when there is no consent', () => {
    expect(evaluateReader({ session: null, fix: null, nowMs: T0 })).toEqual({ kind: 'no-session' })
  })

  it('waits for the first fix instead of calling it an error', () => {
    const frame = evaluateReader({ session: session(), fix: null, nowMs: T0 + 1_000 })
    expect(frame.kind).toBe('waiting')
  })

  it('draws a position only when it matches the consent', () => {
    const live = evaluateReader({ session: session(), fix: fix(), nowMs: T0 + 4_000 })
    expect(live.kind).toBe('live')
    if (live.kind !== 'live') throw new Error('unreachable')
    expect(live.fix.lat).toBe(14.185)
    expect(live.stale).toBe(false)
  })

  it('tells the Admin a position is stale rather than silently keeping it', () => {
    const late = evaluateReader({ session: session(), fix: fix(), nowMs: T0 + 120_000 })
    expect(late.kind).toBe('live')
    if (late.kind !== 'live') throw new Error('unreachable')
    expect(late.stale).toBe(true)
  })

  it('refuses a node from another session, and says which check said no', () => {
    for (const [field, value, reason] of [
      ['session_secret', 'b'.repeat(32), 'secret'],
      ['guest_uid', 'somebody-else', 'guest'],
      ['conversation_id', 'another-convo', 'conversation'],
    ] as const) {
      const frame = evaluateReader({ session: session(), fix: fix({ [field]: value }), nowMs: T0 + 4_000 })
      expect(frame).toEqual({ kind: 'ended', reason })
    }
  })

  it('stops drawing the moment the window closes, whatever the node still holds', () => {
    const frame = evaluateReader({ session: session(), fix: fix(), nowMs: T0 + 30 * 60_000 })
    expect(frame).toEqual({ kind: 'ended', reason: 'expired' })
  })

  it('says the Guest stopped, when the consent was ended early', () => {
    const stopped = { ...session(), active: false, expires_at_ms: T0 + 5 * 60_000 }
    expect(evaluateReader({ session: stopped, fix: null, nowMs: T0 + 60_000 })).toEqual({
      kind: 'ended',
      reason: 'stopped',
    })
  })

  it('keeps the last accepted position when a watch ends', () => {
    // The panel shows the position it had and why it stopped, rather than
    // blanking: an Admin who looked away for a minute should not lose the place.
    const frame = evaluateReader({ session: session(), fix: fix(), nowMs: T0 + 30 * 60_000 })
    expect(frame.kind).toBe('ended')
    expect(readerStopMessage('expired')).toMatch(/window closed/i)
    expect(readerStopMessage('stopped')).toMatch(/stopped sharing/i)
    expect(readerStopMessage('secret')).toMatch(/does not belong/i)
  })

  it('never reports a share as live for an Admin whose read is refused', () => {
    // `denied` and `no-transport` come from the listener, and each is a sentence
    // rather than an empty panel.
    expect(readerStopMessage('denied')).toMatch(/allowlisted Admin/i)
    expect(readerStopMessage('no-transport')).toMatch(/no live-location channel/i)
  })
})

// ---------------------------------------------------------------------------
// 4. The two stores still agree
// ---------------------------------------------------------------------------

describe('the code keeps the promises the rules make', () => {
  it('writes the window as a server-clock Date, never as a raw local epoch', () => {
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocation.ts'), 'utf8')
    // `expires_at` must be a Timestamp (the rules require `is timestamp`), built
    // from the converted figure.
    expect(source).toContain('expires_at: new Date(window.serverMs)')
    expect(source).not.toContain('expires_at: new Date(expiresAtMs)')
  })

  it('reads its own consent back, which is what makes a reload survivable', () => {
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocation.ts'), 'utf8')
    expect(source).toContain('export async function resumeSharing')
    expect(source).toContain('resumableSession(')
    const hook = readFileSync(join(__dirname, '../../src/hooks/useLiveLocation.ts'), 'utf8')
    expect(hook).toContain('resumeSharing({ convoId, uid')
    // A back/forward-cache restore is a frozen page, not a closed one.
    expect(hook).toContain('if (event.persisted) return')
  })

  it('treats a refused write as a retry, not as the end of the session', () => {
    const hook = readFileSync(join(__dirname, '../../src/hooks/useLiveLocation.ts'), 'utf8')
    // The retry branch forgets the last fix so the next GPS tick is eligible.
    expect(hook).toContain("outcome === 'stopped'")
    expect(hook).toContain('lastFixRef.current = null\n              setOffline(true)')
  })

  it('keeps the probe collection out of anything that could store a position', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    const block = rules.slice(rules.indexOf('match /clock_probes/{probeId}'))
    expect(block).toContain("request.resource.data.keys().hasOnly(['uid', 'probed_at'])")
    expect(block).toContain('allow update: if false')
    expect(block).not.toContain("'lat'")
  })

  it('imports nothing from the reader that would open a connection on render', () => {
    // `evaluateReader` is pure: the page can render before a listener exists and
    // the panel still has something true to say.
    const source = readFileSync(join(__dirname, '../../src/lib/liveLocationReader.ts'), 'utf8')
    const pure = source.slice(source.indexOf('export function evaluateReader'), source.indexOf('export type ReaderHandle'))
    expect(pure).not.toContain('onSnapshot')
    expect(pure).not.toContain('await')
  })

  it('ends the Guest\'s window no later than the Admin\'s read does', () => {
    // One instant, two clocks. The local figure is what the countdown reads and
    // what the Realtime Database node is stamped with; the server figure is what
    // `firestore.rules` compares. They differ by exactly the measured offset, so
    // the Admin's read closes at the same real moment the Guest's countdown
    // reaches zero — never later.
    for (const offsetMs of [-45_000, 0, 45_000]) {
      const window = shareWindow({ nowMs: T0, minutes: 15, skew: { offsetMs, serverTimeMs: T0 + offsetMs, certain: true } })
      expect(window.serverMs - window.localMs).toBe(offsetMs)
      // Just before the end, both are open; at the end, both are closed.
      expect(isExpired(window.localMs, window.localMs - 1)).toBe(false)
      expect(isExpired(window.localMs, window.serverMs - offsetMs - 1)).toBe(false)
      expect(isExpired(window.localMs, window.localMs)).toBe(true)
    }
  })
})
