import { describe, expect, it } from 'vitest'
import { validatePublishedRates, quoteAccommodation } from '../../src/lib/booking/rates'

/** The LIVE `site_config/rates`, read from production on 2026-10-06. */
export const liveRates = {
  version: 'v1-guest-v3',
  effective_date: '2026-10-05',
  holiday_dates: [] as string[],
  refund: {
    tiers: [
      { min_days_before_check_in: 30, refund_percent: 100 },
      { min_days_before_check_in: 14, refund_percent: 50 },
      { min_days_before_check_in: 7, refund_percent: 25 },
    ],
    deposit_refund_percent: 100,
  },
  accommodations: {
    'main-house': {
      property_name: 'The Main House', security_deposit: 2000, active: true,
      rate_unit: 'standard_stay', available_units: 1, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    annex: {
      property_name: 'HDL Annex', security_deposit: 0, active: true,
      rate_unit: 'standard_stay', available_units: 1, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      property_name: 'A-House', security_deposit: 1000, active: true,
      rate_unit: 'standard_stay', available_units: 1, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
      },
    },
  },
}

describe('PROBE: the live published rates document', () => {
  it('validates', () => {
    const problems = validatePublishedRates(liveRates)
    console.log(`validatePublishedRates(live) -> ${problems.length} problem(s)`)
    for (const p of problems) console.log(`  ${p.path}: ${p.message}`)
    expect(true).toBe(true)
  })

  it('quotes the failing booking', () => {
    const quoted = quoteAccommodation(liveRates as never, 'main-house', {
      accommodation: 'main-house', check_in: '2026-11-06', check_out: '2026-11-07', guests: 2,
    } as never)
    console.log(JSON.stringify({
      classification: quoted?.classification,
      rateAmount: quoted?.rateCard?.nightlyRate,
      stayTotal: quoted?.stayTotal,
      version: quoted?.snapshot?.version,
      effectiveDate: quoted?.snapshot?.effectiveDate,
      deposit: quoted?.securityDeposit,
    }, null, 2))
    expect(true).toBe(true)
  })
})