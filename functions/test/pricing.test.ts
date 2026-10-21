/**
 * The server-side price, on the published document.
 *
 * Every case here asks the same question in a different way: can a number reach a
 * Booking that the estate's own rate card does not produce? The answers come from
 * `deriveQuote`, which is the code `quoteBooking` runs — the same function the
 * website's `quoteAccommodation` computes the display price with, mirrored into
 * this bundle by `scripts/sync-booking-pricing.mjs` and hash-checked by
 * `test/booking-sync.test.ts`. One arithmetic, two places it is read.
 *
 * Run with `npm run test:disputes` (from the repository root: `npm --prefix
 * functions test`). No emulator, no network, no clock that moves on its own.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveQuote, moneyMismatches, parseQuoteRequest, quotePayload, ratesVersionDrift } from '../src/pricing'

/** The clock everything is measured against: 2026-10-01, 04:00 UTC. */
const NOW = Date.parse('2026-10-01T04:00:00Z')
/** Exactly 30 days out, and a Saturday: the weekday/weekend split is load-bearing here. */
const CHECK_IN = '2026-10-31'
const CHECK_OUT = '2026-11-01'

const published = {
  version: 'official-v9',
  effective_date: '2026-10-01',
  holiday_dates: ['2026-12-25'],
  pet_policy: { fee_per_pet: 500, max_pets: 2 },
  late_checkout_per_hour: 300,
  refund: { tiers: [{ min_days_before_check_in: 30, refund_percent: 100 }, { min_days_before_check_in: 14, refund_percent: 50 }], deposit_refund_percent: 100 },
  accommodations: {
    'main-house': {
      property_name: 'The Main House',
      rate_unit: 'standard_stay',
      active: true,
      available_units: 1,
      security_deposit: 500,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      rate_unit: 'standard_stay',
      active: true,
      available_units: 2,
      security_deposit: 0,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 3 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 3 },
      },
    },
    'annex-kubo': {
      rate_unit: 'standard_stay',
      active: false,
      security_deposit: 0,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 4, base_rate: 2000, excess_per_guest: 250 },
        weekend_holiday: { min_guests: 1, base_max_guests: 4, base_rate: 2500, excess_per_guest: 250 },
      },
    },
  },
} as const

const request = (overrides: Record<string, unknown> = {}) => ({
  accommodation: 'main-house',
  check_in: CHECK_IN,
  check_out: CHECK_OUT,
  guests: 10,
  ...overrides,
})

const price = (overrides: Record<string, unknown> = {}, rates: unknown = published) => {
  const parsed = parseQuoteRequest(request(overrides))
  assert.ok(parsed.ok, `the request itself was refused: ${(parsed as { detail: string }).detail}`)
  const derived = deriveQuote(rates, parsed.value, { now: NOW })
  assert.ok(derived.ok, `the quote was refused: ${(derived as { detail: string }).detail}`)
  return derived.quote
}

describe('the price comes from the published card', () => {
  it('prices the included occupancy at the base rate, and the split is half', () => {
    const quote = price()
    assert.deepEqual(quote.money, {
      rate_unit: 'standard_stay',
      rate_amount: 6000, // 2026-10-31 is a Saturday: the weekend schedule prices it
      rate_classification: 'weekend_holiday',
      nights: 1,
      stay_total: 6000,
      amount_due: 3000,
      balance_due: 3000,
      security_deposit: 500,
      payment_plan: 'down-payment',
      policy_version: 'official-v9',
      policy_effective_date: '2026-10-01',
      refund_policy_snapshot: published.refund,
    })
    assert.equal(quote.rates_version, 'official-v9')
  })

  it('charges each guest above the included count at the published excess', () => {
    assert.equal(price({ guests: 13 }).money.stay_total, 6000 + 3 * 500)
  })

  it('classifies a listed holiday over the day of the week', () => {
    // A Tuesday in the weekday range, published as a holiday: the weekend price.
    const quote = price({ check_in: '2026-12-25', check_out: '2026-12-26' })
    assert.equal(quote.money.rate_classification, 'weekend_holiday')
    assert.equal(quote.money.rate_amount, 6000)
  })

  it('adds a published pet fee and a published late-checkout hour, inside the total', () => {
    // The addons join the stay total rather than being billed apart, so the 50/50
    // split stays one payment — and the half is taken from the larger figure.
    const quote = price({ pet_count: 2, late_checkout_hours: 3 })
    assert.equal(quote.money.stay_total, 6000 + 2 * 500 + 3 * 300)
    assert.equal(quote.money.amount_due + quote.money.balance_due, quote.money.stay_total)
  })

  it('holds the flat per-unit cap of the A-House, and its zero deposit', () => {
    assert.equal(price({ accommodation: 'house-a-camping', guests: 3 }).money.stay_total, 1000)
    assert.equal(price({ accommodation: 'house-a-camping', guests: 3 }).money.security_deposit, 0)
    const fourth = (() => {
      const parsed = parseQuoteRequest(request({ accommodation: 'house-a-camping', guests: 4 }))
      assert.ok(parsed.ok)
      return deriveQuote(published, parsed.value, { now: NOW })
    })()
    assert.equal(fourth.ok, false)
    assert.equal((fourth as { cause: string }).cause, 'GUEST_COUNT_UNPRICED')
  })

  it('refuses what the card does not price, naming why', () => {
    const cause = (overrides: Record<string, unknown>, rates: unknown = published) => {
      const parsed = parseQuoteRequest(request(overrides))
      assert.ok(parsed.ok)
      const derived = deriveQuote(rates, parsed.value, { now: NOW })
      return derived.ok ? 'ACCEPTED' : (derived as { cause: string }).cause
    }
    assert.equal(cause({ pets: 1, pet_count: 3 }, { ...published, pet_policy: undefined }), 'EXTRAS_UNPRICED')
    assert.equal(cause({ pet_count: 3 }, { ...published, pet_policy: { fee_per_pet: 500, max_pets: 2 } }), 'EXTRAS_UNPRICED')
    assert.equal(cause({ late_checkout_hours: 2 }, { ...published, late_checkout_per_hour: undefined }), 'EXTRAS_UNPRICED')
    assert.equal(cause({ accommodation: 'annex-kubo' }), 'ACCOMMODATION_INACTIVE')
    assert.equal(cause({ accommodation: 'the-treehouse' }), 'ACCOMMODATION_UNKNOWN')
    assert.equal(cause({ check_in: '2026-10-15', check_out: '2026-10-16' }), 'LEAD_TIME')
    assert.equal(cause({ check_out: '2026-11-03' }), 'NOT_A_STANDARD_STAY')
    assert.equal(cause({}, null), 'PUBLISHED_RATES_MISSING')
    // A retired flat `nightly_rate` in the live document is exactly the drift the
    // publication checks refuse at write time — and it must not be quietly priced
    // from whatever else is in the document.
    const drifted = JSON.parse(JSON.stringify(published))
    delete drifted.accommodations['main-house'].guest_pricing
    drifted.accommodations['main-house'].nightly_rate = 500
    assert.equal(cause({}, drifted), 'PUBLISHED_RATES_MALFORMED')
    const noHolidays = JSON.parse(JSON.stringify(published))
    delete noHolidays.holiday_dates
    assert.equal(cause({}, noHolidays), 'PUBLISHED_RATES_MALFORMED')
    // The 50% is not a per-unit preference the publication can quietly change: the
    // validator refuses a document that sets another figure (ADR-0004 §3), so the
    // refusal is a *publication* problem rather than the quote path's
    // `NO_DOWN_PAYMENT_PUBLISHED`, which stays as the fallback for a document that
    // validates and still yields no down-payment plan.
    for (const percent of [30, 100, 0]) {
      const card = { ...published, accommodations: { ...published.accommodations, 'main-house': { ...published.accommodations['main-house'], down_payment_percent: percent } } }
      assert.equal(cause({}, card), 'PUBLISHED_RATES_MALFORMED', `a ${percent}% deposit was treated as publishable`)
    }
    // `NO_DOWN_PAYMENT_PUBLISHED` is therefore unreachable while the publication
    // check and the pricing module agree — it is the fallback that surfaces if they
    // ever diverge, and `quotes.ts` still refuses rather than defaulting the plan.
  })
})

describe('a Guest’s own numbers cannot steer the price', () => {
  it('ignores money in the request entirely', () => {
    // The request type has no money in it, and a caller who adds some is not
    // merely rejected — the figure is not read. A "we validate it and refuse"
    // answer would leave a code path that looks at a Guest's price at all.
    const withForgedMoney = parseQuoteRequest(request({ stay_total: 1, amount_due: 0, security_deposit: 0, guests: 10, rate_amount: 1 }))
    assert.ok(withForgedMoney.ok)
    const derived = deriveQuote(published, withForgedMoney.value, { now: NOW })
    assert.ok(derived.ok)
    assert.equal(derived.quote.money.stay_total, 6000)
    assert.equal(derived.quote.money.security_deposit, 500)
  })

  it('refuses a malformed request rather than defaulting it', () => {
    for (const bad of [
      { accommodation: 'Main House', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 2 },
      { accommodation: 'main-house', check_in: '2026-10-31', check_out: '31-10-2026', guests: 2 },
      { accommodation: 'main-house', check_in: '2026-02-30', check_out: '2026-03-01', guests: 2 },
      { accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 0 },
      { accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 2.5 },
      { accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 2, pet_count: -1 },
      { accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 2, late_checkout_hours: 'three' },
      'main-house',
      null,
    ]) {
      assert.equal(parseQuoteRequest(bad).ok, false, `accepted: ${JSON.stringify(bad)}`)
    }
  })
})

describe('the comparison the rules make, computed the same way', () => {
  const honest = () => {
    const quote = price()
    return {
      accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 10, pet_count: 0, late_checkout_hours: 0,
      ...quote.money,
    }
  }

  it('names every field a forged Booking moved', () => {
    const quote = price()
    const expected = { request: quote.request, money: quote.money }
    for (const [name, tampered] of [
      ['the total halved', { stay_total: 3000, amount_due: 1500, balance_due: 1500 }],
      ['the deposit zeroed', { security_deposit: 0 }],
      ['the party enlarged', { guests: 11 }],
      ['pets added quietly', { pet_count: 2 }],
      ['the classification moved', { rate_classification: 'weekday' }],
      ['a friendlier refund policy', { refund_policy_snapshot: { refund_percent: 100 } }],
      ['the plan switched', { payment_plan: 'full' }],
      ['a stamp from the last card', { policy_version: 'official-v8' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const mismatches = moneyMismatches({ ...honest(), ...tampered }, expected)
      assert.ok(mismatches.length > 0, `the forgery passed unnoticed: ${name}`)
      assert.deepEqual(mismatches, [...new Set(mismatches)], `noise in the report for: ${name}`)
    }
    assert.deepEqual(moneyMismatches(honest(), expected), [])
  })

  it('compares pesos to the centavo and not beyond it', () => {
    const quote = price()
    const expected = { request: quote.request, money: quote.money }
    // A double that arrives as 3000.0000000001 is the same money.
    assert.deepEqual(moneyMismatches({ ...honest(), amount_due: 3000.0000000001 }, expected), [])
    // One centavo is not.
    assert.deepEqual(moneyMismatches({ ...honest(), amount_due: 2999.99 }, expected), ['amount_due'])
  })

  it('treats an absent figure as a mismatch, not as zero', () => {
    const quote = price()
    const expected = { request: quote.request, money: quote.money }
    const missing = { ...honest() } as Record<string, unknown>
    delete missing.stay_total
    assert.ok(moneyMismatches(missing, expected).includes('stay_total'))
  })

  it('reports a stale stamp against the version now published', () => {
    assert.equal(ratesVersionDrift({ policy_version: 'official-v8' }, 'official-v9'), true)
    assert.equal(ratesVersionDrift({ policy_version: 'official-v9' }, 'official-v9'), false)
    assert.equal(ratesVersionDrift({}, 'official-v9'), false, 'a record with no stamp is not evidence of drift')
  })

  it('hashes one request and rate version to one quote id', () => {
    const a = quotePayload(price().request, 'official-v9')
    assert.equal(a, quotePayload(price().request, 'official-v9'))
    assert.notEqual(a, quotePayload(price().request, 'official-v10'))
    assert.notEqual(a, quotePayload({ ...price().request, guests: 11 }, 'official-v9'))
  })
})
