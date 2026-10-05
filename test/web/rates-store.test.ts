// The Admin publishes the rates document; the website validates and reads it.
// This test drives the demo/localStorage path, not a mocked Firebase backend.
import { LOCAL_RATES_EVENT, LOCAL_RATES_KEY, ratesDB } from '../../src/lib/ratesDB'
import { paymentOptionsForTotal, quoteAccommodation, validatePublishedRates } from '../../src/lib/booking'

const KNOWN = ['main-house', 'house-a-camping'] as const

const valid = {
  version: 'guest-count-v2',
  effective_date: '2026-10-01',
  holiday_dates: ['2026-10-06'],
  accommodations: {
    'main-house': {
      rate_unit: 'standard_stay', active: true, security_deposit: 2000, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      rate_unit: 'standard_stay', active: true, security_deposit: 0, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 },
      },
    },
  },
}

const draft = { check_in: '2026-10-05', check_out: '2026-10-06', guests: 11 }

/** What the Admin app's Rates screen leaves behind, seeded the demo way. */
function seed(doc: unknown) {
  window.localStorage.setItem(LOCAL_RATES_KEY, JSON.stringify(doc))
  window.dispatchEvent(new Event(LOCAL_RATES_EVENT))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('ratesDB (read-only on the website)', () => {
  it('offers no way to publish: that is the Admin app’s job', () => {
    expect('publish' in ratesDB).toBe(false)
    expect('clearLocal' in ratesDB).toBe(false)
  })

  it('reads null when nothing has been published', async () => {
    if (ratesDB.isCloud) return
    expect(await ratesDB.get()).toBeNull()
  })

  it('validates a seeded document with the same rules the Admin app applies', async () => {
    if (ratesDB.isCloud) return
    const invalid = { version: '', effective_date: 'not-a-date', accommodations: {} }
    expect(validatePublishedRates(invalid, KNOWN).map((p) => p.path)).toContain('version')

    seed(invalid)
    expect(await ratesDB.get()).toBeNull()
  })

  it('rejects a retired flat nightly document until the Admin publishes the new schedule', async () => {
    if (ratesDB.isCloud) return
    seed({
      version: 'legacy-v1', effective_date: '2026-09-01', holiday_dates: [],
      accommodations: { 'main-house': { nightly_rate: 8500, security_deposit: 2000, down_payment_percent: 50 } },
    })
    expect(await ratesDB.get()).toBeNull()
  })

  it('quotes the Guest from a valid published schedule and computes the 50% payment after the total', async () => {
    if (ratesDB.isCloud) return
    expect(validatePublishedRates(valid, KNOWN)).toEqual([])
    seed(valid)

    const doc = await ratesDB.get()
    expect(doc?.version).toBe('guest-count-v2')
    const quoted = quoteAccommodation(doc!, 'main-house', draft)
    expect(quoted?.stayTotal).toBe(5500)
    const options = paymentOptionsForTotal(quoted!.stayTotal, quoted!.rateCard)
    expect(options).toEqual([
      { plan: 'down-payment', stayTotal: 5500, dueNow: 2750, securityDeposit: 2000, balance: 2750 },
      { plan: 'full', stayTotal: 5500, dueNow: 5500, securityDeposit: 2000, balance: 0 },
    ])
  })

  it('notifies subscribers when a new version lands', async () => {
    if (ratesDB.isCloud) return
    const seen: (string | null)[] = []
    const unsub = ratesDB.subscribe((doc) => seen.push(doc ? doc.version : null))
    seed(valid)
    seed({ ...valid, version: 'guest-count-v3' })
    unsub()
    expect(seen[0]).toBeNull()
    expect(seen).toContain('guest-count-v2')
    expect(seen).toContain('guest-count-v3')
  })

  it('does not quote an accommodation omitted from the published schedule', async () => {
    if (ratesDB.isCloud) return
    seed(valid)
    const doc = (await ratesDB.get())!
    expect(quoteAccommodation(doc, 'annex', draft)).toBeUndefined()
  })
})
