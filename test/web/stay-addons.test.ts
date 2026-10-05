import { describe, expect, it } from 'vitest'
import {
  quoteAccommodation,
  stayAddons,
  validatePublishedRates,
  WEDDING_PREP_ACCOMMODATION_ID,
  type PublishedRates,
} from '../../src/lib/booking'

/** A Main House weekday quote of ₱5,000 for ten guests, plus ₱500 per extra. */
function doc(overrides: Partial<PublishedRates> = {}): PublishedRates {
  return {
    version: 'v1',
    effective_date: '2026-01-01',
    holiday_dates: [],
    accommodations: {
      'main-house': {
        rate_unit: 'standard_stay',
        security_deposit: 500,
        down_payment_percent: 50,
        guest_pricing: {
          units_per_booking: 1,
          weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
          weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
        },
      },
    },
    ...overrides,
  }
}

/** 2026-10-26 is a Monday, so the weekday schedule applies. */
const MONDAY = { check_in: '2026-10-26', check_out: '2026-10-27' }

describe('the pet fee', () => {
  const withPets = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 } })

  it('is nothing when no pet is declared', () => {
    expect(stayAddons(withPets, {})).toMatchObject({ petFee: 0, petCount: 0 })
    expect(stayAddons(withPets, { pet_count: 0 })).toMatchObject({ petFee: 0 })
  })

  it('is the published fee per pet', () => {
    expect(stayAddons(withPets, { pet_count: 1 })?.petFee).toBe(300)
    expect(stayAddons(withPets, { pet_count: 2 })?.petFee).toBe(600)
    expect(stayAddons(withPets, { pet_count: 5 })?.petFee).toBe(1500)
  })

  it('is added to the stay total, so one payment covers it', () => {
    const quote = quoteAccommodation(withPets, 'main-house', { ...MONDAY, guests: 10, pet_count: 2 })
    expect(quote?.addons.rateAmount).toBe(5000)
    expect(quote?.addons.petFee).toBe(600)
    expect(quote?.stayTotal).toBe(5600)
  })

  it('is refused rather than quoted when no fee is published', () => {
    // No pet policy: the Hacienda takes no pets. A Guest cannot bring one and
    // invent the charge.
    expect(stayAddons(doc(), { pet_count: 1 })).toBeUndefined()
    expect(quoteAccommodation(doc(), 'main-house', { ...MONDAY, guests: 10, pet_count: 1 })).toBeUndefined()
  })

  it('is refused past the published cap', () => {
    expect(stayAddons(withPets, { pet_count: 6 })).toBeUndefined()
  })

  it('is refused for a count nobody can send', () => {
    expect(stayAddons(withPets, { pet_count: -1 })).toBeUndefined()
    expect(stayAddons(withPets, { pet_count: 1.5 })).toBeUndefined()
  })
})

describe('late checkout', () => {
  const withHours = doc({ late_checkout_per_hour: 250 })

  it('is nothing without an extension', () => {
    expect(stayAddons(withHours, {})).toMatchObject({ lateCheckoutFee: 0 })
    expect(stayAddons(withHours, { late_checkout_hours: 0 })).toMatchObject({ lateCheckoutFee: 0 })
  })

  it('is the published rate per hour', () => {
    expect(stayAddons(withHours, { late_checkout_hours: 1 })?.lateCheckoutFee).toBe(250)
    expect(stayAddons(withHours, { late_checkout_hours: 2 })?.lateCheckoutFee).toBe(500)
    expect(stayAddons(withHours, { late_checkout_hours: 4 })?.lateCheckoutFee).toBe(1000)
  })

  it('is added to the stay total', () => {
    const quote = quoteAccommodation(withHours, 'main-house', { ...MONDAY, guests: 10, late_checkout_hours: 2 })
    expect(quote?.addons.rateAmount).toBe(5000)
    expect(quote?.addons.lateCheckoutFee).toBe(500)
    expect(quote?.stayTotal).toBe(5500)
  })

  it('is refused when no hourly rate is published', () => {
    expect(stayAddons(doc(), { late_checkout_hours: 2 })).toBeUndefined()
    expect(quoteAccommodation(doc(), 'main-house', { ...MONDAY, guests: 10, late_checkout_hours: 2 })).toBeUndefined()
  })

  it('is refused for a fraction of an hour nobody can charge for', () => {
    expect(stayAddons(withHours, { late_checkout_hours: 1.5 })).toBeUndefined()
    expect(stayAddons(withHours, { late_checkout_hours: -2 })).toBeUndefined()
  })
})

describe('both charges at once', () => {
  const both = doc({ pet_policy: { fee_per_pet: 300 }, late_checkout_per_hour: 250 })

  it('are each priced and summed onto the stay total', () => {
    const quote = quoteAccommodation(both, 'main-house', {
      ...MONDAY, guests: 10, pet_count: 1, late_checkout_hours: 2,
    })
    expect(quote?.addons.rateAmount).toBe(5000)
    expect(quote?.addons.petFee).toBe(300)
    expect(quote?.addons.lateCheckoutFee).toBe(500)
    expect(quote?.stayTotal).toBe(5800)
  })

  it('leave the deposit and the 50% split to the money module', () => {
    // The stay total is what the split is taken from; the deposit is separate and
    // is not one of these charges.
    const quote = quoteAccommodation(both, 'main-house', {
      ...MONDAY, guests: 10, pet_count: 1, late_checkout_hours: 2,
    })
    expect(quote?.rateCard.securityDeposit).toBe(500)
    expect(quote?.rateCard.nightlyRate).toBe(5000)
  })
})

describe('the wedding arrangement as a published Accommodation', () => {
  const wedding = doc({
    accommodations: {
      ...doc().accommodations,
      [WEDDING_PREP_ACCOMMODATION_ID]: {
        property_name: 'Wedding preparation',
        rate_unit: 'standard_stay',
        security_deposit: 500,
        down_payment_percent: 50,
        guest_pricing: {
          units_per_booking: 1,
          weekday: { min_guests: 1, base_max_guests: 10, base_rate: 8500, excess_per_guest: 500 },
          weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 8500, excess_per_guest: 500 },
        },
      },
    },
  })

  it('prices ten guests at the published package rate', () => {
    const quote = quoteAccommodation(wedding, WEDDING_PREP_ACCOMMODATION_ID, { ...MONDAY, guests: 10 })
    expect(quote?.stayTotal).toBe(8500)
  })

  it('prices the eleventh guest and beyond at the excess rate', () => {
    expect(quoteAccommodation(wedding, WEDDING_PREP_ACCOMMODATION_ID, { ...MONDAY, guests: 11 })?.stayTotal).toBe(9000)
    expect(quoteAccommodation(wedding, WEDDING_PREP_ACCOMMODATION_ID, { ...MONDAY, guests: 12 })?.stayTotal).toBe(9500)
  })

  it('needs no special case in the quote, which is the point of publishing it this way', () => {
    // Same shape, same formula, same validator as every other Accommodation — so
    // `firestore.rules` can price it with the arithmetic it already evaluates.
    // The security deposit is 500, as it is for every other unit.
    expect(validatePublishedRates(wedding, ['main-house', WEDDING_PREP_ACCOMMODATION_ID])).toEqual([])
  })
})

describe('validating the new charges', () => {
  const paths = (result: ReturnType<typeof validatePublishedRates>) => result.map((p) => p.path)

  it('accepts a valid pet policy and a valid hourly rate', () => {
    expect(
      validatePublishedRates(doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 }, late_checkout_per_hour: 250 })),
    ).toEqual([])
  })

  it('refuses a pet policy with no fee, since it prices nothing', () => {
    expect(paths(validatePublishedRates(doc({ pet_policy: { fee_per_pet: 0 } })))).toContain(
      'pet_policy.fee_per_pet',
    )
    expect(paths(validatePublishedRates(doc({ pet_policy: {} as never })))).toContain('pet_policy.fee_per_pet')
  })

  it('refuses a pet policy that is not an object', () => {
    expect(paths(validatePublishedRates(doc({ pet_policy: 300 as never })))).toContain('pet_policy')
  })

  it('refuses a cap that is not a whole number of at least one', () => {
    expect(paths(validatePublishedRates(doc({ pet_policy: { fee_per_pet: 300, max_pets: 0 } })))).toContain(
      'pet_policy.max_pets',
    )
    expect(paths(validatePublishedRates(doc({ pet_policy: { fee_per_pet: 300, max_pets: 2.5 } })))).toContain(
      'pet_policy.max_pets',
    )
  })

  it('refuses a negative or non-numeric hourly rate', () => {
    expect(paths(validatePublishedRates(doc({ late_checkout_per_hour: -250 })))).toContain('late_checkout_per_hour')
    expect(paths(validatePublishedRates(doc({ late_checkout_per_hour: '250' as never })))).toContain(
      'late_checkout_per_hour',
    )
  })

  it('treats the charges as absent rather than wrong, so an old document still publishes', () => {
    // A document published before these existed has neither; it is not invalid.
    expect(validatePublishedRates(doc())).toEqual([])
  })
})