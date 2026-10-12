// Actual official Firebase SDK. The JS adapter uses its real transaction code.
// The cached batch protocol mirrors a blind batch write; it is NOT execution of
// Flutter and cannot certify a device/native stream schedule.
import { vi } from 'vitest'
import { doc, getDoc, getDocs, collection, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { seed, context, canonicalBooking } from './helpers'
import { booking, actor, scenarios } from '../fixtures'
import { applyAction, type BookingState } from '../../../src/lib/booking'

const control = vi.hoisted(() => ({
  holdDb: null as unknown,
  holdDocId: null as null | string,
  captured: null as null | (() => void),
  release: null as null | Promise<void>,
}))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, getDocs: async (query: Parameters<typeof sdk.getDocs>[0]) => {
    const snapshot = await sdk.getDocs(query)
    // The barrier is keyed on a document id so a scenario can hold the *right*
    // client's availability query â€” the web adapter's whole protocol hinges on
    // what that query saw, so which snapshot is frozen is the whole test.
    if (control.holdDocId && query.firestore === control.holdDb && snapshot.docs.some(row => row.id === control.holdDocId)) {
      control.captured?.(); await control.release
    }
    return snapshot
  } }
})

async function adapterAs(db: Firestore, uid: string) {
  vi.resetModules()
  vi.doMock('../../../src/lib/firebase', () => ({ db, auth: { currentUser: { uid } }, isFirebaseConfigured: true }))
  return (await import('../../../src/lib/firestoreBookings')).cloudBookingsDB
}
// RulesTestContext exposes compat clients; unwrap the documented modular
// delegate so query.firestore identity is the same object held by the barrier.
function delegate(env: RulesTestEnvironment, who: 'adminA' | 'adminB'): Firestore {
  return (context(env, who).firestore() as unknown as { _delegate: Firestore })._delegate
}
/** Write a fixture Booking, dropping the synthetic id from the stored document. */
async function put(db: Firestore, id: string, data: Record<string, unknown>) {
  const { id: _id, ...rest } = data as { id: string }
  void _id
  await setDoc(doc(db, 'bookings', id), rest)
}

/** Freeze `db`'s availability query once it has seen `docId`. */
function arm(db: Firestore, docId: string) {
  let captured!: () => void
  let release!: () => void
  const reached = new Promise<void>(resolve => { captured = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  control.holdDb = db
  control.holdDocId = docId
  control.captured = captured
  control.release = released
  return { reached, release() { control.holdDocId = null; release() } }
}

function approvedCount(rows: { data: () => Record<string, unknown> | undefined }[]): number {
  return rows.filter(row => row.data()?.status === 'Approved').length
}
/** The same fixtures, written through one owner context, in a stable order. */
async function seedBookings(env: RulesTestEnvironment, states: { id: string }[]): Promise<void> {
  await seed(env, async owner => {
    for (const state of states) await put(owner.firestore(), state.id, state as Record<string, unknown>)
  })
}

export async function officialLastUnitSchedule(env: RulesTestEnvironment) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const b = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid }), id: 'phase0-booking-b' }
  await seed(env, async owner => { for (const state of [a, b]) { const { id, ...data } = state; await setDoc(doc(owner.firestore(), 'bookings', id), data) } })
  const dbA = delegate(env, 'adminA')
  const dbB = delegate(env, 'adminB')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const serviceB = await adapterAs(dbB, scenarios.identities.adminB.uid)
  const barrier = arm(dbB, a.id)
  const pendingB = serviceB.transitionApprove(b.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor('adminB'))
  await barrier.reached
  const resultA = await serviceA.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
  barrier.release()
  const resultB = await pendingB
  const rows = await Promise.all([a, b].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  return { results: [resultA, resultB], approvedCount: approvedCount(rows) }
}

/**
 * The exact window ADR-0006's coupling reads cannot see: the rival Booking does
 * not exist when the availability query runs, and it is created *and* approved
 * before the approval's transaction reads the lock. A protocol that only
 * serialises commits approves both; only a protocol that invalidates the
 * earlier snapshot notices.
 */
export async function officialLateCreatedRivalSchedule(env: RulesTestEnvironment) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const b = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid }), id: 'phase0-booking-b' }
  await seedBookings(env, [a])
  const dbA = delegate(env, 'adminA')
  const dbB = delegate(env, 'adminB')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const serviceB = await adapterAs(dbB, scenarios.identities.adminB.uid)

  const barrier = arm(dbA, a.id)
  const pendingA = serviceA.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
  await barrier.reached

  // Created after A's availability snapshot existed, and approved by the other
  // Admin while A is still holding that snapshot.
  await seed(env, owner => put(owner.firestore(), b.id, b))
  const resultB = await serviceB.transitionApprove(b.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor('adminB'))

  barrier.release()
  const resultA = await pendingA
  const rows = await Promise.all([a, b].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  const lock = await getDoc(doc(dbA, 'site_config', 'approval_lock_main-house'))
  return { results: [resultA, resultB], approvedCount: approvedCount(rows), lockVersion: lock.data()?.version ?? null }
}

/**
 * Capacity comes from configuration, not from the caller. `unitsAvailable` is
 * whatever the caller claims â€” 999, a string, or absent â€” and the configured
 * capacity of the Main House is one unit either way.
 */
export async function officialTrustedCapacitySchedule(env: RulesTestEnvironment, claimed?: unknown) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const b = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid }), id: 'phase0-booking-b' }
  await seedBookings(env, [a, b])
  const dbA = delegate(env, 'adminA')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const claim = { bookings: [], ...(claimed === undefined ? {} : { unitsAvailable: claimed as number }) }
  const first = await serviceA.transitionApprove(a.id, { type: 'Approve', availability: claim }, actor())
  const second = await serviceA.transitionApprove(b.id, { type: 'Approve', availability: claim }, actor())
  const rows = await Promise.all([a, b].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  return { results: [first, second], approvedCount: approvedCount(rows) }
}

/**
 * Two Accommodations are two locks. The dates are identical and the approvals
 * are issued together, so this fails if the coordination document is global, or
 * if a contended approval gives up instead of re-reading the world.
 */
export async function officialIndependentAccommodationsSchedule(env: RulesTestEnvironment) {
  const house = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const annex = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid, accommodation: 'annex' }), id: 'phase0-booking-b' }
  await seedBookings(env, [house, annex])
  const dbA = delegate(env, 'adminA')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const results = await Promise.all([
    serviceA.transitionApprove(house.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()),
    serviceA.transitionApprove(annex.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()),
  ])
  const rows = await Promise.all([house, annex].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  const versions = await Promise.all([
    getDoc(doc(dbA, 'site_config', 'approval_lock_main-house')),
    getDoc(doc(dbA, 'site_config', 'approval_lock_annex')),
  ])
  return {
    results,
    approvedCount: approvedCount(rows),
    lockVersions: versions.map(row => row.data()?.version ?? null),
  }
}

/** The same two Bookings, approved one after the other. */
export async function officialSequentialControl(env: RulesTestEnvironment) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const b = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid }), id: 'phase0-booking-b' }
  await seedBookings(env, [a, b])
  const dbA = delegate(env, 'adminA')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const claim = { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } } as const
  const first = await serviceA.transitionApprove(a.id, claim, actor())
  const second = await serviceA.transitionApprove(b.id, claim, actor())
  const rows = await Promise.all([a, b].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  return { results: [first, second], approvedCount: approvedCount(rows) }
}

/**
 * Both Admins approving the *same* Pending Booking. Nothing here can be double
 * booked, so the question is only whether one Admin's approval is committed
 * twice — which is a control for the protocol, not a capacity case.
 */
export async function officialSameBookingDoubleApproval(env: RulesTestEnvironment) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  await seedBookings(env, [a])
  const dbA = delegate(env, 'adminA')
  const dbB = delegate(env, 'adminB')
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const serviceB = await adapterAs(dbB, scenarios.identities.adminB.uid)

  const barrier = arm(dbA, a.id)
  const pendingA = serviceA.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
  await barrier.reached
  const resultB = await serviceB.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor('adminB'))
  barrier.release()
  const resultA = await pendingA

  const final = await getDoc(doc(dbA, 'bookings', a.id))
  const entries = await getDocs(collection(dbA, 'bookings', a.id, 'activity'))
  return {
    results: [resultA, resultB],
    committedApprovals: entries.docs.filter(row => row.data().action === 'Approve').length,
    verifier: final.data()?.payment_verified_by ?? null,
  }
}

export async function officialCachedSamePendingProtocol(env: RulesTestEnvironment) {
  const id = scenarios.booking.id
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  // BOTH Admins cache Pending before either mutation. Both decisions are made
  // before the first commit. B's Activity read is processed AFTER A's commit,
  // modelling delayed network request processing rather than random sleeps.
  const cached = booking({ check_in: '2099-12-01', check_out: '2099-12-03', hold_expires_at: '2099-10-02T00:00:00.000Z' })
  const decisions = [actor(), actor('adminB')].map(who => applyAction(cached as BookingState, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, who))
  for (const [index, decision] of decisions.entries()) {
    if (!decision.ok) throw new Error(decision.reason)
    const db = context(env, index === 0 ? 'adminA' : 'adminB').firestore()
    const entry = collection(db, 'bookings', id, 'activity')
    const written = await getDocs(entry)
    const seq = written.docs.reduce((max, row) => Math.max(max, Number(row.data().seq ?? -1)), -1) + 1
    const batch = writeBatch(db)
    batch.update(doc(db, 'bookings', id), decision.patch)
    batch.set(doc(entry, String(seq)), { ...decision.entries[0], seq })
    await batch.commit()
  }
  const db = context(env, 'adminA').firestore()
  const entries = await getDocs(collection(db, 'bookings', id, 'activity'))
  const final = (await getDoc(doc(db, 'bookings', id))).data()!
  return { committedApprovals: entries.docs.filter(row => row.data().action === 'Approve').length, final }
}