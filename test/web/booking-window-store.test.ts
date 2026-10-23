// The demo/local guest create path applies the same season cutoff as the UI,
// the callable and the rules. These cases exercise the adapter directly so a
// future change cannot enforce the window only where a page happens to render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { bookingPolicyDB, DEMO_BOOKING_POLICY_KEY } from '../../src/lib/bookingPolicyDB'

const NOW = new Date('2026-10-01T12:00:00Z')
const datePlus = (days: number) => new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10)

const submission = (checkIn: string, checkOut: string) => ({
  guest_name: 'Ana Reyes',
  phone: '09171234567',
  email: 'ana@example.com',
  guests: 2,
  accommodation: 'main-house',
  special_requests: '',
  uid: 'guest-1',
  check_in: checkIn,
  check_out: checkOut,
  payment_proof_url: 'payments/guest-1/HDL-1/proof-1.png',
  amount_claimed: 5000,
  amount_due: 5000,
})

const cutoffPolicy = {
  minimumLeadTimeDays: 30,
  bookingsOpenUntil: '2026-10-31',
  quotesRequired: false,
  callableBookingRequired: false,
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('the booking window in the guest store', () => {
  it('accepts the last night with its next-day checkout', async () => {
    vi.spyOn(bookingPolicyDB, 'getGuestPolicy').mockResolvedValue(cutoffPolicy)
    const created = await cloudBookingsDB.add(submission(datePlus(30), datePlus(31)))
    expect(created).toMatchObject({ check_in: '2026-10-31', check_out: '2026-11-01', status: 'Pending' })
  })

  it('refuses a check-in after the cutoff before anything is stored', async () => {
    vi.spyOn(bookingPolicyDB, 'getGuestPolicy').mockResolvedValue(cutoffPolicy)
    await expect(cloudBookingsDB.add(submission(datePlus(31), datePlus(32)))).rejects.toMatchObject({
      code: 'BOOKING_WINDOW_CLOSED',
    })
    expect(localStorage.length).toBe(0)
  })

  it('refuses a stay that would check out after the last bookable day', async () => {
    vi.spyOn(bookingPolicyDB, 'getGuestPolicy').mockResolvedValue(cutoffPolicy)
    await expect(cloudBookingsDB.add(submission(datePlus(30), datePlus(34)))).rejects.toMatchObject({
      code: 'BOOKING_WINDOW_CLOSED',
    })
    expect(localStorage.length).toBe(0)
  })
})

describe('the demo-mode policy document', () => {
  it('reads the same document shape from localStorage when Firebase is absent', async () => {
    localStorage.setItem(DEMO_BOOKING_POLICY_KEY, JSON.stringify({
      minimumBookingLeadTimeDays: 3,
      bookingsOpenUntil: '2026-11-20',
    }))
    await expect(bookingPolicyDB.getGuestPolicy()).resolves.toMatchObject({
      minimumLeadTimeDays: 3,
      bookingsOpenUntil: '2026-11-20',
    })
    const seen: string[] = []
    const stop = bookingPolicyDB.subscribePolicy((policy) => seen.push(policy.bookingsOpenUntil))
    stop()
    expect(seen).toEqual(['2026-11-20'])
  })

  it('falls back to the open shared default when the key is absent or malformed', async () => {
    await expect(bookingPolicyDB.getGuestPolicy()).resolves.toMatchObject({
      minimumLeadTimeDays: 30,
      bookingsOpenUntil: '',
    })
    localStorage.setItem(DEMO_BOOKING_POLICY_KEY, '{not json')
    await expect(bookingPolicyDB.getGuestPolicy()).resolves.toMatchObject({
      minimumLeadTimeDays: 30,
      bookingsOpenUntil: '',
    })
  })
})
