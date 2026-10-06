import { beforeAll, expect, it, vi } from 'vitest'
import { scenarios, NOW } from './fixtures'
const transport = vi.hoisted(() => ({ set: vi.fn(async (_ref: unknown, _payload: { expires_at_ms: number }) => {}), consent: vi.fn(async () => {}) }))
vi.mock('../../src/lib/firebase', () => ({ db: {}, isFirebaseConfigured: true, hasRealtimeDatabaseConfig: () => true, ensureRealtimeDatabase: async () => ({}) }))
vi.mock('firebase/firestore', () => ({ doc: () => ({}), setDoc: transport.consent, serverTimestamp: () => 'synthetic', updateDoc: vi.fn() }))
vi.mock('firebase/database', () => ({ ref: () => ({}), set: transport.set, onDisconnect: () => ({ remove: async () => {} }), remove: vi.fn() }))
beforeAll(async () => { await import('firebase/database') })
import { startSharing, publishFix } from '../../src/lib/liveLocation'
import { MAX_SHARE_MINUTES, SHARE_DURATIONS } from '../../src/lib/liveLocationPolicy'

it('F21 DESIRED: actual first session fix satisfies the enforced RTDB maximum lease', async () => {
  const now = Date.parse(NOW)
  const result = await startSharing({ convoId: scenarios.location.conversationId, uid: scenarios.location.guestUid, minutes: 30, nowMs: now })
  if (!result.ok) throw new Error(result.reason)
  await vi.dynamicImportSettled()
  await publishFix(result.session, { lat: 14.1, lng: 121.3, accuracy_m: 12, seq: 1 }, now)
  const expiry = transport.set.mock.calls[0][1].expires_at_ms
  // The lease the rules enforce is the longest share a Guest may start, not an
  // arbitrary 90 seconds. This test asserted the 90-second figure while the
  // client published the session's real 30-minute expiry, so it failed against
  // the shipping client: the rule was the side that was wrong. This is the half
  // of the fix that holds the rule at the policy module's cap.
  expect(expiry).toBeLessThanOrEqual(now + MAX_SHARE_MINUTES * 60_000)
  expect(expiry).toBeGreaterThan(now)
  // And the value is the session's own expiry, restated on every fix, not a
  // truncated one — the Admin reads this number to decide what is still live.
  expect(expiry).toBe(now + 30 * 60_000)
})
it('F21 LEASE: every sharing window a Guest may choose fits inside the enforced lease', async () => {
  const now = Date.parse(NOW)
  for (const minutes of [1, 5, ...SHARE_DURATIONS, MAX_SHARE_MINUTES]) {
    const result = await startSharing({ convoId: scenarios.location.conversationId, uid: scenarios.location.guestUid, minutes, nowMs: now })
    if (!result.ok) throw new Error(result.reason)
    expect(await publishFix(result.session, { lat: 14.1, lng: 121.3, accuracy_m: 12, seq: 1 }, now)).toBe('sent')
    expect(transport.set.mock.lastCall![1].expires_at_ms).toBeLessThanOrEqual(now + MAX_SHARE_MINUTES * 60_000)
  }
})
it('F22 DESIRED: an inactive consent cannot cause publication even before its old expiry', async () => {
  const now = Date.parse(NOW)
  const session = { id: scenarios.location.conversationId, conversation_id: scenarios.location.conversationId, guest_uid: scenarios.location.guestUid, active: false, started_at_ms: now, expires_at_ms: now + 60_000, duration_minutes: 1, stream_secret: scenarios.location.streamSecret }
  expect(await publishFix(session, { lat: 14.1, lng: 121.3, accuracy_m: 12, seq: 1 }, now)).toBe('stopped')
})
