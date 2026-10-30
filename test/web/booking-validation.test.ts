import { describe, expect, it } from 'vitest'
import {
  paymentOptionsForTotal,
  validateBookingPayload,
  validateBookingSelection,
  type PublishedRates,
} from '../../src/lib/booking'

const published: PublishedRates = {
  version: 'v1-guest-v3',
  effective_date: '2026-10-05',
  holiday_dates: [],
  refund: {
    tiers: [
      { min_days_before_check_in: 30, refund_percent: 100 },
      { min_days_before_check_in: 14, refund_percent: 50 },
    ],
    deposit_refund_percent: 100,
  },
  accommodations: {
    'main-house': {
      property_name: 'The Main House',
      available_units: 1,
      rate_unit: 'standard_stay',
      active: true,
      security_deposit: 2000,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
  },
}

const selection = {
  accommodation: 'main-house',
  check_in: '2026-11-06',
  check_out: '2026-11-07',
  guests: 2,
}

const payload = {
  ...selection,
  uid: 'guest-1',
  payment_proof_url: 'payments/guest-1/HDL-1234/proof.png',
  amount_claimed: 3000,
  nights: 1,
  rate_amount: 6000,
  rate_unit: 'standard_stay',
  rate_classification: 'weekend_holiday',
  stay_total: 6000,
  amount_due: 3000,
  security_deposit: 2000,
  balance_due: 3000,
  payment_plan: 'down-payment',
  policy_version: 'v1-guest-v3',
  policy_effective_date: '2026-10-05',
  refund_policy_snapshot: published.refund,
}

describe('guest booking rule preflight', () => {
  it('accepts the reported one-night Main House stay on 2026-11-06', () => {
    const result = validateBookingSelection(selection, {
      published,
      minimumBookingLeadTimeDays: 30,
      now: new Date('2026-10-07T00:00:00.000Z'),
    })

    expect(result).toMatchObject({ ok: true, nights: 1 })
    if (result.ok) {
      expect(result.quote.classification).toBe('weekend_holiday')
      expect(result.quote.stayTotal).toBe(6000)
      expect(result.quote.rateCard.securityDeposit).toBe(2000)
    }
  })

  it('prices guests above the included count without inventing a capacity', () => {
    const result = validateBookingSelection({ ...selection, guests: 25 }, { published, checkLeadTime: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.stayTotal).toBe(6000 + 15 * 500)
    expect(validateBookingSelection({ ...selection, guests: 101 }, { published, checkLeadTime: false })).toMatchObject({ ok: false, failure: { code: 'GUEST_COUNT_NOT_SUPPORTED' } })
  })

  it('does not invent a two-night weekend minimum', () => {
    const result = validateBookingSelection(selection, {
      published,
      minimumBookingLeadTimeDays: 30,
      now: new Date('2026-10-07T00:00:00.000Z'),
    })
    expect(result.ok).toBe(true)
  })

  it('names an advance-booking failure before payment', () => {
    const result = validateBookingSelection(
      { ...selection, check_in: '2026-11-05', check_out: '2026-11-06' },
      { published, minimumBookingLeadTimeDays: 30, now: new Date('2026-10-07T00:00:00.000Z') },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'MINIMUM_BOOKING_LEAD_TIME', field: 'check_in' } })
    if (!result.ok) expect(result.failure.message).toContain('30 days')
  })

  it('quotes a longer stay at one standard stay per night', () => {
    // 2026-11-06 is a Friday: the weekend schedule prices the check-in night,
    // and every night of the stay the same way.
    const result = validateBookingSelection(
      { ...selection, check_out: '2026-11-08' },
      { published, checkLeadTime: false },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.nights).toBe(2)
      expect(result.quote.stayTotal).toBe(2 * 6000)
      expect(result.quote.addons.rateAmount).toBe(6000)
    }
  })

  it('names an unsupported stay length at twenty-one nights', () => {
    const result = validateBookingSelection(
      { ...selection, check_out: '2026-12-07' },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'STAY_LENGTH_NOT_SUPPORTED', field: 'check_out' } })
  })

  it('names an inactive property before payment', () => {
    const result = validateBookingSelection(
      selection,
      {
        published: {
          ...published,
          accommodations: {
            ...published.accommodations,
            'main-house': { ...published.accommodations['main-house'], active: false },
          },
        },
        checkLeadTime: false,
      },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'PROPERTY_NOT_BOOKABLE', field: 'accommodation' } })
  })

  it('names missing rates instead of reporting a generic rule refusal', () => {
    const result = validateBookingSelection(selection, { published: null, checkLeadTime: false })
    expect(result).toMatchObject({ ok: false, failure: { code: 'RATE_NOT_PUBLISHED', field: 'accommodation' } })
    if (!result.ok) expect(result.failure.message).toContain('The Main House')
  })

  it('names a guest-count rule failure', () => {
    const result = validateBookingSelection(
      { ...selection, guests: 0 },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'GUEST_COUNT_NOT_SUPPORTED', field: 'guests' } })
  })

  it('names a stale rate snapshot in the create payload', () => {
    const result = validateBookingPayload(
      { ...payload, security_deposit: 500 },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'RATE_SNAPSHOT_STALE' } })
    if (!result.ok) expect(result.failure.message).toContain('security deposit')
  })

  it('names a missing Guest identity before a rules write', () => {
    const result = validateBookingPayload(
      { ...payload, uid: null },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'GUEST_IDENTITY_REQUIRED' } })
  })

  it('names missing payment proof before upload', () => {
    const result = validateBookingPayload(
      { ...payload, payment_proof_url: '' },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'PAYMENT_PROOF_REQUIRED', field: 'payment' } })
  })

  it('names an underpaid screenshot claim against the exact due amount', () => {
    const result = validateBookingPayload(
      { ...payload, amount_claimed: 2999 },
      { published, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'PAYMENT_AMOUNT_TOO_LOW', field: 'payment' } })
    if (!result.ok) expect(result.failure.message).toContain('₱3,000.00')
  })
})

// ---------------------------------------------------------------------------
// Fractional published rates
//
// A fractional rate (₱2,499.99 is a real published figure) halves to a total the
// evaluator cannot represent exactly, and the preflight used to compute the
// split with its own float multiply while the page computed it in whole
// centavos. The two landed a centavo apart, so a correct Booking was refused as
// a stale quote and the Guest could never submit it — issue #137.
// ---------------------------------------------------------------------------

const fractionalPublished: PublishedRates = {
  ...published,
  accommodations: {
    'main-house': {
      property_name: 'The Main House',
      available_units: 1,
      rate_unit: 'standard_stay',
      active: true,
      security_deposit: 2000,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 2499.99, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 2499.99, excess_per_guest: 500 },
      },
    },
  },
}

/** The payload exactly as `DownpaymentPage.submit` builds it. */
function downPaymentPayload(checkIn: string, checkOut: string) {
  const chosen = validateBookingSelection(
    { accommodation: 'main-house', check_in: checkIn, check_out: checkOut, guests: 2 },
    { published: fractionalPublished, checkLeadTime: false },
  )
  if (!chosen.ok) throw new Error(chosen.failure.message)
  const option = paymentOptionsForTotal(chosen.quote.stayTotal, chosen.quote.rateCard)
    .find((candidate) => candidate.plan === 'down-payment')
  if (!option) throw new Error('the fixture publishes no down payment')
  return {
    accommodation: 'main-house',
    check_in: checkIn,
    check_out: checkOut,
    guests: 2,
    uid: 'guest-1',
    payment_proof_url: 'payments/guest-1/HDL-1234/proof.png',
    amount_claimed: option.dueNow,
    nights: chosen.nights,
    rate_amount: chosen.quote.rateCard.nightlyRate,
    rate_unit: 'standard_stay',
    rate_classification: chosen.quote.classification,
    stay_total: chosen.quote.stayTotal,
    amount_due: option.dueNow,
    security_deposit: chosen.quote.rateCard.securityDeposit,
    balance_due: option.balance,
    payment_plan: 'down-payment',
    policy_version: chosen.quote.snapshot.version,
    policy_effective_date: chosen.quote.snapshot.effectiveDate,
    refund_policy_snapshot: fractionalPublished.refund,
  }
}

describe('a fractional rate cannot look like a stale quote', () => {
  it('accepts one night at ₱2,499.99, whose half leaves a float tail', () => {
    const payload = downPaymentPayload('2026-11-04', '2026-11-05')
    // ₱2,499.99 halves to ₱1,249.99 with a ₱1,250.00 balance; the subtraction
    // 2499.99 - 1249.99 is 1249.9999999999998 in binary floating point.
    expect(payload.stay_total).toBe(2499.99)
    expect(payload.amount_due).toBe(1249.99)
    expect(payload.balance_due).toBe(1250)

    const result = validateBookingPayload(payload, { published: fractionalPublished, checkLeadTime: false })
    expect(result, result.ok ? '' : result.failure.message).toMatchObject({ ok: true })
  })

  it.each([
    ['2026-11-04', '2026-11-05', 2499.99],
    ['2026-11-04', '2026-11-06', 4999.98],
    ['2026-11-04', '2026-11-07', 7499.97],
  ])('accepts %s → %s (₱%s), where the page and the rules used to disagree', (checkIn, checkOut) => {
    const payload = downPaymentPayload(checkIn, checkOut)
    const result = validateBookingPayload(payload, { published: fractionalPublished, checkLeadTime: false })
    expect(result, result.ok ? '' : result.failure.message).toMatchObject({ ok: true })
  })

  it('sweeps fractional totals instead of trusting one fixture', () => {
    // The round-peso fixtures are exactly what hid this: every whole-peso total
    // halves and subtracts exactly. These are the totals whose halves do not.
    const failures: string[] = []
    for (const rate of [1024.1, 1875.75, 1999.99, 2499.99, 2999.99, 3150.25]) {
      for (const nights of [1, 2, 3, 5, 6, 7, 12]) {
        const total = Math.round(rate * nights * 100) / 100
        const option = paymentOptionsForTotal(total, { securityDeposit: 2000, downPaymentPercent: 50 })
          .find((candidate) => candidate.plan === 'down-payment')
        if (!option) continue
        // The split closes, and both figures are whole centavos.
        expect(option.dueNow + option.balance).toBeCloseTo(total, 10)
        expect(Number.isInteger(Math.round(option.dueNow * 100))).toBe(true)
        if (!(option.dueNow > 0)) failures.push(`₱${rate} × ${nights}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('still refuses a down payment one centavo short', () => {
    // The tolerance is for the rounding artefact, not for underpaying.
    const payload = downPaymentPayload('2026-11-04', '2026-11-05')
    const result = validateBookingPayload(
      { ...payload, amount_due: 1249.98, balance_due: 1250.01, amount_claimed: 1249.98 },
      { published: fractionalPublished, checkLeadTime: false },
    )
    expect(result).toMatchObject({ ok: false, failure: { code: 'RATE_SNAPSHOT_STALE' } })
    if (!result.ok) expect(result.failure.message).toContain('downpayment due now')
  })

  it('does not call a Booking with no stored balance stale', () => {
    // `explainGuestCreateRefusal` runs this over a stored Booking; one written
    // before `balance_due` existed has no figure to compare, and blaming the
    // rates for that masked the refusal it was asked to explain.
    const { balance_due: _omitted, ...withoutBalance } = downPaymentPayload('2026-11-04', '2026-11-05')
    const result = validateBookingPayload(withoutBalance, { published: fractionalPublished, checkLeadTime: false })
    expect(result, result.ok ? '' : result.failure.message).toMatchObject({ ok: true })
  })
})
