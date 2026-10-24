/**
 * ADR-0019 from the Guest's side of the wire.
 *
 * The security property itself — a Booking whose figures do not match the estate's
 * attestation is refused — is `firestore.rules`' business, and it is asserted there
 * (`test/rules/quote-attestation.rules.test.ts`). What this file holds is the half
 * the browser can be wrong about: that a submit asks the server for a price, carries
 * only the id of the answer, never sends money it wanted priced, and refuses to
 * write an unattested Booking *when the estate has asked for one* while still
 * booking normally when it has not.
 *
 * `site_config/booking` is mocked as the only source of that switch. Nothing here
 * reads a `VITE_*` variable, which is the point: enforcement must not require a
 * rebuild of the website.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  call: vi.fn(),
  getFunctions: vi.fn(() => ({}) as unknown),
  connectFunctionsEmulator: vi.fn(),
}))

vi.mock('firebase/functions', () => ({
  getFunctions: sdk.getFunctions,
  connectFunctionsEmulator: sdk.connectFunctionsEmulator,
  httpsCallable: (_functions: unknown, name: string) => (payload: unknown) => sdk.call(name, payload),
}))

vi.mock('../../src/lib/firebase', () => ({
  app: {},
  db: {},
  auth: { currentUser: { uid: 'guest-1' } },
  isFirebaseConfigured: true,
  isUsingEmulators: false,
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  addDoc: sdk.addDoc,
  getDocFromServer: sdk.getDocFromServer,
  getDocs: vi.fn(async () => ({ docs: [] })),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  serverTimestamp: () => 'server-timestamp',
  runTransaction: sdk.transaction,
}))

import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { attestationForStay, QuoteRefusedError } from '../../src/lib/quotesApi'

const NOW = '2026-10-01T04:00:00Z'
/** Exactly 30 days from `NOW`, so the lead-time guard lets the submit through. */
const CHECK_IN = '2026-10-31'

const attestedMoney = {
  rate_unit: 'standard_stay' as const,
  rate_amount: 6000,
  rate_classification: 'weekend_holiday' as const,
  nights: 1,
  stay_total: 6000,
  amount_due: 3000,
  balance_due: 3000,
  security_deposit: 500,
  payment_plan: 'down-payment' as const,
  policy_version: 'official-v9',
  policy_effective_date: '2026-10-01',
  refund_policy_snapshot: { tiers: [], deposit_refund_percent: 100 },
}

const submission = {
  guest_name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com', guests: 2,
  accommodation: 'main-house', special_requests: '', uid: 'guest-1',
  check_in: CHECK_IN, check_out: '2026-11-01',
  payment_proof_url: 'payments/guest-1/HDL-1/proof-1.png', amount_claimed: 3000,
  ...attestedMoney,
}

const policy = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data ?? {},
})

const quoteReply = (overrides: Partial<{ quote_id: string; expires_at: string }> = {}) => ({
  data: {
    quote_id: 'quote-abc',
    money: attestedMoney,
    bracket: 'up to 10',
    expires_at: new Date(Date.parse(NOW) + 15 * 60_000).toISOString(),
    reused: false,
    ...overrides,
  },
})

const callableFailure = (code: string, details?: unknown) => Object.assign(new Error(`${code} detail`), { code, details })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  // Default: no policy document at all — the estate's un-enforced state, and the
  // same default `firestore.rules` uses for a missing `site_config/booking`.
  sdk.getDocFromServer.mockResolvedValue(policy(null))
  sdk.addDoc.mockResolvedValue({ id: 'cloud-booking-1' })
  sdk.transaction.mockImplementation(async (_db: unknown, work: (t: unknown) => Promise<unknown>) => work({ set: sdk.set }))
  sdk.call.mockResolvedValue(quoteReply())
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('a submit asks the estate to price the stay', () => {
  it('sends the quoteable inputs and no money', async () => {
    await cloudBookingsDB.add(submission)

    const [name, payload] = sdk.call.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('quoteBooking')
    // Not "money is ignored" — money is not part of the message. A request that
    // could carry a price would eventually carry one that something negotiated with.
    expect(Object.keys(payload).sort()).toEqual(
      ['accommodation', 'check_in', 'check_out', 'guests', 'late_checkout_hours', 'pet_count'].sort(),
    )
    expect(payload).toMatchObject({ accommodation: 'main-house', check_in: CHECK_IN, guests: 2, pet_count: 0, late_checkout_hours: 0 })
  })

  it('carries the attestation id, and leaves the figures the Guest was shown alone', async () => {
    await cloudBookingsDB.add(submission)

    const payload = sdk.addDoc.mock.calls[0][1] as Record<string, unknown>
    expect(payload.quote_id).toBe('quote-abc')
    // The written total is the page's, not the reply's. Replacing a number the Guest
    // approved with one they never saw would be the worse dishonesty; under
    // enforcement, a Booking that disagrees is refused by the rules instead.
    expect(payload.stay_total).toBe(6000)
    expect(payload.payment_status).toBe('pending')
  })

  it('reads the switch from site_config/booking, not from the bundle', async () => {
    await cloudBookingsDB.add(submission)
    expect(sdk.getDocFromServer).toHaveBeenCalledWith({ path: 'site_config/booking' })
  })

  it('re-asks when the quote is about to expire before the write', async () => {
    // A 5-second-old-on-arrival quote cannot survive the upload that precedes the
    // write; the second answer is the one that must be carried.
    sdk.call
      .mockResolvedValueOnce(quoteReply({ quote_id: 'quote-expiring', expires_at: new Date(Date.parse(NOW) + 5_000).toISOString() }))
      .mockResolvedValueOnce(quoteReply({ quote_id: 'quote-fresh' }))
    await cloudBookingsDB.add(submission)

    expect(sdk.call).toHaveBeenCalledTimes(2)
    expect((sdk.addDoc.mock.calls[0][1] as Record<string, unknown>).quote_id).toBe('quote-fresh')
  })
})

describe('enforcement is the Admin’s switch, and the website obeys it', () => {
  beforeEach(() => sdk.getDocFromServer.mockResolvedValue(policy({ quotes_required: true, minimumBookingLeadTimeDays: 30 })))

  it('refuses the submit with the server’s own sentence when the quote is refused', async () => {
    sdk.call.mockRejectedValue(callableFailure('failed-precondition', {
      cause: 'GUEST_COUNT_UNPRICED',
      message: 'That party size is outside what this unit takes. Please adjust the guest count.',
    }))

    await expect(cloudBookingsDB.add(submission)).rejects.toMatchObject({
      message: 'That party size is outside what this unit takes. Please adjust the guest count.',
      cause_code: 'GUEST_COUNT_UNPRICED',
    })
    // Nothing half-written: no Booking, no local fallback the Guest would believe.
    expect(sdk.addDoc).not.toHaveBeenCalled()
    expect(sdk.transaction).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('refuses rather than booking an unattested price when the function is not deployed', async () => {
    sdk.call.mockRejectedValue(callableFailure('not-found'))
    await expect(cloudBookingsDB.add(submission)).rejects.toMatchObject({ cause_code: 'QUOTE_SERVICE_UNAVAILABLE', retryable: true })
    expect(sdk.addDoc).not.toHaveBeenCalled()
  })

  it('still books the way it did before, with no attestation id, when the switch is off', async () => {
    sdk.getDocFromServer.mockResolvedValue(policy(null))
    sdk.call.mockRejectedValue(callableFailure('not-found'))

    const booked = await cloudBookingsDB.add(submission)
    expect(booked).toMatchObject({ storage: 'cloud', status: 'Pending' })
    expect('quote_id' in (sdk.addDoc.mock.calls[0][1] as Record<string, unknown>)).toBe(false)
  })
})

describe('attestationForStay', () => {
  it('throws the named refusal, not a generic one, when enforcement is on', async () => {
    sdk.call.mockRejectedValue(callableFailure('invalid-argument', { cause: 'GUEST_COUNT_UNPRICED', message: 'That party size is outside what this unit takes. Please adjust the guest count.' }))
    await expect(attestationForStay({ accommodation: 'main-house', check_in: CHECK_IN, check_out: '2026-11-03', guests: 2 }, true))
      .rejects.toBeInstanceOf(QuoteRefusedError)
  })

  it('swallows nothing when the estate can act on it: a missing reply is a refusal', async () => {
    sdk.call.mockResolvedValue({ data: { money: attestedMoney } })
    await expect(attestationForStay({ accommodation: 'main-house', check_in: CHECK_IN, check_out: '2026-11-01', guests: 2 }, true))
      .rejects.toMatchObject({ cause_code: 'QUOTE_MALFORMED_REPLY' })
  })
})
