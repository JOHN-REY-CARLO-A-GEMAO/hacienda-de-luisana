// Structured add-ons & special requests — the pure module behind the booking
// form's steppers, chips, live fee breakdown and the composed Notes text the
// Admin app displays. Business-rule anchors:
//   • ₱300/pet, ₱150/bonfire set, ₱250/late-checkout hour come from the
//     client-approved config (src/config/officialBusiness.ts optional_charges),
//     never from a number typed into this test.
//   • Pets and late checkout are PRICED into the stay total only when the Admin
//     published pet_policy / late_checkout_per_hour (stay-addons.test.ts owns
//     that arithmetic); otherwise they are Admin-approval requests and the
//     quote is untouched (official-rates.test.ts: an ordinary stay carries no
//     pet, event or late-checkout charge).
import { describe, expect, it } from 'vitest'
import {
  MAX_BONFIRE_WOOD_SETS,
  MAX_LATE_CHECKOUT_HOURS,
  MAX_REQUEST_PETS,
  addonFeeLines,
  composeSpecialRequests,
  estimatedAdditionalFees,
  formatPesos,
  maxPetsFor,
  pricedStayExtras,
  quoteAccommodation,
  sanitizeStayRequests,
  validateBookingPayload,
  validateBookingSelection,
  type PublishedRates,
} from '../../src/lib/booking'
import { composeRequestMeta, officialAddonFallbacks } from '../../src/lib/stayRequests'

/** Main House at the official weekday ₱5,000 / weekend ₱6,000 figures. */
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

/** 2026-10-26 is a Monday: weekday schedule, one 22-hour standard stay. */
const MONDAY = { check_in: '2026-10-26', check_out: '2026-10-27' }
const SELECTION = { accommodation: 'main-house', ...MONDAY, guests: 2 }

describe('the documented fallback figures', () => {
  it('are the client-approved config amounts, not invented ones', () => {
    expect(officialAddonFallbacks(null)).toEqual({
      fee_per_pet: 300,
      bonfire_wood_per_set: 150,
      late_checkout_per_hour: 250,
    })
  })

  it('prefer a rates document that publishes its own optional charges', () => {
    const published = doc({
      policies: {
        optional_charges: {
          bonfire_wood: { label: 'Bonfire wood set', amount: 200, unit: 'set', automatic: false, note: '' },
        },
      },
    })
    expect(officialAddonFallbacks(published).bonfire_wood_per_set).toBe(200)
  })
})

describe('the live fee breakdown', () => {
  const fallback = officialAddonFallbacks(null)

  it('is empty for zero selections, and says so in pesos', () => {
    const lines = addonFeeLines(null, sanitizeStayRequests({}), fallback)
    expect(lines).toEqual([])
    expect(formatPesos(estimatedAdditionalFees(lines))).toBe('₱0')
  })

  it('prices the documented example: 2 pets, 1 bonfire set, 2 late hours = ₱1,250', () => {
    // No pet_policy / late_checkout_per_hour published: every line is an
    // Admin-approval request, computed from the documented config figures.
    const lines = addonFeeLines(
      doc(),
      { pet_count: 2, bonfire_wood_sets: 1, late_checkout_hours: 2 },
      fallback,
    )
    expect(lines.map((line) => [line.id, line.amount])).toEqual([
      ['pets', 600],
      ['bonfire_wood', 150],
      ['late_checkout', 500],
    ])
    expect(lines.every((line) => line.requiresApproval)).toBe(true)
    expect(lines.every((line) => !line.includedInTotal)).toBe(true)
    expect(formatPesos(estimatedAdditionalFees(lines))).toBe('₱1,250')
  })

  it('marks priced charges as included and pending ones as approval-bound', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 }, late_checkout_per_hour: 250 })
    const lines = addonFeeLines(published, { pet_count: 1, bonfire_wood_sets: 1, late_checkout_hours: 1 }, officialAddonFallbacks(published))
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]))
    expect(byId.pets).toMatchObject({ includedInTotal: true, requiresApproval: false, amount: 300 })
    expect(byId.late_checkout).toMatchObject({ includedInTotal: true, requiresApproval: false, amount: 250 })
    // Bonfire wood has no automatic pricing path anywhere in the system.
    expect(byId.bonfire_wood).toMatchObject({ includedInTotal: false, requiresApproval: true, amount: 150 })
  })

  it('quotes no figure when nobody published or documented one', () => {
    const lines = addonFeeLines(null, { pet_count: 1 }, {})
    expect(lines[0]).toMatchObject({ unitAmount: null, amount: null, requiresApproval: true })
  })

  it('formats whole pesos without centavos, and centavos when present', () => {
    expect(formatPesos(1250)).toBe('₱1,250')
    expect(formatPesos(300)).toBe('₱300')
    expect(formatPesos(1250.5)).toBe('₱1,250.50')
  })
})

describe('only priced extras reach the quote', () => {
  it('keeps unpriced requests out of the stay total', () => {
    expect(pricedStayExtras(doc(), { pet_count: 2, late_checkout_hours: 2 })).toEqual({})
    const quote = quoteAccommodation(doc(), 'main-house', {
      ...MONDAY, guests: 2, ...pricedStayExtras(doc(), { pet_count: 2, late_checkout_hours: 2 }),
    })
    expect(quote?.stayTotal).toBe(5000)
  })

  it('passes published charges through to the stay total', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300 }, late_checkout_per_hour: 250 })
    const extras = pricedStayExtras(published, { pet_count: 2, late_checkout_hours: 2 })
    expect(extras).toEqual({ pet_count: 2, late_checkout_hours: 2 })
    const quote = quoteAccommodation(published, 'main-house', { ...MONDAY, guests: 2, ...extras })
    expect(quote?.addons.petFee).toBe(600)
    expect(quote?.addons.lateCheckoutFee).toBe(500)
    expect(quote?.stayTotal).toBe(6100)
  })
})

describe('the quantity sanitizer', () => {
  it('floors at zero, drops fractions and clamps to the ceilings', () => {
    expect(sanitizeStayRequests({ pet_count: -3 })).toMatchObject({ pet_count: 0 })
    expect(sanitizeStayRequests({ pet_count: 2.7 })).toMatchObject({ pet_count: 2 })
    expect(sanitizeStayRequests({ pet_count: 99 })).toMatchObject({ pet_count: MAX_REQUEST_PETS })
    expect(sanitizeStayRequests({ bonfire_wood_sets: 99 })).toMatchObject({ bonfire_wood_sets: MAX_BONFIRE_WOOD_SETS })
    expect(sanitizeStayRequests({ late_checkout_hours: -1 })).toMatchObject({ late_checkout_hours: 0 })
    expect(sanitizeStayRequests({ late_checkout_hours: 24 })).toMatchObject({ late_checkout_hours: MAX_LATE_CHECKOUT_HOURS })
    expect(sanitizeStayRequests({ pet_count: 'nope' as unknown as number })).toMatchObject({ pet_count: 0 })
  })

  it('takes the pet ceiling from the published policy when there is one', () => {
    expect(maxPetsFor(doc({ pet_policy: { fee_per_pet: 300, max_pets: 4 } }))).toBe(4)
    expect(maxPetsFor(doc())).toBe(MAX_REQUEST_PETS)
    expect(sanitizeStayRequests({ pet_count: 6 }, doc({ pet_policy: { fee_per_pet: 300, max_pets: 4 } })))
      .toMatchObject({ pet_count: 4 })
  })

  it('whitelists the event purposes and keeps an "Other" detail only with "Other"', () => {
    expect(sanitizeStayRequests({ event_purpose: 'reunion' as const })).toMatchObject({ event_purpose: 'reunion' })
    expect(sanitizeStayRequests({ event_purpose: 'hack' as never }).event_purpose).toBe('')
    expect(sanitizeStayRequests({ event_purpose: 'other' as const, event_purpose_detail: '  baptism  ' }))
      .toMatchObject({ event_purpose_detail: 'baptism' })
    expect(sanitizeStayRequests({ event_purpose: 'reunion' as const, event_purpose_detail: 'ignore me' }).event_purpose_detail)
      .toBeUndefined()
  })
})

describe('the composed special_requests text the Admin app shows', () => {
  it('is byte-identical to the old free text when nothing structured was chosen', () => {
    const legacy = 'Celebrating 10th anniversary. Requesting early arrival if possible.'
    expect(composeSpecialRequests({ notes: legacy })).toBe(legacy)
    expect(composeSpecialRequests({})).toBe('')
  })

  it('names every request with its status and the Guest notes last', () => {
    const text = composeSpecialRequests(
      { pet_count: 2, bonfire_wood_sets: 1, late_checkout_hours: 2, event_purpose: 'reunion', notes: 'Arriving around 3 PM.' },
      composeRequestMeta(doc(), { pet_count: 2, late_checkout_hours: 2 }),
    )
    expect(text).toContain('Pets: 2 at ₱300 per pet (estimated fee, pending Admin approval).')
    expect(text).toContain('Bonfire wood: 1 set at ₱150 per set (pending Admin approval')
    expect(text).toContain('Late checkout: +2 hours after 12:00 noon at ₱250 per hour (requested, subject to availability and Admin approval).')
    expect(text).toContain('Event / purpose: Reunion.')
    expect(text).toContain('Notes: Arriving around 3 PM.')
  })

  it('says "included in the stay total" when the Admin published the charge', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300 }, late_checkout_per_hour: 250 })
    const text = composeSpecialRequests(
      { pet_count: 1, late_checkout_hours: 1 },
      composeRequestMeta(published, { pet_count: 1, late_checkout_hours: 1 }),
    )
    expect(text).toContain('included in the stay total')
    expect(text).not.toContain('pending Admin approval).')
  })
})

describe('the selection validator with structured requests', () => {
  it('accepts unpriced requests without repricing the stay', () => {
    const result = validateBookingSelection(
      { ...SELECTION, pet_count: 2, bonfire_wood_sets: 1, late_checkout_hours: 2, event_purpose: 'photoshoot' },
      { published: doc(), checkLeadTime: false },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.stayTotal).toBe(5000)
  })

  it('prices published charges into the quoted stay total', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 }, late_checkout_per_hour: 250 })
    const result = validateBookingSelection(
      { ...SELECTION, pet_count: 2, late_checkout_hours: 2 },
      { published, checkLeadTime: false },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.stayTotal).toBe(6100)
  })

  it('refuses a pet count above the published cap, naming the cap', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 } })
    const result = validateBookingSelection({ ...SELECTION, pet_count: 6 }, { published, checkLeadTime: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.code).toBe('ADDON_NOT_SUPPORTED')
      expect(result.failure.message).toContain('up to 5 pets')
      expect(result.failure.field).toBe('requests')
    }
  })

  it('refuses quantities nobody can honour', () => {
    const published = doc()
    expect(validateBookingSelection({ ...SELECTION, late_checkout_hours: MAX_LATE_CHECKOUT_HOURS + 1 }, { published, checkLeadTime: false }).ok).toBe(false)
    expect(validateBookingSelection({ ...SELECTION, bonfire_wood_sets: MAX_BONFIRE_WOOD_SETS + 1 }, { published, checkLeadTime: false }).ok).toBe(false)
    expect(validateBookingSelection({ ...SELECTION, pet_count: 1.5 }, { published, checkLeadTime: false }).ok).toBe(false)
    expect(validateBookingSelection({ ...SELECTION, pet_count: -1 }, { published, checkLeadTime: false }).ok).toBe(false)
  })

  it('validates a complete payload whose stay total carries the priced add-ons', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 }, late_checkout_per_hour: 250 })
    const result = validateBookingPayload(
      {
        ...SELECTION, pet_count: 2, late_checkout_hours: 2,
        uid: 'guest-1',
        payment_proof_url: 'payments/proof.png',
        amount_claimed: 3050,
        nights: 1,
        rate_amount: 5000,
        rate_unit: 'standard_stay',
        rate_classification: 'weekday',
        stay_total: 6100,
        amount_due: 3050,
        security_deposit: 500,
        balance_due: 3050,
        payment_plan: 'down-payment',
        payment_status: 'pending',
        policy_version: 'v1',
        policy_effective_date: '2026-01-01',
        refund_policy_snapshot: null,
      },
      { published, checkLeadTime: false },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quote.addons.petFee).toBe(600)
      expect(result.quote.addons.lateCheckoutFee).toBe(500)
    }
  })

  it('refuses a payload whose stay total forgot the priced add-ons', () => {
    const published = doc({ pet_policy: { fee_per_pet: 300, max_pets: 5 } })
    const result = validateBookingPayload(
      {
        ...SELECTION, pet_count: 2,
        uid: 'guest-1',
        payment_proof_url: 'payments/proof.png',
        amount_claimed: 2500,
        nights: 1,
        rate_amount: 5000,
        rate_unit: 'standard_stay',
        rate_classification: 'weekday',
        stay_total: 5000,
        amount_due: 2500,
        security_deposit: 500,
        balance_due: 2500,
        payment_plan: 'down-payment',
        payment_status: 'pending',
        policy_version: 'v1',
        policy_effective_date: '2026-01-01',
        refund_policy_snapshot: null,
      },
      { published, checkLeadTime: false },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('RATE_SNAPSHOT_STALE')
  })
})
