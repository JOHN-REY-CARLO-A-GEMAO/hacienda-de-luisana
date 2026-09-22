// Ticket #14: the Host publishes rates the Guest's payment choice is quoted
// from. The validator gates every write, and the demo fallback carries the
// document in this browser when there is no Firebase project — this test
// drives that fallback path, not a mocked Firebase.
import { ratesDB } from '../../src/lib/ratesDB'
import { ratesForAccommodation, paymentOptions } from '../../src/lib/booking'

const KNOWN = ['main-house', 'house-a-camping'] as const

const valid = {
  version: 'v2026-10',
  effective_date: '2026-10-01',
  accommodations: {
    'main-house': { nightly_rate: 8500, security_deposit: 2000, down_payment_percent: 50 },
  },
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('ratesDB publish (demo fallback)', () => {
  it('refuses an invalid document and stores nothing', async () => {
    const result = await ratesDB.publish({ version: '', effective_date: 'not-a-date', accommodations: {} }, KNOWN)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.map((p) => p.path)).toContain('version')
    }
    // Refused means stored nowhere: no local fallback copy in any mode.
    expect(window.localStorage.getItem('hdl:rates')).toBeNull()
  })

  it('publishes a valid document the Guest can be quoted from', async () => {
    const result = await ratesDB.publish(valid, KNOWN)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Quoted through the store seam from what was published — no read-back
    // involved, so this holds whether the write landed in the cloud or in
    // the demo fallback.
    const quoted = ratesForAccommodation(result.doc, 'main-house')
    expect(quoted).toBeDefined()
    const options = paymentOptions(
      { check_in: '2026-10-10', check_out: '2026-10-12' },
      quoted!.rateCard,
    )
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
    const seen: (string | null)[] = []
    const unsub = ratesDB.subscribe((doc) => seen.push(doc ? doc.version : null))
    await ratesDB.publish(valid, KNOWN)
    await ratesDB.publish({ ...valid, version: 'v2026-11' }, KNOWN)
    unsub()
    expect(seen).toContain('v2026-10')
    expect(seen).toContain('v2026-11')
  })

  it('reads nothing for an accommodation with no published figures', async () => {
    const result = await ratesDB.publish(valid, KNOWN)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ratesForAccommodation(result.doc, 'house-a-camping')).toBeUndefined()
  })

  it('round-trips through the demo fallback when Firebase is not configured', async () => {
    // In a cloud project the cloud document is the source of truth, so the
    // round-trip is only asserted where the fallback is authoritative.
    if (ratesDB.isCloud) return
    const result = await ratesDB.publish(valid, KNOWN)
    expect(result.ok).toBe(true)
    expect((await ratesDB.get())?.version).toBe('v2026-10')
  })
})
