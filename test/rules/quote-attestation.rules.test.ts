/**
 * Booking creation moved behind `submitBooking`.
 *
 * The callable uses the Admin SDK after validating the published rate and runs
 * the conflict read plus Booking/Activity writes in one transaction. Firestore
 * Rules therefore have one deliberately simple responsibility at this boundary:
 * no browser client—quoted or not—may create a Booking. Admin/manual creation and
 * updates to already-created records keep their existing rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, ruleTimestamp, type DocData, type Store } from './engine'
import {
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  emailGuest,
  GUEST_UID,
  guestPaymentPatch,
  request,
} from './context'

const decide = compileRules(readFileSync(join(__dirname, '../../firestore.rules'), 'utf8'))
const NOW = '2026-10-01T04:00:00Z'

const quote = (overrides: DocData = {}): DocData => ({
  accommodation: 'main-house', check_in: '2026-10-31', check_out: '2026-11-01', guests: 10,
  pet_count: 0, late_checkout_hours: 0, rate_unit: 'standard_stay', rate_amount: 5000,
  rate_classification: 'weekday', nights: 1, stay_total: 5000, amount_due: 2500,
  balance_due: 2500, security_deposit: 500, payment_plan: 'down-payment',
  policy_version: 'official-v9', policy_effective_date: '2026-10-01', rates_version: 'official-v9',
  refund_policy_snapshot: null, bound_uid: GUEST_UID, created_at: ruleTimestamp(NOW),
  expires_at: ruleTimestamp('2026-10-01T05:00:00.000Z'), ...overrides,
})

const booking = (overrides: DocData = {}): DocData => bookingDoc({
  accommodation: 'main-house', check_in: '2026-10-31', check_out: '2026-11-01', guests: 10,
  nights: 1, status: 'Pending', payment_status: 'pending', payment_plan: 'down-payment',
  payment_proof_url: 'payments/guest-uid-1/HDL/proof-1.png', amount_claimed: 2500,
  rate_unit: 'standard_stay', rate_amount: 5000, rate_classification: 'weekday',
  stay_total: 5000, amount_due: 2500, balance_due: 2500, security_deposit: 500,
  policy_version: 'official-v9', policy_effective_date: '2026-10-01', quote_id: 'quote-1',
  ...overrides,
})

const store: Store = {
  'site_config/booking': { minimumBookingLeadTimeDays: 30, quotes_required: true },
  'booking_quotes/quote-1': quote(),
}

const directCreate = (auth: ReturnType<typeof anonymousGuest> | null, data = booking()) =>
  decide(request({ method: 'create', path: 'bookings/direct-attempt', auth, requestData: data, time: NOW }), { store }).allow

describe('server-only website Booking boundary', () => {
  it('refuses direct creates even with an exact, live, identity-bound quote', () => {
    expect(directCreate(anonymousGuest())).toBe(false)
  })

  it('refuses signed-out direct creates and every formerly accepted quote variant', () => {
    expect(directCreate(null)).toBe(false)
    expect(directCreate(anonymousGuest(), booking({ quote_id: null }))).toBe(false)
    expect(directCreate(anonymousGuest(), booking({ quote_id: 'missing' }))).toBe(false)
    expect(directCreate(anonymousGuest(), booking({ stay_total: 1000, amount_due: 500, balance_due: 500 }))).toBe(false)
  })

  it('preserves Admin/manual Booking creation without requiring an attestation', () => {
    expect(decide(request({
      method: 'create', path: 'bookings/walk-in', auth: allowlistedAdmin(),
      requestData: booking({ quote_id: null }), time: NOW,
    }), { store }).allow).toBe(true)
  })

  it('lets an owner resend proof but never reprice an existing Booking', () => {
    const before = booking({ payment_status: 'rejected' })
    const update = (patch: DocData) => decide(request({
      method: 'update', path: 'bookings/existing', auth: anonymousGuest('guest-uid-1'),
      resourceData: before,
      requestData: booking({
        payment_status: 'pending', payment_reject_reason: null,
        payment_proof_url: 'payments/guest-uid-1/HDL/proof-2.png',
        payment_reference: '3104257798', ...patch,
      }),
      time: '2026-10-20T04:00:00Z',
    }), { store }).allow

    expect(update({})).toBe(true)
    expect(update({ stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500 })).toBe(false)
    expect(update({ security_deposit: 0 })).toBe(false)
  })

  it('does not change legacy owner update decisions', () => {
    const before = bookingDoc({ status: 'Payment Pending' })
    const after = { ...before, ...guestPaymentPatch() }
    const result = decide(request({
      method: 'update', path: 'bookings/legacy', auth: emailGuest(),
      resourceData: before, requestData: after, time: '2026-10-20T04:00:00Z',
    }), { store: { [`profiles/${GUEST_UID}`]: { uid: GUEST_UID, role: 'guest' } } })
    expect(result.allow).toBe(true)
  })

  describe('configuration and quote documents', () => {
    it('allows only Admins to change a valid enforcement switch', () => {
      const publish = (auth: ReturnType<typeof anonymousGuest>, value: unknown) => decide(request({
        method: 'update', path: 'site_config/booking', auth,
        resourceData: { minimumBookingLeadTimeDays: 30 },
        requestData: { minimumBookingLeadTimeDays: 30, quotes_required: value }, time: NOW,
      }), { store }).allow
      expect(publish(allowlistedAdmin(), true)).toBe(true)
      expect(publish(anonymousGuest(), true)).toBe(false)
      expect(publish(allowlistedAdmin(), 'true')).toBe(false)
    })

    it('closes server quote and inventory-lock documents to every client, including Admins', () => {
      for (const path of ['booking_quotes/quote-1', 'booking_inventory_locks/main-house']) {
        for (const method of ['get', 'create', 'update', 'delete'] as const) {
          for (const auth of [anonymousGuest(), allowlistedAdmin()]) {
            expect(decide(request({
              method, path, auth, time: NOW,
              resourceData: path.startsWith('booking_quotes/') ? quote() : { revision: 1 },
              requestData: method === 'delete' || method === 'get'
                ? null
                : path.startsWith('booking_quotes/') ? quote() : { revision: 2 },
            }), { store }).allow).toBe(false)
          }
        }
      }
    })
  })
})
