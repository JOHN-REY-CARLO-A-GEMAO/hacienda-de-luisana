// CANONICAL rules on owned local Firebase emulators. Not deployed-rule proof.
// Storage tests are LEGACY FIREBASE STORAGE, not the current Supabase bucket.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'
import { environment, reset, seed, context, canonicalBooking, canonicalPaid, denied } from './helpers'
import { scenarios, NOW } from '../fixtures'
import { interpretStoredStatus } from '../../../src/lib/booking'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
const id = scenarios.booking.id
const path = scenarios.evidence.valid.path
const bytes = new Uint8Array([1, 2, 3, 4])

it('F01-CANONICAL-CURRENT: signed-out arbitrary nonempty owner can create', async () => {
  await assertSucceeds(setDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', id), canonicalBooking({ uid: scenarios.identities.forgedUid.uid })))
})
it('F01-CANONICAL-CURRENT: authenticated second Guest can create a booking naming the first Guest', async () => {
  await assertSucceeds(setDoc(doc(context(env, 'secondGuest').firestore(), 'bookings', id), canonicalBooking()))
})
it.each([
  ['guests-string', { guests: 'synthetic-not-a-number' }], ['guests-zero', { guests: 0 }],
  ['reversed-checkout', { check_out: '2099-11-01' }], ['invalid-checkout', { check_out: 'synthetic-not-a-date' }],
  ['unknown-accommodation', { accommodation: 'phase0-nonexistent-unit' }], ['uid-null', { uid: null }],
  ['unassociated-proof', { payment_proof_url: scenarios.evidence.foreignUid.path }],
] as const)('F01-CANONICAL-CURRENT malformed %s is accepted', async (_name, patch) => {
  await assertSucceeds(setDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), canonicalBooking(patch)))
})
it('F01-CANONICAL-CONTROLS: own anonymous create/read works; second Guest and signed-out reads are refused', async () => {
  const own = context(env, 'anonymousGuest').firestore()
  await assertSucceeds(setDoc(doc(own, 'bookings', id), canonicalBooking()))
  await assertSucceeds(getDoc(doc(own, 'bookings', id)))
  await denied(() => getDoc(doc(context(env, 'secondGuest').firestore(), 'bookings', id)))
  await denied(() => getDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', id)))
})
it('F02-CANONICAL-CURRENT: owner controls quote/deposit/balance/policy/hold', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await assertSucceeds(updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), {
    stay_total: 1, amount_due: 0, security_deposit: 0, balance_due: 0, policy_version: 'phase0-forged-policy',
    policy_effective_date: '2099-01-01', hold_expires_at: '2099-12-31T00:00:00.000Z',
  }))
})
it('F03-CANONICAL-CURRENT: Approved verified payment may be downgraded by its Guest; reader then interprets Payment Pending', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  const own = doc(context(env, 'anonymousGuest').firestore(), 'bookings', id)
  await assertSucceeds(updateDoc(own, { payment_status: 'pending' }))
  const data = (await getDoc(own)).data()!
  expect(data.status).toBe('Approved')
  expect(interpretStoredStatus(data.status, data)).toBe('Payment Pending')
})
it('F03-CANONICAL-CURRENT: confirmed proof may be replaced with a foreign UID path', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  await assertSucceeds(updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), { payment_proof_url: scenarios.evidence.foreignUid.path }))
})
it('F02-CANONICAL-CURRENT: paid owner can choose a bounded refund total without immutable policy validation', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  await assertSucceeds(updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), {
    status: 'Cancelled', refund_status: 'initiated', refund_total: 11999, refund_breakdown: { refundTotal: 11999 },
  }))
})
it('F03-CANONICAL-CONTROL: Guest cannot invent approval/verification markers', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await denied(() => updateDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id), {
    status: 'Approved', payment_status: 'verified', amount_verified: 12000, payment_verified_by: scenarios.identities.anonymousGuest.uid, payment_verified_at: NOW,
  }))
})
it('F04-CANONICAL-CURRENT: synthetic unverified allowlisted token claim gets Admin reads; no provider claimability inference', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await assertSucceeds(getDoc(doc(context(env, 'unverifiedAllowlisted').firestore(), 'bookings', id)))
})
it('F04-CANONICAL-CONTROLS: both stored Admins can read, non-Admin cannot; self-promotion is refused', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  for (const who of ['adminA', 'adminB'] as const) await assertSucceeds(getDoc(doc(context(env, who).firestore(), 'bookings', id)))
  await denied(() => getDoc(doc(context(env, 'nonAdmin').firestore(), 'bookings', id)))
  await denied(() => setDoc(doc(context(env, 'nonAdmin').firestore(), 'profiles', scenarios.identities.nonAdmin.uid), { uid: scenarios.identities.nonAdmin.uid, role: 'admin' }))
})
it('F07-CANONICAL-CURRENT: used reference can reset to available, then be deleted', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'payment_references', 'PHASE0-TRANSFER-001'), { reference: 'PHASE0-TRANSFER-001', amount: 12000, status: 'used', used_by: id }))
  const entry = doc(context(env, 'adminA').firestore(), 'payment_references', 'PHASE0-TRANSFER-001')
  await assertSucceeds(updateDoc(entry, { status: 'available' }))
  await assertSucceeds(deleteDoc(entry))
})
it('F15-CANONICAL-CURRENT: Admin B cannot check in without changing Admin A verifier; A can', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalPaid()))
  await denied(() => updateDoc(doc(context(env, 'adminB').firestore(), 'bookings', id), { status: 'Checked-In' }))
  await assertSucceeds(updateDoc(doc(context(env, 'adminA').firestore(), 'bookings', id), { status: 'Checked-In' }))
})
it('F16-CANONICAL-CONTROL: authenticated second identity cannot claim an anonymous booking by changing its UID', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await denied(() => updateDoc(doc(context(env, 'authenticatedGuest').firestore(), 'bookings', id), { uid: scenarios.identities.authenticatedGuest.uid }))
})
it('F18-CANONICAL-CURRENT: correctly self-signed Guest can append false approval with an arbitrary client time', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  await assertSucceeds(setDoc(doc(context(env, 'anonymousGuest').firestore(), 'bookings', id, 'activity', 'phase0-false-event'), {
    booking_id: id, actor: 'guest', actor_id: scenarios.identities.anonymousGuest.uid, action: 'Approve',
    from_status: 'Pending', to_status: 'Approved', at: '1900-01-01T00:00:00.000Z', seq: 0,
  }))
})
it('F18-CANONICAL-CONTROL: Guest cannot impersonate Admin actor; logs are append-only', async () => {
  await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', id), canonicalBooking()))
  const entry = doc(context(env, 'anonymousGuest').firestore(), 'bookings', id, 'activity', 'phase0-event')
  const data = { booking_id: id, actor: 'guest', actor_id: scenarios.identities.anonymousGuest.uid, action: 'Submit', from_status: 'Pending', to_status: 'Pending', at: NOW, seq: 0 }
  await denied(() => setDoc(entry, { ...data, actor: 'admin', actor_id: scenarios.identities.adminA.uid }))
  await assertSucceeds(setDoc(entry, data))
  await denied(() => updateDoc(entry, { action: 'Approve' }))
})
it('F20-CANONICAL-CURRENT: own UID can assert granted access with no physical gateway authentication', async () => {
  await assertSucceeds(setDoc(doc(context(env, 'anonymousGuest').firestore(), 'access_logs', 'phase0-synthetic-grant'), {
    timestamp: NOW, uid: scenarios.identities.anonymousGuest.uid, ref_id: scenarios.booking.ref_id,
    result: 'granted', reason: 'Synthetic claim only; NO device or door used',
  }))
})
it('F05-LEGACY-STORAGE-CONTROLS: own upload/read works; foreign/unsigned reads, foreign upload and Guest delete fail', async () => {
  const own = ref(context(env, 'anonymousGuest').storage(), path)
  await assertSucceeds(uploadBytes(own, bytes, { contentType: 'image/png' }))
  await assertSucceeds(getBytes(own))
  await denied(() => getBytes(ref(context(env, 'secondGuest').storage(), path)))
  await denied(() => getBytes(ref(env.unauthenticatedContext().storage(), path)))
  await denied(() => uploadBytes(ref(context(env, 'secondGuest').storage(), path), bytes, { contentType: 'image/png' }))
  await denied(() => deleteObject(own))
  await assertSucceeds(deleteObject(ref(context(env, 'unverifiedAllowlisted').storage(), path)))
})
it('F05-LEGACY-STORAGE-CURRENT: own namespace does not require a valid booking association', async () => {
  await assertSucceeds(uploadBytes(ref(context(env, 'anonymousGuest').storage(), `payments/${scenarios.identities.anonymousGuest.uid}/SYNTHETIC-NONEXISTENT-BOOKING/proof.png`), bytes, { contentType: 'image/png' }))
})
