/**
 * TEMPORARY verification of the Inquiry -> Quoted -> Pending lifecycle.
 * Delete after use. Mirrors tmp-repro-create.rules.test.ts's harness.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore'

const PROJECT = 'demo-hacienda'
const GUEST_UID = 'guest-inquiry-uid'
let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(join(__dirname, '../../firestore.rules'), 'utf8'),
    },
  })
})

afterAll(async () => { await env?.cleanup() })

// Well past the 30-day lead time.
const CHECK_IN = '2027-02-15'
const CHECK_OUT = '2027-02-16'

const inquiry = {
  uid: GUEST_UID,
  guest_name: 'Test Guest',
  phone: '09171234567',
  email: 'guest@example.com',
  check_in: CHECK_IN,
  check_out: CHECK_OUT,
  guests: 2,
  accommodation: 'main-house',
  status: 'Inquiry',
  created_at: '2026-10-14T00:00:00.000Z',
}

describe('Inquiry -> Quoted -> Pending', () => {
  it('1. a Guest may create an Inquiry with no money at all', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(setDoc(doc(ctx, 'bookings/b1'), inquiry)).resolves.toBeDefined()
  })

  it('2. a Guest may NOT attach money fields to the Inquiry', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(setDoc(doc(ctx, 'bookings/b2'), {
      ...inquiry,
      stay_total: 100,
      amount_due: 50,
      amount_claimed: 50,
    })).rejects.toThrow()
  })

  it('3. the Admin may price it (Inquiry -> Quoted) and write the figures', async () => {
    const admin = env.unauthenticatedContext().firestore()
    // admin ctx has no role; seed a profile so isAdmin() is true via the allowlist
    // instead: use the bootstrap allowlist email.
    const adminCtx = env.authenticatedContext('admin-uid', { email: 'gemaojohnreyarguilles@gmail.com' }).firestore()
    await expect(updateDoc(doc(adminCtx, 'bookings/b1'), {
      rate_amount: 6000, rate_unit: 'standard_stay', rate_classification: 'weekday',
      stay_total: 6000, amount_due: 3000, balance_due: 3000, security_deposit: 2000,
      nights: 1, payment_plan: 'down-payment', amount_claimed: 0,
      policy_version: 'v1', policy_effective_date: '2026-01-01',
      refund_policy_snapshot: { tier: 'a' },
      status: 'Quoted',
    })).resolves.toBeDefined()
    void admin
  })

  it('4. the Guest may attach proof and move Quoted -> Pending', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(updateDoc(doc(ctx, 'bookings/b1'), {
      status: 'Pending',
      payment_status: 'pending',
      payment_proof_url: 'https://example.com/proof.png',
      amount_claimed: 3000,
    })).resolves.toBeDefined()
  })

  it('5. the Guest may NOT rewrite the quoted figures afterwards', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(updateDoc(doc(ctx, 'bookings/b1'), { stay_total: 1 })).rejects.toThrow()
  })

  it('6. the Guest may NOT claim less than the quoted downpayment', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(updateDoc(doc(ctx, 'bookings/b1'), { amount_claimed: 1 })).rejects.toThrow()
  })

  it('7. a Guest cannot pay an Inquiry that was never quoted', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    await expect(setDoc(doc(ctx, 'bookings/b7'), inquiry)).resolves.toBeDefined()
    await expect(updateDoc(doc(ctx, 'bookings/b7'), {
      status: 'Pending', payment_status: 'pending',
      payment_proof_url: 'https://example.com/p.png', amount_claimed: 3000,
    })).rejects.toThrow()
  })

  it('8. the stored document kept the Admin figures', async () => {
    const ctx = env.authenticatedContext(GUEST_UID).firestore()
    const snap = await getDoc(doc(ctx, 'bookings/b1'))
    expect(snap.data()?.stay_total).toBe(6000)
    expect(snap.data()?.status).toBe('Pending')
  })
})