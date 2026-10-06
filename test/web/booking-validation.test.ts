import { describe, expect, it } from 'vitest'
import {
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

  it('names an unsupported stay length rather than assuming a two-night minimum', () => {
    const result = validateBookingSelection(
      { ...selection, check_out: '2026-11-08' },
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
