// Ticket #14: the Admin publishes rates the Guest's payment choice is quoted
// from. The Admin does that from the Rates screen of the mobile app
// (ADR-0007); the website only READS the document. The demo fallback carries
// the document in this browser when there is no Firebase project — this test
// drives that fallback path, not a mocked Firebase.
import { LOCAL_RATES_EVENT, LOCAL_RATES_KEY, ratesDB } from '../../src/lib/ratesDB'
import { ratesForAccommodation, paymentOptions, validatePublishedRates } from '../../src/lib/booking'

const KNOWN = ['main-house', 'house-a-camping'] as const

const valid = {
  version: 'v2026-10',
  effective_date: '2026-10-01',
  accommodations: {
    'main-house': { nightly_rate: 8500, security_deposit: 2000, down_payment_percent: 50 },
  },
}

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

    // An invalid document is no published policy at all.
    expect(await ratesDB.get()).toBeNull()
  })

  it('quotes the Guest from a valid published document', async () => {
    if (ratesDB.isCloud) return
    expect(validatePublishedRates(valid, KNOWN)).toEqual([])
    seed(valid)

    const doc = await ratesDB.get()
    expect(doc?.version).toBe('v2026-10')
    const quoted = ratesForAccommodation(doc!, 'main-house')
    expect(quoted).toBeDefined()
    const options = paymentOptions({ check_in: '2026-10-10', check_out: '2026-10-12' }, quoted!.rateCard)
    // 2 nights × ₱8,500 = ₱17,000; 50% down floored to centavos.
    expect(options.find((o) => o.plan === 'full')).toMatchObject({
      stayTotal: 17000,
      dueNow: 17000,
      securityDeposit: 2000,
    })
    expect(options.find((o) => o.plan === 'down-payment')).toMatchObject({
      stayTotal: 17000,
      dueNow: 8500,
      securityDeposit: 2000,
      balance: 8500,
    })
  })

  it('notifies subscribers when a new version lands', async () => {
    if (ratesDB.isCloud) return
    const seen: (string | null)[] = []
    const unsub = ratesDB.subscribe((doc) => seen.push(doc ? doc.version : null))
    seed(valid)
    seed({ ...valid, version: 'v2026-11' })
    unsub()
    expect(seen[0]).toBeNull()
    expect(seen).toContain('v2026-10')
    expect(seen).toContain('v2026-11')
  })

  it('reads nothing for an accommodation with no published figures', async () => {
    if (ratesDB.isCloud) return
    seed(valid)
    expect(ratesForAccommodation((await ratesDB.get())!, 'house-a-camping')).toBeUndefined()
  })
})
