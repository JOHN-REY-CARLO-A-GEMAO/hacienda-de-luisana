import { paymentOptionsForTotal, quoteAccommodation, validatePublishedRates, type PublishedRates } from '../../src/lib/booking'
import { OFFICIAL_ACCOMMODATION_RATES } from '../../src/config/officialBusiness'

const official: PublishedRates = {
  version: 'official-v2',
  effective_date: '2026-10-04',
  holiday_dates: ['2026-10-06'],
  accommodations: Object.fromEntries(
    Object.entries(OFFICIAL_ACCOMMODATION_RATES).map(([id, rate]) => [id, { ...rate, security_deposit: 500 }]),
  ),
}

function quote(accommodation: string, date: string, guests: number) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return quoteAccommodation(official, accommodation, {
    check_in: date,
    check_out: next.toISOString().slice(0, 10),
    guests,
  })
}

describe('official guest-count standard-stay pricing', () => {
  it('validates the official configurable schedule and explicit holiday list', () => {
    expect(validatePublishedRates(official, ['main-house', 'annex', 'house-a-camping'])).toEqual([])
  })

  it.each([
    ['2026-10-05', 1, 5000], ['2026-10-05', 10, 5000],
    ['2026-10-05', 11, 5500], ['2026-10-05', 13, 6500], ['2026-10-05', 14, 7000],
    ['2026-10-09', 10, 6000], ['2026-10-09', 11, 6500],
    ['2026-10-10', 10, 6000], ['2026-10-10', 13, 7500], ['2026-10-10', 14, 8000],
    ['2026-10-11', 10, 5000], ['2026-10-06', 10, 6000],
  ])('quotes Main House %s / %i guests as ₱%i', (date, guests, expected) => {
    expect(quote('main-house', String(date), Number(guests))?.stayTotal).toBe(expected)
  })

  it.each([
    ['2026-10-05', 1, 4000], ['2026-10-05', 6, 4000], ['2026-10-05', 7, 4500],
    ['2026-10-10', 1, 5000], ['2026-10-10', 6, 5000], ['2026-10-10', 7, 5500],
  ])('quotes Annex per included occupancy and excess guest', (date, guests, expected) => {
    expect(quote('annex', String(date), Number(guests))?.stayTotal).toBe(expected)
  })

  it.each([1, 2, 3])('quotes one A-House for %i guests', (guests) => {
    expect(quote('house-a-camping', '2026-10-05', guests)?.stayTotal).toBe(1000)
    expect(quote('house-a-camping', '2026-10-10', guests)?.stayTotal).toBe(1000)
  })

  it('uses the computed total first, then takes 50% with the balance due at check-in', () => {
    const main = quote('main-house', '2026-10-05', 11)!
    expect(main.stayTotal).toBe(5500)
    expect(paymentOptionsForTotal(main.stayTotal, main.rateCard)).toEqual([
      { plan: 'down-payment', stayTotal: 5500, dueNow: 2750, securityDeposit: 500, balance: 2750 },
      { plan: 'full', stayTotal: 5500, dueNow: 5500, securityDeposit: 500, balance: 0 },
    ])
  })

  it('does not treat base occupancy as a minimum or a cap for Main House or Annex', () => {
    expect(quote('main-house', '2026-10-05', 1)?.stayTotal).toBe(5000)
    expect(quote('main-house', '2026-10-05', 25)?.stayTotal).toBe(12500)
    expect(quote('annex', '2026-10-05', 1)?.stayTotal).toBe(4000)
    expect(quote('annex', '2026-10-05', 25)?.stayTotal).toBe(13500)
  })

  it('refuses invalid counts, A-House counts above its cap, inactive properties and unresolved multi-stays', () => {
    expect(quote('annex', '2026-10-05', 0)).toBeUndefined()
    // The A-House accommodates four: three at the base rate and a fourth for
    // ₱500. A fifth is past its documented limit.
    expect(quote('house-a-camping', '2026-10-05', 5)).toBeUndefined()
    expect(quote('missing', '2026-10-05', 2)).toBeUndefined()
    expect(quoteAccommodation(official, 'annex', { check_in: '2026-10-05', check_out: '2026-10-07', guests: 2 })).toBeUndefined()
    expect(quoteAccommodation({ ...official, accommodations: { annex: { ...official.accommodations.annex, active: false } } }, 'annex', { check_in: '2026-10-05', check_out: '2026-10-06', guests: 2 })).toBeUndefined()
  })

  it('prices the A-House fourth guest as excess, and refuses an excess rule without its cap', () => {
    const aHouse = official.accommodations['house-a-camping']
    expect(quote('house-a-camping', '2026-10-05', 4)?.stayTotal).toBe(1500)

    // A cap without an excess rule charges the base rate for the fourth guest,
    // so the two have to be published together.
    const capWithoutExcess: PublishedRates = {
      ...official,
      accommodations: {
        ...official.accommodations,
        'house-a-camping': {
          ...aHouse,
          guest_pricing: {
            ...aHouse.guest_pricing!,
            weekday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000 },
          },
        },
      },
    }
    expect(validatePublishedRates(capWithoutExcess).map((problem) => problem.path)).toContain(
      'accommodations.house-a-camping.guest_pricing.weekday.excess_per_guest',
    )
  })

  it('rejects fixed reservation fees and anything other than 50% down payment', () => {
    const main = official.accommodations['main-house']
    expect(validatePublishedRates({
      ...official,
      accommodations: {
        'main-house': { ...main, reservation_fee_amount: 750 },
      },
    }).map((problem) => problem.path)).toContain('accommodations.main-house.reservation_fee_amount')
    expect(validatePublishedRates({
      ...official,
      accommodations: {
        'main-house': { ...main, down_payment_percent: 30 },
      },
    }).map((problem) => problem.path)).toContain('accommodations.main-house.down_payment_percent')
  })

  it('does not add pet, wedding-preparation, event or late-checkout charges to an ordinary stay', () => {
    expect(quote('main-house', '2026-10-05', 6)?.stayTotal).toBe(5000)
  })

  it('leaves a captured quote unchanged when a new version is published', () => {
    const historical = quote('annex', '2026-10-05', 2)!
    const changed: PublishedRates = {
      ...official,
      version: 'official-v3',
      accommodations: {
        ...official.accommodations,
        annex: {
          ...official.accommodations.annex,
          guest_pricing: {
            ...official.accommodations.annex.guest_pricing!,
            weekday: { ...official.accommodations.annex.guest_pricing!.weekday, base_rate: 4500 },
          },
        },
      },
    }
    expect(quoteAccommodation(changed, 'annex', { check_in: '2026-10-05', check_out: '2026-10-06', guests: 2 })?.stayTotal).toBe(4500)
    expect(historical.stayTotal).toBe(4000)
    expect(historical.classification).toBe('weekday')
    expect(historical.snapshot.version).toBe('official-v2')
  })
})
