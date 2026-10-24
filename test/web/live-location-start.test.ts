import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: firestore.getDoc,
  deleteDoc: firestore.deleteDoc,
  setDoc: firestore.setDoc,
  updateDoc: firestore.updateDoc,
  serverTimestamp: () => 'server-time',
}))
vi.mock('firebase/database', () => ({
  ref: () => ({}),
  onDisconnect: () => ({ remove: vi.fn(async () => {}) }),
  remove: vi.fn(async () => {}),
  set: vi.fn(async () => {}),
}))
vi.mock('../../src/lib/firebase', () => ({
  db: {},
  isFirebaseConfigured: true,
  hasRealtimeDatabaseConfig: () => true,
  ensureRealtimeDatabase: async () => ({}),
}))

import { startSharing } from '../../src/lib/liveLocation'

const input = { convoId: 'convo-1', uid: 'guest-1', minutes: 30 as const, nowMs: Date.parse('2026-10-01T09:00:00Z') }

beforeEach(() => {
  vi.clearAllMocks()
  firestore.getDoc.mockResolvedValue({ exists: () => false })
  firestore.deleteDoc.mockResolvedValue(undefined)
  firestore.setDoc.mockResolvedValue(undefined)
})

describe('live-location session creation and restart', () => {
  it('creates a first session without trying to delete a nonexistent consent', async () => {
    const result = await startSharing(input)
    expect(result.ok).toBe(true)
    expect(firestore.getDoc).toHaveBeenCalledOnce()
    expect(firestore.deleteDoc).not.toHaveBeenCalled()
    expect(firestore.setDoc).toHaveBeenCalledOnce()
  })

  it('deletes a stopped/expired consent before creating the fresh session', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true })
    const result = await startSharing(input)
    expect(result.ok).toBe(true)
    expect(firestore.deleteDoc).toHaveBeenCalledOnce()
    expect(firestore.setDoc).toHaveBeenCalledOnce()
    expect(firestore.deleteDoc.mock.invocationCallOrder[0]).toBeLessThan(firestore.setDoc.mock.invocationCallOrder[0])
    const written = firestore.setDoc.mock.calls[0][1]
    expect(written.stream_secret).toMatch(/^[0-9a-f]{32}$/)
    expect(written).not.toHaveProperty('lat')
    expect(written).not.toHaveProperty('lng')
  })

  it('does not report sharing when the fresh create is refused', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true })
    firestore.setDoc.mockRejectedValue({ code: 'permission-denied' })
    const result = await startSharing(input)
    expect(result).toEqual({ ok: false, reason: 'refused' })
  })

  it('does not create anything when the old session cannot be removed', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true })
    firestore.deleteDoc.mockRejectedValue({ code: 'permission-denied' })
    const result = await startSharing(input)
    expect(result).toEqual({ ok: false, reason: 'refused' })
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })

  it('distinguishes a network/server failure from a permission refusal', async () => {
    firestore.getDoc.mockRejectedValue({ code: 'unavailable' })
    const result = await startSharing(input)
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })
})
