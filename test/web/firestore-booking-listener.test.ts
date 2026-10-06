import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ onSnapshot: vi.fn() }))

vi.mock('../../src/lib/firebase', () => ({
  db: {},
  isFirebaseConfigured: true,
  auth: null,
}))

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: sdk.onSnapshot,
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  query: vi.fn((...parts: unknown[]) => parts),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  updateDoc: vi.fn(),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}))

import { cloudBookingsDB } from '../../src/lib/firestoreBookings'

const CHECK_IN = new Date('2027-03-04T00:00:00.000Z')
const CHECK_OUT = new Date('2027-03-06T00:00:00.000Z')
const CREATED = new Date('2026-09-20T01:00:00.000Z')
const HOLD_EXPIRES = new Date('2026-09-21T01:00:00.000Z')

const asTimestamp = (date: Date) => ({
  seconds: Math.floor(date.getTime() / 1000),
  nanoseconds: (date.getTime() % 1000) * 1_000_000,
})
const asTimestampInstance = (date: Date) => ({ toDate: () => new Date(date) })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Booking snapshot date normalization', () => {
  it('normalizes Timestamp instances and plain Firestore timestamp objects in the live listener', () => {
    const stop = vi.fn()
    sdk.onSnapshot.mockImplementation((_query, onNext) => {
      onNext({
        docs: [
          {
            id: 'booking-1',
            data: () => ({
              guest_name: 'Ana Reyes',
              phone: '09171234567',
              email: 'ana@example.com',
              check_in: asTimestamp(CHECK_IN),
              check_out: asTimestampInstance(CHECK_OUT),
              created_at: asTimestamp(CREATED),
              hold_expires_at: asTimestampInstance(HOLD_EXPIRES),
              payment_verified_at: asTimestamp(CREATED),
              policy_effective_date: asTimestamp(CHECK_IN),
              guests: 2,
              accommodation: 'main-house',
              status: 'Pending',
              special_requests: '',
            }),
          },
        ],
      })
      return stop
    })
    const receive = vi.fn()

    const unsubscribe = cloudBookingsDB.subscribeMine('guest-1', receive)

    expect(receive).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'booking-1',
        check_in: '2027-03-04',
        check_out: '2027-03-06',
        created_at: CREATED.toISOString(),
        hold_expires_at: HOLD_EXPIRES.toISOString(),
        payment_verified_at: CREATED.toISOString(),
        policy_effective_date: '2027-03-04',
      }),
    ])
    expect(unsubscribe).toBe(stop)
  })
})
