/**
 * Manual reference acceptance has the same stored-state problem as an OCR read:
 * the general Booking update rule can refuse a money-neutral correction on a
 * historical Booking. These cases exercise the real rules text, and mirror the
 * canonical emulator cases in test/emulator/rules.emulator.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, ruleTimestamp, type AuthState, type DocData } from './engine'
import {
  ADMIN_EMAIL,
  ADMIN_UID,
  BOOKING_ID,
  GUEST_UID,
  OTHER_GUEST_UID,
  adminOcrEvidencePatch,
  adminReferenceCorrectionPatch,
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  emailGuest,
  paidBookingDoc,
  promotedAdmin,
  request,
  storeWith,
} from './context'

const decide = compileRules(readFileSync(join(__dirname, '../../firestore.rules'), 'utf8'))
const store = storeWith({
  [GUEST_UID]: { uid: GUEST_UID, role: 'guest' },
  'promoted-admin-1': { uid: 'promoted-admin-1', role: 'admin' },
})
const pending = bookingDoc({
  payment_proof_url: `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`,
  payment_status: 'pending',
  amount_claimed: 5000,
  ...adminOcrEvidencePatch(),
})
const legacy = { ...pending, status: 'Reserved', payment_status: 'pending' }
const patch = adminReferenceCorrectionPatch()
const update = (resourceData: DocData, changes: DocData, auth: AuthState = allowlistedAdmin()) =>
  decide(request({
    path: `bookings/${BOOKING_ID}`,
    method: 'update',
    auth,
    resourceData,
    requestData: { ...resourceData, ...changes },
  }), { store }).allow

describe('bookings: the Admin confirms or corrects a Payment reference', () => {
  it('accepts the exact saveCorrection patch from an allowlisted Admin', () => {
    expect(update(pending, patch)).toBe(true)
  })

  it('accepts a Profile-promoted Admin who signs their own correction', () => {
    const admin = promotedAdmin()
    expect(update(pending, adminReferenceCorrectionPatch({
      payment_reference_corrected_by: admin.uid,
    }), admin)).toBe(true)
  })

  it('allows a money-neutral correction on a historical unverified Reserved Booking', () => {
    // The general path refuses even a no-op here. Acceptance must not verify,
    // re-status or repair the stored money fields as a side effect.
    expect(update(legacy, {})).toBe(false)
    expect(update(legacy, patch)).toBe(true)
  })

  it('keeps verified money and its marker intact while recording the previous reference', () => {
    const verified = paidBookingDoc()
    expect(update(verified, adminReferenceCorrectionPatch({
      payment_reference_previous: verified.payment_reference,
    }))).toBe(true)
  })

  it('allows re-confirming an unchanged reference with fresh acceptance metadata', () => {
    const accepted = { ...pending, ...patch }
    expect(update(accepted, {
      payment_reference_corrected_at: ruleTimestamp('2026-11-02T04:00:00Z'),
    })).toBe(true)
  })

  it('accepts omitted optional details and explicit null clears', () => {
    expect(update(pending, {
      payment_reference: patch.payment_reference,
      payment_reference_source: patch.payment_reference_source,
      payment_reference_corrected_at: patch.payment_reference_corrected_at,
      payment_reference_corrected_by: patch.payment_reference_corrected_by,
    })).toBe(true)
    expect(update(pending, { ...patch, payment_sender_name: null, payment_date: null })).toBe(true)
  })

  it('refuses Guests, including the owner, and signed-out callers the Admin metadata', () => {
    for (const auth of [emailGuest(), anonymousGuest(), emailGuest(OTHER_GUEST_UID), null]) {
      expect(update(legacy, patch, auth)).toBe(false)
    }
  })

  it('does not recognise an unverified allowlisted address or an admin custom claim', () => {
    expect(update(legacy, patch, {
      uid: ADMIN_UID,
      token: { email: ADMIN_EMAIL, email_verified: false },
    })).toBe(false)
    expect(update(legacy, patch, { uid: ADMIN_UID, token: { admin: true } })).toBe(false)
  })

  it('refuses a correction signed in another Admin’s name', () => {
    expect(update(legacy, adminReferenceCorrectionPatch({
      payment_reference_corrected_by: 'another-admin',
    }))).toBe(false)
  })

  it('requires human-correction provenance, not just an allowed key', () => {
    expect(update(legacy, adminReferenceCorrectionPatch({
      payment_reference_source: 'ocr',
    }))).toBe(false)
    expect(update(legacy, adminReferenceCorrectionPatch({
      payment_reference_source: '',
    }))).toBe(false)
    expect(update(legacy, adminReferenceCorrectionPatch({
      payment_reference_corrected_by: '',
    }))).toBe(false)
  })

  it.each([
    ['Booking status', { status: 'Approved' }],
    ['payment status', { payment_status: 'verified' }],
    ['verified amount', { amount_verified: 5000 }],
    ['verification author', { payment_verified_by: 'another-admin' }],
    ['verification instant', { payment_verified_at: '2026-11-02T04:00:00Z' }],
    ['Guest identity', { uid: OTHER_GUEST_UID }],
    ['Payment proof', { payment_proof_url: 'payments/someone-else/proof.jpg' }],
    ['OCR evidence', { ocr_reference: '0000000000' }],
    ['price', { amount_due: 1 }],
  ])('cannot smuggle a change to %s through the correction door', (_label, extra) => {
    expect(update(legacy, { ...patch, ...extra })).toBe(false)
  })

  it('cannot remove a protected money field through the correction door', () => {
    const verified = paidBookingDoc()
    const next: DocData = { ...verified, ...patch }
    delete next.amount_verified
    expect(decide(request({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: allowlistedAdmin(),
      resourceData: verified,
      requestData: next,
    }), { store }).allow).toBe(false)
  })
})
