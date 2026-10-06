import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ onSnapshot: vi.fn() }))

vi.mock('../../src/lib/firebase', () => ({ db: {}, isFirebaseConfigured: true }))
vi.mock('firebase/firestore', () => ({
  Timestamp: { fromMillis: vi.fn((value: number) => ({ value })) },
  addDoc: vi.fn(),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ limit: value })),
  onSnapshot: sdk.onSnapshot,
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  query: vi.fn((...parts: unknown[]) => parts),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  setDoc: vi.fn(),
  startAfter: vi.fn((value: unknown) => ({ startAfter: value })),
  updateDoc: vi.fn(),
}))

import { subscribeMessages } from '../../src/lib/chatCloud'

const CREATED = new Date('2026-09-20T01:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('live Firestore message listener', () => {
  it('normalizes a plain Timestamp and forwards listener failures to the page', () => {
    let onNext: ((snapshot: unknown) => void) | undefined
    let onError: ((error: unknown) => void) | undefined
    const stop = vi.fn()
    sdk.onSnapshot.mockImplementation((_query, next, error) => {
      onNext = next
      onError = error
      return stop
    })
    const receivePage = vi.fn()
    const receiveError = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const unsubscribe = subscribeMessages(
      'inquiry-guest-1-booking',
      'guest-1',
      receivePage,
      undefined,
      receiveError,
    )

    onNext?.({
      docs: [
        {
          id: 'message-1',
          data: () => ({
            text: 'Hello',
            sender_uid: 'guest-1',
            created_at: {
              seconds: Math.floor(CREATED.getTime() / 1000),
              nanoseconds: (CREATED.getTime() % 1000) * 1_000_000,
            },
          }),
        },
      ],
    })
    const listenerError = new Error('Firestore listener unavailable')
    onError?.(listenerError)

    expect(receivePage).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        id: 'message-1',
        text: 'Hello',
        at: CREATED.toISOString(),
        mine: true,
      })],
    }))
    expect(receiveError).toHaveBeenCalledWith(listenerError)
    expect(consoleError).toHaveBeenCalledWith('[Chat] messages listener failed', listenerError)
    unsubscribe()
    expect(stop).toHaveBeenCalledOnce()
  })
})
