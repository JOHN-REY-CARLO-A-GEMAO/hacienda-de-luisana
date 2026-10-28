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
 * Run with `npm run test:functions` (from the repository root: `npm --prefix
 * functions test`). No emulator, no network, no clock that moves on its own.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attestationSurvivesRuleLayer, deriveQuote, moneyMismatches, parseQuoteRequest, quotePayload, ratesVersionDrift, unattestedVerdict, RULE_MIN_STAY_TOTAL } from '../src/pricing'

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
    // A longer range is not a refusal: every night is a standard stay.
    assert.equal(cause({ check_out: '2026-11-03' }), 'ACCEPTED')
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

describe('the stay-length boundary is enforced on the server', () => {
  const derive = (checkIn: string, checkOut: string, accommodation = 'main-house') => {
    const parsed = parseQuoteRequest(request({ check_in: checkIn, check_out: checkOut, accommodation }))
    assert.ok(parsed.ok, `the request itself was refused: ${(parsed as { detail: string }).detail}`)
    return deriveQuote(published, parsed.value, { now: NOW })
  }

  it('accepts a one-night stay', () => {
    assert.ok(derive(CHECK_IN, CHECK_OUT).ok)
  })

  for (const [nights, checkOut] of [[2, '2026-11-02'], [5, '2026-11-05'], [20, '2026-11-20']] as const) {
    it(`prices a ${nights}-night range at one standard stay per night`, () => {
      const outcome = derive(CHECK_IN, checkOut)
      assert.equal(outcome.ok, true, JSON.stringify(outcome))
      const money = (outcome as { quote: { money: { nights: number; stay_total: number } } }).quote.money
      assert.equal(money.nights, nights)
      // CHECK_IN is a Saturday: the weekend schedule prices the check-in night
      // of a one-night stay, and prices every night of a longer stay the same
      // way. Addons are charged once per stay, not per night.
      assert.equal(money.stay_total, nights * 6000)
    })
  }

  it('quotes exactly 20 nights at one standard stay per night', () => {
    // 2026-10-31 + 20 nights: the stay-length cap is not a pricing question —
    // the same arithmetic the one-night quote uses, twenty times over.
    const outcome = derive(CHECK_IN, '2026-11-20')
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
    const money = (outcome as { quote: { money: { nights: number; stay_total: number } } }).quote.money
    assert.equal(money.nights, 20)
    assert.equal(money.stay_total, 20 * 6000)
  })

  it('refuses 21 nights with the stay-length cause and a Guest-readable message', () => {
    const outcome = derive(CHECK_IN, '2026-11-21')
    assert.equal(outcome.ok, false)
    assert.equal((outcome as { cause: string }).cause, 'STAY_TOO_LONG')
    assert.match((outcome as { guestMessage: string }).guestMessage, /at most 20 nights/)
    assert.equal((outcome as { status: string }).status, 'invalid-argument')
  })

  it('refuses a checkout that is not after the check-in', () => {
    for (const checkOut of [CHECK_IN, '2026-10-01']) {
      const outcome = derive(CHECK_IN, checkOut)
      assert.equal(outcome.ok, false, `accepted a checkout of ${checkOut}`)
      assert.equal((outcome as { cause: string }).cause, 'REQUEST_SHAPE')
    }
  })

  it('applies to every published Accommodation, not one of them', () => {
    for (const accommodation of ['main-house', 'house-a-camping']) {
      const outcome = derive(CHECK_IN, '2026-11-21', accommodation)
      assert.equal(outcome.ok, false, `${accommodation} accepted 21 nights`)
      assert.equal((outcome as { cause: string }).cause, 'STAY_TOO_LONG', accommodation)
    }
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

describe('the attestation stays writable by the estate it will be checked against', () => {
  /** The floor is the rule layer's, and it is asserted here rather than duplicated there silently. */
  it('refuses to mint a quote the rule layer would refuse on its floor', () => {
    const cheap = JSON.parse(JSON.stringify(published))
    cheap.accommodations['main-house'].guest_pricing.weekday.base_rate = 900
    cheap.accommodations['main-house'].guest_pricing.weekend_holiday.base_rate = 900
    const parsed = parseQuoteRequest(request({ guests: 1 }))
    assert.ok(parsed.ok)
    const derived = deriveQuote(cheap, parsed.value, { now: NOW })
    // 2026-10-31 is a Saturday, so the weekend schedule prices it; both halves of
    // the schedule are cheap here, and either way the total is under the floor.
    assert.equal(derived.ok, false)
    assert.equal((derived as { cause: string }).cause, 'QUOTE_BELOW_RULE_FLOOR')
    assert.equal(RULE_MIN_STAY_TOTAL, 1000)
  })

  it('checks the derived money against the rule text, centavo by centavo', () => {
    const quote = price()
    assert.deepEqual(attestationSurvivesRuleLayer(quote.money), [])
    assert.deepEqual(attestationSurvivesRuleLayer({ ...quote.money, amount_due: 100, balance_due: quote.money.stay_total - 100 }), ['amount_due 100 is not the floored half of stay_total 6000 within one centavo'])
    assert.ok(attestationSurvivesRuleLayer({ ...quote.money, stay_total: 999 }).join(';').includes('floor'))
    // The rules accept 1–20 nights; the guard still has to catch a record that
    // somehow says otherwise, so the test casts past the type to reach the
    // boundaries the rules do not.
    assert.deepEqual(attestationSurvivesRuleLayer({ ...quote.money, nights: 2 }), [])
    assert.ok(attestationSurvivesRuleLayer({ ...quote.money, nights: 0 } as unknown as Parameters<typeof attestationSurvivesRuleLayer>[0]).join(';').includes('nights 0'))
    assert.ok(attestationSurvivesRuleLayer({ ...quote.money, nights: 21 } as unknown as Parameters<typeof attestationSurvivesRuleLayer>[0]).join(';').includes('at most 20'))
    assert.ok(attestationSurvivesRuleLayer({ ...quote.money, security_deposit: -1 }).length > 0)
  })

  it('agrees with the rules on a fractional total, where the two halves once floored apart', () => {
    // ₱1,125.84 is a real room rate. `downPaymentAmount` floors the half to 562.92;
    // `int(stay_total * 50)` in the rules truncates to 562.91. Before the centavo
    // window those two disagreed by one peso-unit and the estate could not write the
    // Booking it had itself priced — the false refusal this case pins shut.
    const fractional = JSON.parse(JSON.stringify(published))
    fractional.accommodations['main-house'].guest_pricing.weekend_holiday.base_rate = 1125.84
    fractional.accommodations['main-house'].guest_pricing.weekday.base_rate = 1125.84
    const parsed = parseQuoteRequest(request({ guests: 1 }))
    assert.ok(parsed.ok)
    const derived = deriveQuote(fractional, parsed.value, { now: NOW })
    assert.ok(derived.ok, JSON.stringify(derived))
    const money = derived.quote.money
    assert.equal(money.stay_total, 1125.84)
    assert.equal(money.amount_due, 562.92)
    assert.deepEqual(attestationSurvivesRuleLayer(money), [])
  })

  it('names a stale card rather than calling it a wrong figure', () => {
    const quote = price()
    const booking = {
      accommodation: 'main-house', check_in: CHECK_IN, check_out: CHECK_OUT, guests: 10, pet_count: 0, late_checkout_hours: 0,
      ...quote.money, quote_id: '',
    }
    const fresh = (() => {
      const parsed = parseQuoteRequest(request())
      assert.ok(parsed.ok)
      const derived = deriveQuote(published, parsed.value, { now: NOW })
      assert.ok(derived.ok)
      return derived
    })()

    assert.equal(unattestedVerdict(fresh, booking, 'official-v9', false).verdict, 'MATCH')

    const underpaid = unattestedVerdict(fresh, { ...booking, stay_total: 1000, amount_due: 500, balance_due: 500 }, 'official-v9', false)
    assert.equal(underpaid.verdict, 'MISMATCH')
    assert.ok(underpaid.mismatches.includes('stay_total'))

    // Same disagreement, but the card the Booking was priced under is no longer the
    // card published now: that is the estate moving, not the Guest cheating.
    const moved = unattestedVerdict(fresh, { ...booking, stay_total: 1000, amount_due: 500, balance_due: 500, policy_version: 'official-v8' }, 'official-v9', false)
    assert.equal(moved.verdict, 'STALE_CARD')
    assert.match(moved.detail, /has moved since/)

    const namedButGone = unattestedVerdict(fresh, { ...booking, quote_id: 'a'.repeat(32) }, 'official-v9', true)
    assert.equal(namedButGone.verdict, 'MATCH')
    assert.match(namedButGone.detail, /never written, or removed/)

    const unpriceable = unattestedVerdict({ ok: false, cause: 'ACCOMMODATION_UNKNOWN', detail: 'gone', guestMessage: '', status: 'invalid-argument' } as never, booking, 'official-v9', false)
    assert.equal(unpriceable.verdict, 'NO_RATE')
    const malformed = unattestedVerdict({ ok: false, cause: 'REQUEST_SHAPE', detail: 'bad dates', guestMessage: '', status: 'invalid-argument' } as never, booking, 'official-v9', false)
    assert.equal(malformed.verdict, 'UNPARSEABLE')
  })

})
