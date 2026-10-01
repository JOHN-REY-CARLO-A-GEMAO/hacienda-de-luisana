// Ordinary desired-invariant failures, on official emulators only.
import { afterAll, beforeAll, beforeEach, it } from 'vitest'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { environment, reset, seed, context, canonicalBooking, canonicalPaid, denied } from './helpers'
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
const id = scenarios.booking.id
it('F01 CANONICAL DESIRED: unsigned create with arbitrary owner is denied', async () => {
  await denied(() => setDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', id), canonicalBooking()))
})
it('F01 CANONICAL DESIRED: signed-in create cannot name a different booking owner', async () => {
  await denied(() => setDoc(doc(context(env, 'secondGuest').firestore(), 'bookings', id), canonicalBooking()))
})
it('F01 CANONICAL DESIRED: malformed count/reversed dates are not accepted', async () => {
  await denied(() => setDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), canonicalBooking({ guests: 'synthetic-invalid', check_out: '2099-11-01' })))
})
it('F02 CANONICAL DESIRED: Guest cannot rewrite the recorded financial quote', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await denied(() => updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), { amount_due: 0, stay_total: 1, security_deposit: 0 }))
})
it('F03 CANONICAL DESIRED: Guest cannot downgrade Approved verification or replace confirmed proof', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  await denied(() => updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), { payment_status: 'pending', payment_proof_url: scenarios.evidence.foreignUid.path }))
})
it('F15 CANONICAL DESIRED: legitimate Admin B progresses while preserving Admin A verification', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  await assertSucceeds(updateDoc(doc(context(env, 'adminB').firestore(), 'bookings', id), { status: 'Checked-In' }))
})
it('F18 CANONICAL DESIRED: Guest cannot append an Admin decision merely by self-signing its actor', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await denied(() => setDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id, 'activity', 'phase0-event'), {
    booking_id: id, actor: 'guest', actor_id: scenarios.identities.anonymousGuest.uid, action: 'Approve', from_status: 'Pending', to_status: 'Approved', at: '1900-01-01T00:00:00Z',
  }))
})
it('F20 CANONICAL DESIRED: a Guest cannot mint an authoritative physical granted event', async () => {
  await denied(() => setDoc(doc(context(env, 'anonymousGuest').firestore(), 'access_logs', 'phase0-granted'), {
    timestamp: '2026-10-01T04:00:00Z', uid: scenarios.identities.anonymousGuest.uid, ref_id: scenarios.booking.ref_id, result: 'granted', reason: 'synthetic untrusted client claim',
  }))
})
it('F05 LEGACY CANONICAL DESIRED: namespace alone does not authorize upload for a nonexistent booking', async () => {
  await denied(() => uploadBytes(ref(context(env, 'anonymousGuest').storage(), `payments/${scenarios.identities.anonymousGuest.uid}/SYNTHETIC-NONEXISTENT-BOOKING/proof.png`), new Uint8Array([1]), { contentType: 'image/png' }))
})
