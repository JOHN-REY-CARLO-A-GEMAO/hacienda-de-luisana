import { beforeAll, expect, it, vi } from 'vitest'
import { scenarios, NOW } from './fixtures'
const transport = vi.hoisted(() => ({ set: vi.fn(async (_ref: unknown, _payload: { expires_at_ms: number }) => {}), consent: vi.fn(async () => {}) }))
vi.mock('../../src/lib/firebase', () => ({ db: {}, isFirebaseConfigured: true, hasRealtimeDatabaseConfig: () => true, ensureRealtimeDatabase: async () => ({}) }))
vi.mock('firebase/firestore', () => ({ doc: () => ({}), setDoc: transport.consent, serverTimestamp: () => 'synthetic', updateDoc: vi.fn() }))
vi.mock('firebase/database', () => ({ ref: () => ({}), set: transport.set, onDisconnect: () => ({ remove: async () => {} }), remove: vi.fn() }))
beforeAll(async () => { await import('firebase/database') })
import { startSharing, publishFix } from '../../src/lib/liveLocation'

it('F21 DESIRED: actual first session fix satisfies the currently enforced RTDB maximum lease', async () => {
  const now = Date.parse(NOW)
  const result = await startSharing({ convoId: scenarios.location.conversationId, uid: scenarios.location.guestUid, minutes: 30, nowMs: now })
  if (!result.ok) throw new Error(result.reason)
  await vi.dynamicImportSettled()
  await publishFix(result.session, { lat: 14.1, lng: 121.3, accuracy_m: 12, seq: 1 }, now)
  expect(transport.set.mock.calls[0][1].expires_at_ms).toBeLessThanOrEqual(now + 90_000)
})
it('F22 DESIRED: an inactive consent cannot cause publication even before its old expiry', async () => {
  const now = Date.parse(NOW)
  const session = { id: scenarios.location.conversationId, conversation_id: scenarios.location.conversationId, guest_uid: scenarios.location.guestUid, active: false, started_at_ms: now, expires_at_ms: now + 60_000, duration_minutes: 1, stream_secret: scenarios.location.streamSecret }
  expect(await publishFix(session, { lat: 14.1, lng: 121.3, accuracy_m: 12, seq: 1 }, now)).toBe('stopped')
})
