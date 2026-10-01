// Actual web transport adapter payloads with Firestore/RTDB SDK doubles.
// Consent/rule authorization is tested separately by the canonical emulator.
import { beforeEach, expect, it, vi } from 'vitest'
import { scenarios, NOW } from './fixtures'
import { checkFix, isStale } from '../../src/lib/liveLocationPolicy'

const transport = vi.hoisted(() => ({ consent: vi.fn(), update: vi.fn(), set: vi.fn(), remove: vi.fn(), disconnect: vi.fn() }))
vi.mock('../../src/lib/firebase', () => ({
  db: { phase0Double: true }, isFirebaseConfigured: true,
  hasRealtimeDatabaseConfig: () => true, ensureRealtimeDatabase: async () => ({ phase0Double: true }),
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  setDoc: transport.consent, updateDoc: transport.update, serverTimestamp: () => 'synthetic-server-timestamp',
}))
vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => ({ path }), set: transport.set, remove: transport.remove,
  onDisconnect: () => ({ remove: transport.disconnect }),
}))
import { startSharing, publishFix, stopSharing } from '../../src/lib/liveLocation'
const now = Date.parse(NOW)
const location = scenarios.location
const start = () => startSharing({ convoId: location.conversationId, uid: location.guestUid, minutes: 30, nowMs: now })
const fix = { lat: location.lat, lng: location.lng, accuracy_m: location.accuracy, seq: 1 }
beforeEach(() => {
  for (const fn of Object.values(transport)) { fn.mockReset(); fn.mockResolvedValue(undefined) }
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => {
    bytes.set(location.streamSecret.match(/../g)!.map(hex => parseInt(hex, 16))); return bytes
  } })
})

it('F21-CREATE: actual consent payload carries stream_secret and no coordinates', async () => {
  const result = await start()
  expect(result).toMatchObject({ ok: true, session: { active: true, stream_secret: location.streamSecret } })
  const data = transport.consent.mock.calls[0][1]
  expect(data).toMatchObject({ conversation_id: location.conversationId, guest_uid: location.guestUid, stream_secret: location.streamSecret })
  expect(data).not.toHaveProperty('session_secret')
  expect(data).not.toHaveProperty('lat')
})
it('F21-PUBLISHER-TTL: first actual 30-minute publisher fix carries a full-session expiry, not the rule\'s <=90 seconds', async () => {
  const result = await start()
  if (!result.ok) throw new Error(result.reason)
  expect(await publishFix(result.session, fix, now)).toBe('sent')
  const payload = transport.set.mock.calls[0][1]
  expect(payload.expires_at_ms - now).toBe(30 * 60_000)
  expect(payload.expires_at_ms - now).toBeGreaterThan(90_000)
  expect(payload.session_secret).toBe(location.streamSecret)
})
it('F21-REFUSED-CREATE: a rejected Firestore consent is visible and initiates no RTDB fix', async () => {
  transport.consent.mockRejectedValue(Object.assign(new Error('synthetic ownership denial'), { code: 'permission-denied' }))
  expect(await start()).toEqual({ ok: false, reason: 'refused' })
  expect(transport.set).not.toHaveBeenCalled()
})
it('F22-SIGNEDOUT-CONTROL: no UID cannot create consent', async () => {
  expect(await startSharing({ convoId: location.conversationId, uid: '', minutes: 30, nowMs: now })).toEqual({ ok: false, reason: 'signed-out' })
  expect(transport.consent).not.toHaveBeenCalled()
})
it('F22-EXPIRED-CONTROL: local publisher stops after expiry without a write', async () => {
  const result = await start(); if (!result.ok) throw new Error(result.reason)
  expect(await publishFix(result.session, fix, result.session.expires_at_ms)).toBe('stopped')
  expect(transport.set).not.toHaveBeenCalled()
})
it('F22-INACTIVE-PUBLISHER: active=false alone does not stop an unexpired session payload', async () => {
  const result = await start(); if (!result.ok) throw new Error(result.reason)
  expect(await publishFix({ ...result.session, active: false }, fix, now)).toBe('sent')
})
it('F22-STOP-FAILURE: failed consent stop and RTDB removal both resolve without reporting failure', async () => {
  transport.update.mockRejectedValue(Object.assign(new Error('synthetic stop denial'), { code: 'permission-denied' }))
  transport.remove.mockRejectedValue(new Error('synthetic removal unavailable'))
  await expect(stopSharing({ convoId: location.conversationId, uid: location.guestUid, nowMs: now })).resolves.toBeUndefined()
  expect(transport.remove).toHaveBeenCalled()
})
it('F22-READ-POLICY: local reader correlates ownership, secret, expiry and stale display independently', async () => {
  const result = await start(); if (!result.ok) throw new Error(result.reason)
  const payload = { ...fix, at_ms: now - 21_000, guest_uid: location.guestUid, conversation_id: location.conversationId, session_secret: location.streamSecret, expires_at_ms: now + 60_000 }
  expect(checkFix(payload, result.session, now).ok).toBe(true)
  expect(isStale(payload.at_ms, now)).toBe(true)
  expect(checkFix({ ...payload, guest_uid: scenarios.identities.secondGuest.uid }, result.session, now)).toEqual({ ok: false, reason: 'guest' })
  expect(checkFix({ ...payload, session_secret: 'foreign-synthetic-secret' }, result.session, now)).toEqual({ ok: false, reason: 'secret' })
  expect(checkFix(payload, { ...result.session, active: false }, now)).toEqual({ ok: false, reason: 'expired' })
})
