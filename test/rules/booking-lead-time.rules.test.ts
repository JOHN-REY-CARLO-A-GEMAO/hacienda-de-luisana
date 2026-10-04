// Supplemental, deterministic execution of the actual rules text. The emulator
// companion sends real direct SDK requests to Google's rules runtime.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, type DocData, type Store } from './engine'
import { allowlistedAdmin, anonymousGuest, bookingDoc, promotedAdmin, request, storeWith } from './context'
import { MINIMUM_BOOKING_LEAD_TIME_DAYS } from '../../src/lib/booking'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const decide = compileRules(rules)
const NOW = Date.parse('2026-10-01T04:00:00Z')
const plus = (days: number) => new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10)
const publishedRates = {
  version: 'test-v1', effective_date: '2026-09-01',
  accommodations: {
    'main-house': { property_name: 'Main House', rate_unit: 'night', active: true, nightly_rate: 4250, security_deposit: 500, down_payment_percent: 50 },
  },
}
const rateStore: Store = { 'site_config/rates': publishedRates }
const proofBooking = (data: DocData = {}) => {
  const checkIn = String(data.check_in ?? plus(30))
  const parsed = Date.parse(`${checkIn}T00:00:00Z`)
  const checkOut = Number.isNaN(parsed)
    ? plus(32)
    : new Date(parsed + 2 * 86_400_000).toISOString().slice(0, 10)
  return bookingDoc({
    payment_status: 'pending', payment_plan: 'down-payment',
    payment_proof_url: 'payments/guest-uid-1/HDL/proof-1.png', amount_claimed: 8500,
    check_in: checkIn, check_out: checkOut, ...data,
  })
}
const create = (data: DocData, time = NOW, store: Store = {}) => decide(request({
  method: 'create', path: 'bookings/direct-request', auth: anonymousGuest(), requestData: proofBooking(data), time,
}), { store: { ...rateStore, ...store } }).allow

it('keeps the rules default synchronized with the shared client default', () => {
  const fallback = rules.match(/function minimumBookingLeadTimeDays\(\)\s*\{\s*let defaultDays = (\d+);/)
  expect(Number(fallback?.[1])).toBe(MINIMUM_BOOKING_LEAD_TIME_DAYS)
})

describe('public creates: the trusted server calendar, not payload claims', () => {
  it.each([0, 1, 7, 29])('refuses today + %i days', (days) => {
    expect(create({ check_in: plus(days) })).toBe(false)
  })
  it.each([30, 31, 60])('allows today + %i days', (days) => {
    expect(create({ check_in: plus(days) })).toBe(true)
  })
  it('also enforces the rule for the existing signed-out public creation path', () => {
    for (const [days, allowed] of [[7, false], [30, true]] as const) {
      expect(decide(request({ method: 'create', path: 'bookings/public', auth: null,
        requestData: proofBooking({ check_in: plus(days) }), time: NOW }), { store: rateStore }).allow).toBe(allowed)
    }
  })
  it('ignores forged creation timestamps, lead time fields, actor, source and uid', () => {
    expect(create({ check_in: plus(7), created_at: '2026-01-01T00:00:00Z',
      minimumBookingLeadTimeDays: 0, source: 'admin', actor: 'admin', uid: 'admin-uid-1' })).toBe(false)
  })
  it.each(['2026-11-31', '2027-02-29', '2026-13-01', '2026-10-99', '2026-10-31T00:00:00Z', '2026-1-31', 'garbage', ''])('refuses malformed check-in %s', (check_in) => {
    expect(create({ check_in })).toBe(false)
  })
  it.each([
    ['2026-09-30T15:59:59.999Z', '2026-10-29', '2026-10-30'],
    ['2026-09-30T16:00:00.000Z', '2026-10-30', '2026-10-31'],
    ['2026-10-01T16:00:00.000Z', '2026-10-31', '2026-11-01'],
    ['2026-12-20T04:00:00.000Z', '2027-01-18', '2027-01-19'],
    ['2028-02-01T04:00:00.000Z', '2028-03-01', '2028-03-02'],
  ])('uses Asia/Manila at %s: rejects %s, allows %s', (instant, invalid, valid) => {
    expect(create({ check_in: invalid }, Date.parse(instant))).toBe(false)
    expect(create({ check_in: valid }, Date.parse(instant))).toBe(true)
  })
})

describe('the existing Admin-owned site_config policy', () => {
  it.each([45, 60])('enforces a published %i-day policy on direct requests', (days) => {
    const store = { 'site_config/booking': { minimumBookingLeadTimeDays: days } }
    expect(create({ check_in: plus(30) }, NOW, store)).toBe(false)
    expect(create({ check_in: plus(days - 1) }, NOW, store)).toBe(false)
    expect(create({ check_in: plus(days) }, NOW, store)).toBe(true)
  })
  it('allows public reads, but only Admins can change or delete the policy', () => {
    const policy = { minimumBookingLeadTimeDays: 45 }
    for (const method of ['create', 'update', 'delete'] as const) {
      for (const [auth, allowed] of [[anonymousGuest(), false], [allowlistedAdmin(), true]] as const) {
        expect(decide(request({ method, path: 'site_config/booking', auth,
          requestData: method === 'delete' ? null : policy,
          resourceData: method === 'create' ? null : { minimumBookingLeadTimeDays: 30 } })).allow).toBe(allowed)
      }
    }
    expect(decide(request({ method: 'get', path: 'site_config/booking', auth: null, resourceData: policy })).allow).toBe(true)
  })
  it.each([0, -1, 1.5, '45', null])('refuses an invalid setting %s even from Admin', (days) => {
    expect(decide(request({ method: 'create', path: 'site_config/booking', auth: allowlistedAdmin(),
      requestData: { minimumBookingLeadTimeDays: days } })).allow).toBe(false)
  })
})

describe('Admin/legacy regression boundaries', () => {
  it('preserves manual Admin creates for both bootstrap and stored Admin roles', () => {
    const profiles = storeWith({ 'promoted-admin-1': { role: 'admin' } })
    for (const auth of [allowlistedAdmin(), promotedAdmin()]) {
      expect(decide(request({ method: 'create', path: 'bookings/manual', auth, time: NOW,
        requestData: proofBooking({ check_in: plus(1) }) }), { store: profiles }).allow).toBe(true)
    }
  })
  it('still denies guest date changes on an existing booking', () => {
    const before = proofBooking()
    expect(decide(request({ method: 'update', path: 'bookings/existing', auth: anonymousGuest(), time: NOW,
      resourceData: before, requestData: { ...before, check_in: plus(7) } })).allow).toBe(false)
  })
  it('does not block an existing Guest withdrawal or Admin update inside 30 days', () => {
    const before = proofBooking({ check_in: plus(7) })
    expect(decide(request({ method: 'update', path: 'bookings/existing', auth: anonymousGuest(), time: NOW,
      resourceData: before, requestData: { ...before, status: 'Cancelled' } })).allow).toBe(true)
    expect(decide(request({ method: 'update', path: 'bookings/existing', auth: allowlistedAdmin(), time: NOW,
      resourceData: before, requestData: { ...before, special_requests: 'Admin correction' } })).allow).toBe(true)
  })
  it('keeps proof/payment requirements even for a lead-time-valid request', () => {
    expect(create({ payment_proof_url: '' })).toBe(false)
    expect(create({ amount_claimed: 0 })).toBe(false)
    expect(create({ payment_status: 'verified' })).toBe(false)
  })
})


it('preserves unrelated Admin booking settings/metadata without weakening the lead-time field', () => {
  for (const data of [{ notes: 'existing metadata' }, { minimumBookingLeadTimeDays: 45, notes: 'existing metadata' }]) {
    expect(decide(request({ method: 'create', path: 'site_config/booking', auth: allowlistedAdmin(), requestData: data })).allow).toBe(true)
  }
})
