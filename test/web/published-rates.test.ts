// ----------------------------------------------------------------------------
// Published rates — the document the Admin publishes so money can move
// ----------------------------------------------------------------------------
// The shape, the validator a publishing surface runs before it writes, and the
// reader ChoosePaymentPlan and settleRefund take their arguments from. The
// validator is pure: a test and a publishing surface run the same check, and
// neither needs Firebase.
// ----------------------------------------------------------------------------

import {
  quotedStayTotal,
  ratesForAccommodation,
  validatePublishedRates,
  type PublishedRates,
} from '../../src/lib/booking'

const published: PublishedRates = {
  version: 'v2026-09',
  effective_date: '2026-09-01',
  accommodations: {
    'main-house': { nightly_rate: 10000, security_deposit: 500, down_payment_percent: 50 },
    'house-a-camping': { nightly_rate: 1200, security_deposit: 0 },
  },
  refund: {
    tiers: [
      { min_days_before_check_in: 14, refund_percent: 100 },
      { min_days_before_check_in: 7, refund_percent: 50 },
    ],
    deposit_refund_percent: 100,
  },
}

const KNOWN = ['main-house', 'house-a-camping'] as const

describe('validatePublishedRates', () => {
  it('accepts a complete document', () => {
    expect(validatePublishedRates(published, KNOWN)).toEqual([])
  })

  it('accepts a document with no cancellation policy — an unpublished policy refunds nothing', () => {
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

  it('flags figures that are not money', () => {
    const problems = validatePublishedRates(
      { ...published, accommodations: { 'main-house': { nightly_rate: 0, security_deposit: -1 } } },
      KNOWN,
    )
    expect(problems.map((p) => p.path)).toEqual([
      'accommodations.main-house.nightly_rate',
      'accommodations.main-house.security_deposit',
    ])
  })

  it('flags a down payment percentage outside (0, 100)', () => {
    for (const bad of [0, 100, -5]) {
      const problems = validatePublishedRates(
        {
          ...published,
          accommodations: {
            'main-house': { ...published.accommodations['main-house'], down_payment_percent: bad },
          },
        },
        KNOWN,
      )
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

describe('ratesForAccommodation', () => {
  it('hands the money module the card, the policy and the snapshot', () => {
    // The document is snake-case; the money module is camelCase — the reader
    // is the one place the two are translated.
    expect(ratesForAccommodation(published, 'main-house')).toEqual({
      rateCard: { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 },
      policy: {
        tiers: [
          { minDaysBeforeCheckIn: 14, refundPercent: 100 },
          { minDaysBeforeCheckIn: 7, refundPercent: 50 },
        ],
        depositRefundPercent: 100,
      },
      snapshot: { version: 'v2026-09', effectiveDate: '2026-09-01' },
    })
  })

  it('is undefined for an Accommodation with no published figures', () => {
    expect(ratesForAccommodation(published, 'villa-that-is-not-listed')).toBeUndefined()
  })
})

describe('ratesForAccommodation — without a policy', () => {
  it('leaves the policy undefined, so a cancellation refunds nothing', () => {
    const { refund, ...noRefund } = published
    expect(ratesForAccommodation(noRefund, 'main-house')?.policy).toBeUndefined()
  })
})

describe('quotedStayTotal', () => {
  it('quotes nights times the nightly rate, rounded to whole centavos', () => {
    expect(quotedStayTotal(published, 'house-a-camping', 3)).toBe(3600)
    // A stay is never zero-length: at least one night is quoted.
    expect(quotedStayTotal(published, 'main-house', 0)).toBe(10000)
  })

  it('is undefined for an Accommodation with no published figures', () => {
    expect(quotedStayTotal(published, 'villa-that-is-not-listed', 3)).toBeUndefined()
  })
})
