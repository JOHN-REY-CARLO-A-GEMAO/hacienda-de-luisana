// ----------------------------------------------------------------------------
// The server-attested price: `firestore.rules` × `booking_quotes`
// ----------------------------------------------------------------------------
// ADR-0019's enforcement, executed as text. The question each case asks is the
// one ADR-0018 said this file could no longer answer: can a Booking arrive with a
// number the published rate card does not produce?
//
// The suite deliberately runs the SAME forged payload twice — once with
// `site_config/booking.quotes_required` off, once on. Off, the forgery passes and
// that is recorded as the interim posture ADR-0018 accepted; on, every one of them
// is refused. A test that only checked the enforced case would not notice the
// flag silently failing to gate, and a test that only checked the inert case
// would not notice enforcement silently being lost.
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, ruleTimestamp, type DocData, type Store } from './engine'
import { allowlistedAdmin, anonymousGuest, bookingDoc, emailGuest, GUEST_UID, OTHER_GUEST_UID, guestPaymentPatch, request } from './context'

const decide = compileRules(readFileSync(join(__dirname, '../../firestore.rules'), 'utf8'))

// Pinned so the 30-day lead time and the quote's expiry window are both live:
// `request.time` is the clock the rules are allowed to trust.
const NOW = '2026-10-01T04:00:00Z'
const CHECK_IN = '2026-10-31'
const CHECK_OUT = '2026-11-01'

/** The weekday rate for ten guests at the Main House, exactly as published. */
const RATE = 5000
const DUE = 2500

const publishedRates = {
  version: 'official-v9', effective_date: '2026-10-01', holiday_dates: ['2026-12-25'],
  accommodations: {
    'main-house': {
      rate_unit: 'standard_stay', active: true, security_deposit: 500, down_payment_percent: 50,
      available_units: 1,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      rate_unit: 'standard_stay', active: true, security_deposit: 0, down_payment_percent: 50,
      available_units: 2,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 3 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 3 },
      },
    },
  },
}

/**
 * What `functions/src/quotes.ts` writes to `booking_quotes/{id}`: the priced
 * payload and the money, flat, because that is the shape the rules compare a
 * Booking against field for field.
 */
const attestation = (overrides: DocData = {}): DocData => ({
  accommodation: 'main-house',
  check_in: CHECK_IN,
  check_out: CHECK_OUT,
  guests: 10,
  pet_count: 0,
  late_checkout_hours: 0,
  rate_unit: 'standard_stay',
  rate_amount: RATE,
  rate_classification: 'weekday',
  nights: 1,
  stay_total: RATE,
  amount_due: DUE,
  balance_due: RATE - DUE,
  security_deposit: 500,
  payment_plan: 'down-payment',
  policy_version: 'official-v9',
  policy_effective_date: '2026-10-01',
  rates_version: 'official-v9',
  refund_policy_snapshot: null,
  // Bound to the writer: `firestore.rules` now requires the spend to come from this
  // exact uid, and `quoteBooking` refuses to mint an unbound attestation at all.
  bound_uid: GUEST_UID,
  created_at: ruleTimestamp(NOW),
  expires_at: ruleTimestamp('2026-10-01T05:00:00.000Z'),
  ...overrides,
})

/** The honest Booking: the same figures, plus the Guest's own claim and proof. */
const booked = (overrides: DocData = {}): DocData => bookingDoc({
  accommodation: 'main-house',
  check_in: CHECK_IN,
  check_out: CHECK_OUT,
  guests: 10,
  nights: 1,
  status: 'Pending',
  payment_status: 'pending',
  payment_plan: 'down-payment',
  payment_proof_url: 'payments/guest-uid-1/HDL/proof-1.png',
  rate_unit: 'standard_stay',
  rate_amount: RATE,
  rate_classification: 'weekday',
  stay_total: RATE,
  amount_due: DUE,
  balance_due: RATE - DUE,
  security_deposit: 500,
  amount_claimed: DUE,
  policy_version: 'official-v9',
  policy_effective_date: '2026-10-01',
  quote_id: 'quote-1',
  ...overrides,
})

const store = (extra: DocData = {}, quote: DocData | null = attestation()): Store => ({
  'site_config/rates': publishedRates,
  // The Admin has asked for attested prices — the one switch this suite is about.
  'site_config/booking': { minimumBookingLeadTimeDays: 30, quotes_required: true, ...extra },
  ...(quote ? { 'booking_quotes/quote-1': quote } : {}),
})

const submit = (data: DocData, quote: DocData | null = attestation(), enforce = true) => decide(request({
  method: 'create',
  path: 'bookings/forgery-attempt',
  auth: anonymousGuest(),
  requestData: data,
  time: NOW,
}), { store: enforce ? store({}, quote) : { 'site_config/rates': publishedRates, ...({}, quote ? { 'booking_quotes/quote-1': quote } : {}) } }).allow

describe('the server-attested price', () => {
  it('accepts a Booking whose money is the figure the price function produced', () => {
    expect(submit(booked())).toBe(true)
  })

  it('refuses a Booking that changed the money after it was quoted', () => {
    // The forgery ADR-0018 named. Every one of these is internally coherent —
    // the split still closes, the total is above the floor — so `bookings` alone
    // cannot see them. What they cannot survive is the comparison with the
    // attestation.
    // The third field is what the *arithmetic* gate alone makes of it: `true`
    // where the forgery is coherent enough to have reached the estate before this
    // change (that is the gap ADR-0018 accepted), `false` where two layers now
    // refuse the same trick. Asserting both columns is what keeps this suite
    // honest — a case that only ever fails proves nothing about the attestation.
    const forged: Array<[string, DocData, boolean]> = [
      ['an under-priced stay', { stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500 }, true],
      ['the deposit zeroed', { security_deposit: 0 }, true],
      ['a rate amount trimmed', { rate_amount: 4500 }, true],
      ['the balance quietly reduced', { balance_due: RATE - DUE - 1000, amount_claimed: DUE }, false],
      ['a refund policy the Guest wrote', { refund_policy_snapshot: { refund_percent: 100, deposit_refund_percent: 100 } }, true],
      ['a weekend price on a weekday', { rate_classification: 'weekend_holiday' }, true],
      ['an extra guest the quote did not price', { guests: 11 }, true],
      ['pets the quote never counted', { pet_count: 3 }, true],
      ['a late checkout nobody agreed', { late_checkout_hours: 4 }, true],
      ['a different unit', { accommodation: 'house-a-camping' }, true],
      ['a date moved by a day', { check_in: '2026-11-01' }, true],
      ['an older policy stamp', { policy_version: 'official-v8' }, true],
      // Two that the arithmetic already refused, and still refused afterwards:
      ['a stay stretched to two nights', { nights: 2, check_out: '2026-11-02' }, false],
      ['a plan the quote did not offer', { payment_plan: 'full', amount_due: RATE, balance_due: 0, amount_claimed: RATE }, false],
    ]
    for (const [name, overrides, reachedTheEstate] of forged) {
      expect(submit(booked(overrides), attestation(), false), `the un-enforced path changed for: ${name}`).toBe(reachedTheEstate)
      expect(submit(booked(overrides), attestation(), true), `forgery accepted: ${name}`).toBe(false)
    }
  })

  it('refuses an enforced create with no attestation, or one that is not there', () => {
    expect(submit(booked({ quote_id: '' }))).toBe(false)
    expect(submit(booked({ quote_id: 'a-quote-nobody-issued' }))).toBe(false)
    expect(submit(booked(), null)).toBe(false)
  })

  it('refuses an attestation that has run out', () => {
    // Quotes are short-lived on purpose: a price is a promise about a document
    // that the Admin may republish.
    expect(submit(booked(), attestation({ expires_at: ruleTimestamp('2026-10-01T03:59:00.000Z') }))).toBe(false)
    // Exactly at the instant, not after it: a quote that has reached its own
    // expiry is not a price the estate is still promising.
    expect(submit(booked(), attestation({ expires_at: ruleTimestamp(NOW) }))).toBe(false)
  })

  it('binds an attestation to the identity it was issued to, and to nobody else', () => {
    // Tightened on 2026-10-22 by the readiness audit. This clause used to accept an
    // *unbound* attestation ("a price, not an entitlement"), because the callable
    // could be reached without a signed-in caller. It can no longer be:
    // `quoteBooking` refuses an unauthenticated call, so an unbound document is
    // either a leftover or something that is not this function — and neither is a
    // reason to let a write through carrying money the estate did not price for
    // *this* Guest.
    expect(submit(booked(), attestation({ bound_uid: GUEST_UID }))).toBe(true)
    expect(submit(booked(), attestation({ bound_uid: '' }))).toBe(false)
    expect(submit(booked(), attestation({ bound_uid: 'someone-elses-uid' }))).toBe(false)
    // A live, correctly-priced attestation naming another uid is refused even when
    // the writer is signed in and every figure matches: the price is right and the
    // entitlement is not.
    expect(submit(booked(), attestation({ bound_uid: OTHER_GUEST_UID }))).toBe(false)
    // And no writer at all: with the estate's switch on, a Booking arrives from an
    // identity Firestore can vouch for, not from whoever holds the web API key.
    expect(decide(request({
      method: 'create', path: 'bookings/forgery-attempt', auth: null,
      requestData: booked(), time: NOW,
    }), { store: store({}, attestation({ bound_uid: '' })) }).allow).toBe(false)
  })

  it('treats an unusable quote_id as a refusal, never as an evaluation error', () => {
    // The landmine this case defuses: `quote_id` can be *present and null* — the
    // Admin app writes nulls for fields it does not collect — and interpolating a
    // non-string into a path is an error rather than a miss. An error is what
    // refused every Guest booking on 2026-10-14; on the Admin's own create path it
    // would have frozen manual bookings the day enforcement was switched on.
    for (const unusable of [null, 123, '', 'x'.repeat(65), { id: 'quote-1' }]) {
      expect(submit(booked({ quote_id: unusable }), attestation()), `a Guest was booked on an unusable quote_id: ${JSON.stringify(unusable)}`).toBe(false)
    }
    // The same value on an Admin create must still be *allowed*: the Admin is exempt
    // from attestation, and an exemption that throws is not an exemption.
    for (const unusable of [null, 123, '']) {
      expect(decide(request({
        method: 'create', path: 'bookings/walk-in-unusable-id', auth: allowlistedAdmin(),
        requestData: booked({ stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500, security_deposit: 0, quote_id: unusable }),
        time: NOW,
      }), { store: { 'site_config/rates': publishedRates, 'site_config/booking': { quotes_required: true } } }).allow).toBe(true)
    }
    // Enforcement off: an unusable id refuses nothing, because nothing was promised
    // about it. (This is the case that would have broken every historical booking
    // had the clause been written to require an id unconditionally.)
    expect(submit(booked({ quote_id: null }), attestation(), false)).toBe(true)
  })

  it('does not refuse a fractional-peso total for the centavo the two halves floor apart', () => {
    // ₱1,125.84 halves to 562.92 in `downPaymentAmount` (a floor) and to 562.91 in
    // the rule's `int(stay_total * 50)` (a truncation). The window the rules carry
    // now admits the estate's own figure; the *forgery* one centavo further out is
    // still refused, so the invariant has not been traded away.
    const fractional = { stay_total: 1125.84, rate_amount: 1125.84, amount_due: 562.92, balance_due: 562.92, amount_claimed: 562.92 }
    expect(submit(booked(fractional), attestation(fractional))).toBe(true)
    expect(submit(booked(fractional), attestation(fractional), false)).toBe(true)
    expect(submit(booked({ ...fractional, amount_due: 562, balance_due: 563.84, amount_claimed: 562 }), attestation(fractional))).toBe(false)
  })

  it('compares money in whole centavos, so a float wobble is not a refusal', () => {
    // The two sides reach the same number by different routes — a Node process and
    // a browser round-tripping through Firestore — and a rule that refused on the
    // last bit would be worse than the gap it closes.
    expect(submit(booked({ stay_total: 5000.0, amount_due: 2500, balance_due: 2500 }), attestation({ stay_total: 5000, amount_due: 2500, balance_due: 2500 }))).toBe(true)
    expect(submit(booked({ amount_due: 2499.995, balance_due: 2500.005, amount_claimed: 2499.995 }), attestation({ amount_due: 2499.99, balance_due: 2500.01 }))).toBe(false)
  })

  it('leaves an Admin’s manual Booking alone', () => {
    // ADR-0010's shape: the Admin writes with their own hands, and the guest gate
    // is not their door. Enforcing attestation on a phone call the estate agreed
    // outside the website would be a policy the Admin cannot act on.
    expect(decide(request({
      method: 'create', path: 'bookings/walk-in', auth: allowlistedAdmin(),
      requestData: booked({ stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500, security_deposit: 0, quote_id: 'expired-and-gone' }),
      time: NOW,
    }), { store: { 'site_config/rates': publishedRates, 'site_config/booking': { quotes_required: true } } }).allow).toBe(true)
  })

  it('lets a Guest resend a proof on an attested Booking, and not re-price it', () => {
    // The resubmission flow moves `payment_status` and the screenshot only, so the
    // attestation is not re-checked there — and it must not need to be: the quote
    // has long since expired by the time an Admin rejects a proof days later, and
    // a rule that demanded a live one would strand the Booking mid-flow.
    const resend = (overrides: DocData) => decide(request({
      method: 'update', path: 'bookings/forgery-attempt', auth: anonymousGuest('guest-uid-1'),
      resourceData: booked({ payment_status: 'rejected' }),
      requestData: booked({ payment_status: 'pending', payment_reject_reason: null, payment_proof_url: 'payments/guest-uid-1/HDL/proof-2.png', amount_claimed: DUE, payment_reference: '3104257798', ...overrides }),
      time: '2026-10-20T04:00:00Z',
    }), { store: store({}, attestation({ expires_at: ruleTimestamp('2026-10-01T03:00:00.000Z') })) }).allow

    expect(resend({})).toBe(true)
    // …while the money that the attestation fixed stays fixed. This is the door
    // the create-side clause would otherwise leave standing open.
    for (const reprice of [
      { stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500 },
      { security_deposit: 0 },
      { rate_amount: 4500 },
      { refund_policy_snapshot: { refund_percent: 100 } },
      { nights: 2 },
    ]) {
      expect(resend(reprice), `re-priced on update: ${Object.keys(reprice).join(',')}`).toBe(false)
    }
  })

  it('changes nothing for a Booking the switch never covered', () => {
    // A record from before the flag has no attestation to be true to, and refusing
    // its plan choice or its proof resubmission would be a policy the Guest cannot
    // act on and the Admin cannot undo. What this case claims is therefore not
    // "these writes are allowed" — the historical-plan branch has its own strict
    // requirements, tested in `firestore-rules.test.ts` — but that the attestation
    // clause is *not one of them*: the identical write must reach the identical
    // verdict with enforcement on and off. If ADR-0019 ever leaks onto a legacy
    // record, the two stop agreeing and this fails.
    const legacyShape = bookingDoc({ status: 'Payment Pending' })
    const verdict = (enforce: boolean, overrides: DocData) => decide(request({
      method: 'update', path: 'bookings/legacy-record', auth: emailGuest(),
      resourceData: legacyShape,
      requestData: { ...legacyShape, ...guestPaymentPatch(), ...overrides },
      time: '2026-10-02T04:00:00Z',
    }), {
      store: {
        'site_config/rates': publishedRates,
        ...(enforce ? { 'site_config/booking': { quotes_required: true } } : {}),
        [`profiles/${GUEST_UID}`]: { uid: GUEST_UID, role: 'guest' },
      },
    }).allow

    for (const [name, overrides] of [
      ['a proof resubmission', {}],
      ['a plan choice', { payment_plan: 'full', stay_total: RATE, amount_due: RATE, balance_due: 0, amount_claimed: RATE }],
      ['a withdrawal', { status: 'Cancelled', cancellation_reason: 'Plans changed' }],
    ] as Array<[string, DocData]>) {
      expect(verdict(true, overrides), `enforcement changed the answer for: ${name}`).toBe(verdict(false, overrides))
    }
  })

  it('is inert when the estate has not switched it on', () => {
    // The default, and the whole reason the rules and the function can be deployed
    // in either order. Recorded here so that "the flag is off" is a tested state,
    // not a hope.
    expect(submit(booked({ stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500, security_deposit: 0 }), null, false)).toBe(true)
    // …and a stray non-boolean in the switch does not turn it on by accident:
    // `validBookingPolicy` refuses that write (see `the enforcement switch` below).
    expect(submit(booked({ stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500, security_deposit: 0 }), null, false)).toBe(true)
  })

  describe('the enforcement switch', () => {
    const publish = (data: DocData) => decide(request({
      method: 'update', path: 'site_config/booking', auth: allowlistedAdmin(),
      resource: { minimumBookingLeadTimeDays: 30 }, requestData: data, time: NOW,
    }), { store: { 'site_config/booking': { minimumBookingLeadTimeDays: 30 } } }).allow

    it('is the Admin’s to set, and only as a boolean', () => {
      expect(publish({ quotes_required: true })).toBe(true)
      expect(publish({ quotes_required: false })).toBe(true)
      // A truthy string, a 1 or an object would read as "enforce" to one layer and
      // not to another, and the two must not be able to disagree about a switch
      // that decides whether money is trusted.
      expect(publish({ quotes_required: 'true' })).toBe(false)
      expect(publish({ quotes_required: 1 })).toBe(false)
      expect(publish({ quotes_required: null })).toBe(false)
      expect(publish({ minimumBookingLeadTimeDays: 30 })).toBe(true)
    })

    it('cannot be flipped by a Guest', () => {
      expect(decide(request({
        method: 'update', path: 'site_config/booking', auth: anonymousGuest(),
        resource: { minimumBookingLeadTimeDays: 30, quotes_required: true },
        requestData: { minimumBookingLeadTimeDays: 30, quotes_required: false }, time: NOW,
      }), { store: { 'site_config/booking': { minimumBookingLeadTimeDays: 30, quotes_required: true } } }).allow).toBe(false)
    })
  })

  describe('the attestation collection itself', () => {
    const attempt = (method: 'create' | 'update' | 'delete', auth = anonymousGuest('guest-uid-1')) => decide(request({
      method, path: 'booking_quotes/quote-1', auth,
      ...(method === 'delete' ? {} : { requestData: attestation({ stay_total: 1 }) }),
      ...(method === 'update' ? { resourceData: attestation() } : {}),
      time: NOW,
    }), { store: store({}, attestation()) }).allow

    it('is closed to every client, in both directions', () => {
      // The fix stands on this: a quote that a Guest could write is a Guest's
      // number wearing a server's clothes. `get()` inside the rules reads it
      // directly, which is why read access is not needed and not given.
      expect(attempt('create')).toBe(false)
      expect(attempt('update')).toBe(false)
      expect(attempt('delete')).toBe(false)
      expect(attempt('create', allowlistedAdmin())).toBe(false)
      expect(decide(request({ method: 'get', path: 'booking_quotes/quote-1', auth: anonymousGuest('guest-uid-1'), time: NOW }),
        { store: store({}, attestation()) }).allow).toBe(false)
    })
  })
})
