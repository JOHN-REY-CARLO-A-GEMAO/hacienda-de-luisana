// Actual official Firebase SDK. The JS adapter uses its real transaction code.
// The cached batch protocol mirrors Flutter's existing write shape; it is NOT
// execution of Flutter and cannot certify a device/native stream schedule.
import { vi } from 'vitest'
import { doc, getDoc, getDocs, collection, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { seed, context, canonicalBooking } from './helpers'
import { booking, actor, scenarios } from '../fixtures'
import { applyAction, type BookingState } from '../../../src/lib/booking'

const control = vi.hoisted(() => ({ holdDb: null as unknown, captured: null as null | (() => void), release: null as null | Promise<void> }))
vi.mock('firebase/firestore', async importOriginal => {
  const sdk = await importOriginal<typeof import('firebase/firestore')>()
  return { ...sdk, getDocs: async (query: Parameters<typeof sdk.getDocs>[0]) => {
    const snapshot = await sdk.getDocs(query)
    if (query.firestore === control.holdDb && snapshot.docs.some(doc => doc.id === 'phase0-booking-a')) {
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
export async function officialLastUnitSchedule(env: RulesTestEnvironment) {
  const a = { ...canonicalBooking(), id: 'phase0-booking-a' }
  const b = { ...canonicalBooking({ uid: scenarios.identities.secondGuest.uid }), id: 'phase0-booking-b' }
  await seed(env, async owner => { for (const state of [a, b]) { const { id, ...data } = state; await setDoc(doc(owner.firestore(), 'bookings', id), data) } })
  // RulesTestContext exposes compat clients; unwrap the documented modular
  // delegate so query.firestore identity is the same object held by barrier.
  const dbA = (context(env, 'adminA').firestore() as unknown as { _delegate: Firestore })._delegate
  const dbB = (context(env, 'adminB').firestore() as unknown as { _delegate: Firestore })._delegate
  const serviceA = await adapterAs(dbA, scenarios.identities.adminA.uid)
  const serviceB = await adapterAs(dbB, scenarios.identities.adminB.uid)
  let captured!: () => void; let release!: () => void
  const capturedPromise = new Promise<void>(resolve => { captured = resolve })
  const releasePromise = new Promise<void>(resolve => { release = resolve })
  control.holdDb = dbB; control.captured = captured; control.release = releasePromise
  const pendingB = serviceB.transitionApprove(b.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor('adminB'))
  await capturedPromise
  const resultA = await serviceA.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
  control.holdDb = null; release()
  const resultB = await pendingB
  const rows = await Promise.all([a, b].map(state => getDoc(doc(dbA, 'bookings', state.id))))
  return { results: [resultA, resultB], approvedCount: rows.filter(row => row.data()?.status === 'Approved').length }
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
