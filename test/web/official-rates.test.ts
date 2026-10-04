import { paymentOptionsForTotal, quoteAccommodation, validatePublishedRates, type PublishedRates } from '../../src/lib/booking'
import { OFFICIAL_ACCOMMODATION_RATES } from '../../src/config/officialBusiness'

const official: PublishedRates = {
  version: 'official-v1',
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

describe('official guest-bracket pricing', () => {
  it('validates the backward-compatible official schema', () => {
    expect(validatePublishedRates(official, ['main-house', 'annex', 'house-a-camping'])).toEqual([])
  })

  it.each([
    ['2026-10-05', 6, 5000], ['2026-10-05', 10, 5000],
    ['2026-10-05', 11, 5500], ['2026-10-05', 13, 5500], ['2026-10-05', 14, 6000],
    ['2026-10-10', 6, 6000], ['2026-10-10', 10, 6000],
    ['2026-10-10', 11, 6500], ['2026-10-10', 13, 6500], ['2026-10-10', 14, 7000],
    ['2026-10-06', 6, 6000],
  ])('quotes Main House %s / %i guests as ₱%i', (date, guests, expected) => {
    expect(quote('main-house', String(date), Number(guests))?.stayTotal).toBe(expected)
  })

  it.each([
    ['2026-10-05', 2, 4000], ['2026-10-05', 6, 4000],
    ['2026-10-10', 2, 5000], ['2026-10-10', 6, 5000],
  ])('quotes Annex boundaries', (date, guests, expected) => {
    expect(quote('annex', String(date), Number(guests))?.stayTotal).toBe(expected)
  })

  it.each([2, 3])('quotes one A-House for %i guests', (guests) => {
    expect(quote('house-a-camping', '2026-10-05', guests)?.stayTotal).toBe(1000)
    expect(quote('house-a-camping', '2026-10-10', guests)?.stayTotal).toBe(1000)
  })

  it('refuses invalid counts, missing/inactive properties and unresolved multi-stays', () => {
    expect(quote('annex', '2026-10-05', 1)).toBeUndefined()
    expect(quote('annex', '2026-10-05', 7)).toBeUndefined()
    expect(quote('house-a-camping', '2026-10-05', 4)).toBeUndefined()
    expect(quote('missing', '2026-10-05', 2)).toBeUndefined()
    expect(quoteAccommodation(official, 'annex', { check_in: '2026-10-05', check_out: '2026-10-07', guests: 2 })).toBeUndefined()
    expect(quoteAccommodation({ ...official, accommodations: { annex: { ...official.accommodations.annex, active: false } } }, 'annex', { check_in: '2026-10-05', check_out: '2026-10-06', guests: 2 })).toBeUndefined()
  })

  it('uses an exact reservation fee without inventing a percentage', () => {
    expect(paymentOptionsForTotal(5000, { securityDeposit: 0, reservationFeeAmount: 750 })).toEqual([
      { plan: 'down-payment', stayTotal: 5000, dueNow: 750, securityDeposit: 0, balance: 4250 },
      { plan: 'full', stayTotal: 5000, dueNow: 5000, securityDeposit: 0, balance: 0 },
    ])
  })

  it('does not add pet, bonfire, event or late-checkout charges to the authoritative stay total', () => {
    expect(quote('main-house', '2026-10-05', 6)?.stayTotal).toBe(5000)
  })

  it('leaves historical snapshots unchanged when a new version is quoted', () => {
    const historical = quote('annex', '2026-10-05', 2)!
    const changed: PublishedRates = {
      ...official,
      version: 'official-v2',
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
    expect(historical.snapshot.version).toBe('official-v1')
  })
})
