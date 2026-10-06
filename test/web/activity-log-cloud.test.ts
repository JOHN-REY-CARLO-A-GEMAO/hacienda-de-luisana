// ----------------------------------------------------------------------------
// The Activity log as the cloud stores it, read back through the real adapter.
//
// The booking lifecycle writes `at` as an ISO string; the Admin app stamps a
// Review's moderation entry with `FieldValue.serverTimestamp()` instead
// (`lib/services/review_service.dart`), and firestore.rules accepts either. So
// a real Booking's log holds both shapes, and this suite is about the read: the
// web must hand the rest of the app a string, because a Timestamp that reaches
// React as a child throws React error #31 and replaces the whole /account page
// with the error boundary.
// ----------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ getDocs: vi.fn() }))
vi.mock('../../src/lib/firebase', () => ({
  db: {}, isFirebaseConfigured: true, auth: { currentUser: { uid: 'admin-1' } },
}))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (ref: unknown) => ref,
  orderBy: (field: string) => ({ field }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  serverTimestamp: () => 'server-timestamp',
  getDocs: sdk.getDocs, getDoc: vi.fn(), getDocFromServer: vi.fn(),
  addDoc: vi.fn(), updateDoc: vi.fn(), setDoc: vi.fn(), onSnapshot: vi.fn(), runTransaction: vi.fn(),
}))

import { activityLogDB } from '../../src/lib/firestoreBookings'

/** What Firestore hands back for `FieldValue.serverTimestamp()`. */
const serverTimestamp = { seconds: 1_789_775_400, nanoseconds: 0 }
const serverTimestampEntry = {
  seconds: serverTimestamp.seconds, nanoseconds: serverTimestamp.nanoseconds,
  toDate: () => new Date(serverTimestamp.seconds * 1000),
}
/** The instant that Timestamp stands for, as the ISO the other writer used. */
const ISO = new Date(serverTimestamp.seconds * 1000).toISOString()

const submit = {
  booking_id: 'book-1', action: 'Submit', from_status: 'Pending', to_status: 'Pending',
  actor: 'guest', actor_id: 'guest-1', at: ISO, seq: 0,
}
const moderated = {
  booking_id: 'book-1', action: 'ReviewPublished', from_status: 'none', to_status: 'published',
  actor: 'admin', actor_id: 'admin-1', at: serverTimestampEntry, seq: 1,
}

function stored(docs: Record<string, unknown>[]) {
  sdk.getDocs.mockResolvedValue({ docs: docs.map((data) => ({ id: '1', data: () => data })) })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('a log entry stored as a Firestore Timestamp, not a string', () => {
  it('reads back as an ISO instant, the shape the domain declares', async () => {
    stored([submit, moderated])

    const history = await activityLogDB.list('book-1')

    expect(history.map((entry) => entry.at)).toEqual([ISO, ISO])
    expect(history.every((entry) => typeof entry.at === 'string')).toBe(true)
  })

  it('keeps both shapes in one log, in sequence order', async () => {
    stored([submit, moderated])

    const history = await activityLogDB.list('book-1')

    expect(history.map((entry) => entry.action)).toEqual(['Submit', 'ReviewPublished'])
  })

  it('leaves every other field exactly as it was stored', async () => {
    stored([moderated])

    expect((await activityLogDB.list('book-1'))[0]).toMatchObject({
      booking_id: 'book-1',
      action: 'ReviewPublished',
      from_status: 'none',
      to_status: 'published',
      actor: 'admin',
      actor_id: 'admin-1',
      seq: 1,
    })
  })

  it('reads an instant it cannot make sense of as no instant, not as an object', async () => {
    // A fabricated time in an audit log is a claim nothing recorded; a blank is
    // merely unhelpful. Neither may be an object a renderer will choke on.
    stored([{ ...submit, at: null }, { ...submit, booking_id: 'book-1', seq: 1, at: { seconds: 0 } }])

    const history = await activityLogDB.list('book-1')

    expect(history.map((entry) => entry.at)).toEqual(['', ''])
  })
})