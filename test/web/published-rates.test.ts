// ----------------------------------------------------------------------------
// Published rates — the Admin-owned document used for new guest quotes
// ----------------------------------------------------------------------------

import {
  quotedStayTotal,
  ratesForAccommodation,
  validatePublishedRates,
  type PublishedRates,
} from '../../src/lib/booking'

const published: PublishedRates = {
  version: 'guest-count-v2',
  effective_date: '2026-10-04',
  holiday_dates: [],
  accommodations: {
    'main-house': {
      rate_unit: 'standard_stay', security_deposit: 500, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      rate_unit: 'standard_stay', security_deposit: 0, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 },
      },
    },
  },
  refund: {
    tiers: [
      { min_days_before_check_in: 14, refund_percent: 100 },
      { min_days_before_check_in: 7, refund_percent: 50 },
    ],
    deposit_refund_percent: 100,
  },
}

// Old records can still be read by historical/refund helpers; they are not a
// publishable new rate document and are never used by the guest quote path.
const legacyPublished = {
  version: 'legacy-v1',
  effective_date: '2026-09-01',
  holiday_dates: [],
  accommodations: {
    'main-house': { nightly_rate: 10000, security_deposit: 500, down_payment_percent: 50 },
    'house-a-camping': { nightly_rate: 1200, security_deposit: 0 },
  },
  refund: published.refund,
} as unknown as PublishedRates

const KNOWN = ['main-house', 'house-a-camping'] as const

describe('validatePublishedRates', () => {
  it('accepts complete guest-count standard-stay schedules', () => {
    expect(validatePublishedRates(published, KNOWN)).toEqual([])
  })

  it('accepts a document with no cancellation policy', () => {
    const { refund, ...noRefund } = published
    expect(validatePublishedRates(noRefund, KNOWN)).toEqual([])
  })

  it('refuses a document that is not an object', () => {
    expect(validatePublishedRates(null)).toEqual([
      { path: '', message: 'the rates document must be an object.' },
    ])
  })

  it('flags a document that names no version', () => {
    const problems = validatePublishedRates({ ...published, version: '' }, KNOWN)
    expect(problems.map((p) => p.path)).toContain('version')
  })

  it('flags an effective date that is not a real date', () => {
    for (const bad of ['2026-02-30', 'September 1', 20260901]) {
      const problems = validatePublishedRates({ ...published, effective_date: bad }, KNOWN)
      expect(problems.map((p) => p.path)).toContain('effective_date')
    }
  })

  it('requires an explicit, valid Admin-maintained holiday list', () => {
    const { holiday_dates: _holidays, ...missing } = published
    expect(validatePublishedRates(missing, KNOWN).map((p) => p.path)).toContain('holiday_dates')
    expect(validatePublishedRates({ ...published, holiday_dates: ['2026-02-30'] }, KNOWN)
      .map((p) => p.path)).toContain('holiday_dates[0]')
    expect(validatePublishedRates({ ...published, holiday_dates: ['2026-10-06', '2026-10-06'] }, KNOWN)
      .map((p) => p.path)).toContain('holiday_dates')
  })

  it('requires a 1-guest minimum and rejects Main/Annex caps and retired brackets', () => {
    const main = published.accommodations['main-house']
    const problems = validatePublishedRates({
      ...published,
      accommodations: {
        'main-house': {
          ...main,
          guest_pricing: {
            ...main.guest_pricing!,
            weekday: { ...main.guest_pricing!.weekday, min_guests: 6, max_guests: 10, upper_rate: 5500 },
          },
        },
      },
    }, KNOWN)
    expect(problems.map((p) => p.path)).toEqual(expect.arrayContaining([
      'accommodations.main-house.guest_pricing.weekday.min_guests',
      'accommodations.main-house.guest_pricing.weekday.max_guests',
      'accommodations.main-house.guest_pricing.weekday.upper_rate',
    ]))
  })

  it('requires the A-House 3-guest included occupancy and cap', () => {
    const house = published.accommodations['house-a-camping']
    const problems = validatePublishedRates({
      ...published,
      accommodations: {
        'house-a-camping': {
          ...house,
          guest_pricing: {
            ...house.guest_pricing!,
            weekday: { ...house.guest_pricing!.weekday, base_max_guests: 4, max_guests: 4 },
          },
        },
      },
    }, KNOWN)
    expect(problems.map((p) => p.path)).toContain('accommodations.house-a-camping.guest_pricing.weekday')
  })

  it('rejects flat nightly rates, fixed reservation fees, and any down-payment percentage other than 50', () => {
    const main = published.accommodations['main-house']
    expect(validatePublishedRates({
      ...published,
      accommodations: { 'main-house': { ...main, nightly_rate: 8500 } },
    }).map((p) => p.path)).toContain('accommodations.main-house.nightly_rate')
    expect(validatePublishedRates({
      ...published,
      accommodations: { 'main-house': { ...main, reservation_fee_amount: 750 } },
    }).map((p) => p.path)).toContain('accommodations.main-house.reservation_fee_amount')
    for (const bad of [0, 30, 100, -5]) {
      const problems = validatePublishedRates({
        ...published,
        accommodations: { 'main-house': { ...main, down_payment_percent: bad } },
      }, KNOWN)
      expect(problems.map((p) => p.path)).toContain('accommodations.main-house.down_payment_percent')
    }
  })

  it('flags figures published for an Accommodation the site does not list', () => {
    const problems = validatePublishedRates(published, ['main-house'])
    expect(problems).toEqual([
      { path: 'accommodations.house-a-camping', message: 'is not an Accommodation the site lists.' },
    ])
  })

  it('flags a broken cancellation policy', () => {
    const problems = validatePublishedRates(
      { ...published, refund: { tiers: [{ min_days_before_check_in: -1, refund_percent: 150 }] } },
      KNOWN,
    )
    expect(problems.map((p) => p.path)).toEqual([
      'refund.tiers[0].min_days_before_check_in',
      'refund.tiers[0].refund_percent',
    ])
  })
})

describe('ratesForAccommodation — legacy read compatibility', () => {
  it('translates an older flat rate card, policy and version stamp without writing it back', () => {
    expect(ratesForAccommodation(legacyPublished, 'main-house')).toEqual({
      rateCard: { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 },
      policy: {
        tiers: [
          { minDaysBeforeCheckIn: 14, refundPercent: 100 },
          { minDaysBeforeCheckIn: 7, refundPercent: 50 },
        ],
        depositRefundPercent: 100,
      },
      snapshot: { version: 'legacy-v1', effectiveDate: '2026-09-01' },
    })
  })

  it('is undefined for an Accommodation with no legacy rate', () => {
    expect(ratesForAccommodation(legacyPublished, 'villa-that-is-not-listed')).toBeUndefined()
  })

  it('leaves the policy undefined when the old document had none', () => {
    const { refund: _refund, ...noRefund } = legacyPublished
    expect(ratesForAccommodation(noRefund, 'main-house')?.policy).toBeUndefined()
  })
})

describe('quotedStayTotal — legacy snapshots only', () => {
  it('uses each property’s own saved flat rate without rewriting old totals', () => {
    expect(quotedStayTotal(legacyPublished, 'main-house', 2)).toBe(20000)
    expect(quotedStayTotal(legacyPublished, 'house-a-camping', 2)).toBe(2400)
    const historicalBookingTotal = quotedStayTotal(legacyPublished, 'main-house', 2)
    expect(historicalBookingTotal).toBe(20000)
    expect(quotedStayTotal(published, 'main-house', 2)).toBeUndefined()
  })

  it('does not quote an inactive legacy property', () => {
    const inactive: PublishedRates = {
      ...legacyPublished,
      accommodations: {
        ...legacyPublished.accommodations,
        'main-house': { ...legacyPublished.accommodations['main-house'], active: false },
      },
    }
    expect(quotedStayTotal(inactive, 'main-house', 2)).toBeUndefined()
  })

  it('keeps the old reader minimum at one night for legacy data only', () => {
    expect(quotedStayTotal(legacyPublished, 'house-a-camping', 3)).toBe(3600)
    expect(quotedStayTotal(legacyPublished, 'main-house', 0)).toBe(10000)
    expect(quotedStayTotal(legacyPublished, 'villa-that-is-not-listed', 3)).toBeUndefined()
  })
})
