/**
 * Rules-side boundary for Booking lead time.
 *
 * Website creates now go through `submitBooking`, where the trusted Manila date,
 * published lead-time setting, price and inventory are checked together. No
 * browser write is allowed to reach the old rules-side lead-time calculation.
 * These tests retain the policy-document and legacy/Admin regression coverage;
 * callable tests exercise the authoritative create path.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, type DocData } from './engine'
import {
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  promotedAdmin,
  request,
  storeWith,
} from './context'
import { MINIMUM_BOOKING_LEAD_TIME_DAYS } from '../../src/lib/booking'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const decide = compileRules(rules)
const NOW = Date.parse('2026-10-01T04:00:00Z')
const plus = (days: number) => new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10)
const proofBooking = (data: DocData = {}) => bookingDoc({
  payment_status: 'pending', payment_plan: 'down-payment',
  payment_proof_url: 'payments/guest-uid-1/HDL/proof-1.png', amount_claimed: 2500,
  check_in: plus(30), check_out: plus(31), nights: 1,
  rate_amount: 5000, rate_unit: 'standard_stay', rate_classification: 'weekday',
  stay_total: 5000, amount_due: 2500, security_deposit: 500, balance_due: 2500,
  policy_version: 'test-v2', policy_effective_date: '2026-09-01',
  ...data,
})

const directCreate = (auth: ReturnType<typeof anonymousGuest> | null, data: DocData = {}) => decide(request({
  method: 'create', path: 'bookings/direct-request', auth,
  requestData: proofBooking(data), time: NOW,
})).allow

it('keeps the rules default synchronized with the shared policy default', () => {
  const fallback = rules.match(/function minimumBookingLeadTimeDays\(\)\s*\{\s*let defaultDays = (\d+);/)
  expect(Number(fallback?.[1])).toBe(MINIMUM_BOOKING_LEAD_TIME_DAYS)
})

describe('website creates are callable-only', () => {
  it.each([0, 29, 30, 31, 60])('refuses a direct Guest create at +%i days', (days) => {
    expect(directCreate(anonymousGuest(), { check_in: plus(days) })).toBe(false)
  })

  it('refuses the former signed-out public creation path', () => {
    expect(directCreate(null)).toBe(false)
  })

  it.each(['2026-11-31', '2027-02-29', '2026-13-01', '2026-10-31T00:00:00Z', 'garbage', ''])
  ('also refuses malformed direct requests: %s', (check_in) => {
    expect(directCreate(anonymousGuest(), { check_in })).toBe(false)
  })

  it('cannot be bypassed with forged actor, source, uid or timestamps', () => {
    expect(directCreate(anonymousGuest(), {
      check_in: plus(60), created_at: '2026-01-01T00:00:00Z',
      minimumBookingLeadTimeDays: 0, source: 'admin', actor: 'admin', uid: 'admin-uid-1',
    })).toBe(false)
  })
})

describe('the Admin-owned Booking policy', () => {
  it('allows public reads, but only Admins can change or delete it', () => {
    const policy = { minimumBookingLeadTimeDays: 45 }
    for (const method of ['create', 'update', 'delete'] as const) {
      for (const [auth, allowed] of [[anonymousGuest(), false], [allowlistedAdmin(), true]] as const) {
        expect(decide(request({
          method, path: 'site_config/booking', auth,
          requestData: method === 'delete' ? null : policy,
          resourceData: method === 'create' ? null : { minimumBookingLeadTimeDays: 30 },
        })).allow).toBe(allowed)
      }
    }
    expect(decide(request({ method: 'get', path: 'site_config/booking', auth: null, resourceData: policy })).allow).toBe(true)
  })

  it.each([30, 45, 60])('accepts a supported %i-day setting from Admin', (days) => {
    expect(decide(request({
      method: 'create', path: 'site_config/booking', auth: allowlistedAdmin(),
      requestData: { minimumBookingLeadTimeDays: days },
    })).allow).toBe(true)
  })

  it.each([0, -1, 1.5, '45', null])('refuses invalid setting %s even from Admin', (days) => {
    expect(decide(request({
      method: 'create', path: 'site_config/booking', auth: allowlistedAdmin(),
      requestData: { minimumBookingLeadTimeDays: days },
    })).allow).toBe(false)
  })
})

describe('Admin and existing-Booking regression boundaries', () => {
  it('preserves manual Admin creates for bootstrap and stored Admin roles', () => {
    const profiles = storeWith({ 'promoted-admin-1': { role: 'admin' } })
    for (const auth of [allowlistedAdmin(), promotedAdmin()]) {
      expect(decide(request({
        method: 'create', path: 'bookings/manual', auth, time: NOW,
        requestData: proofBooking({ check_in: plus(1), check_out: plus(2) }),
      }), { store: profiles }).allow).toBe(true)
    }
  })

  it('still denies owner date changes on an existing Booking', () => {
    const before = proofBooking()
    expect(decide(request({
      method: 'update', path: 'bookings/existing', auth: anonymousGuest(), time: NOW,
      resourceData: before, requestData: { ...before, check_in: plus(7) },
    })).allow).toBe(false)
  })

  it('does not block an existing owner withdrawal or Admin correction', () => {
    const before = proofBooking({ check_in: plus(7), check_out: plus(8) })
    expect(decide(request({
      method: 'update', path: 'bookings/existing', auth: anonymousGuest(), time: NOW,
      resourceData: before, requestData: { ...before, status: 'Cancelled' },
    })).allow).toBe(true)
    expect(decide(request({
      method: 'update', path: 'bookings/existing', auth: allowlistedAdmin(), time: NOW,
      resourceData: before, requestData: { ...before, special_requests: 'Admin correction' },
    })).allow).toBe(true)
  })
})

it('preserves unrelated Admin Booking settings/metadata', () => {
  for (const data of [{ notes: 'existing metadata' }, { minimumBookingLeadTimeDays: 45, notes: 'existing metadata' }]) {
    expect(decide(request({
      method: 'create', path: 'site_config/booking', auth: allowlistedAdmin(), requestData: data,
    })).allow).toBe(true)
  }
})
