// Exercises the existing cloud adapter without contacting production. Real
// server-policy decisions are covered by the offline rules and emulator suites.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  addDoc: vi.fn(), getDocFromServer: vi.fn(), transaction: vi.fn(), set: vi.fn(),
}))
vi.mock('../../src/lib/firebase', () => ({
  db: {}, isFirebaseConfigured: true, auth: { currentUser: { uid: 'guest-1' } },
}))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  addDoc: sdk.addDoc, getDocFromServer: sdk.getDocFromServer,
  getDocs: vi.fn(async () => ({ docs: [] })), getDoc: vi.fn(), updateDoc: vi.fn(),
  onSnapshot: vi.fn(), query: vi.fn(), orderBy: vi.fn(), where: vi.fn(),
  serverTimestamp: () => 'server-timestamp',
  runTransaction: sdk.transaction,
}))

import { cloudBookingsDB, lastCloudWriteFailure } from '../../src/lib/firestoreBookings'

const request = {
  guest_name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com', guests: 2,
  accommodation: 'main-house', special_requests: '', uid: 'guest-1',
  check_in: '2026-10-31', check_out: '2026-11-02',
  payment_proof_url: 'payments/guest-1/HDL-1/proof-1.png', amount_claimed: 5000,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T04:00:00Z'))
  sdk.getDocFromServer.mockResolvedValue({ exists: () => false })
  sdk.addDoc.mockResolvedValue({ id: 'cloud-booking-1' })
  sdk.transaction.mockImplementation(async (_db, work) => work({ set: sdk.set }))
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('cloud creation: lead-time guard before addDoc', () => {
  it('checks the authoritative site_config document, not a browser-stored policy', async () => {
    sdk.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => ({ minimumBookingLeadTimeDays: 45 }) })
    localStorage.setItem('minimumBookingLeadTimeDays', '0')
    await expect(cloudBookingsDB.add(request)).rejects.toMatchObject({ code: 'MINIMUM_BOOKING_LEAD_TIME' })
    expect(sdk.getDocFromServer).toHaveBeenCalledWith({ path: 'site_config/booking' })
    expect(sdk.addDoc).not.toHaveBeenCalled()
    expect(sdk.transaction).not.toHaveBeenCalled()
    expect(localStorage.getItem('hdl:bookings')).toBeNull()
  })

  it('rejects a 7-day request without a booking, payment or Activity write', async () => {
    await expect(cloudBookingsDB.add({ ...request, check_in: '2026-10-08' })).rejects.toMatchObject({ code: 'MINIMUM_BOOKING_LEAD_TIME' })
    expect(sdk.addDoc).not.toHaveBeenCalled()
    expect(sdk.transaction).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('writes exactly-30-day requests through the unchanged Pending/proof workflow', async () => {
    expect(await cloudBookingsDB.add(request)).toMatchObject({ status: 'Pending', payment_status: 'pending', storage: 'cloud' })
    expect(sdk.addDoc).toHaveBeenCalledWith({ path: 'bookings' }, expect.objectContaining({
      ...request, status: 'Pending', created_at: 'server-timestamp', payment_status: 'pending',
    }))
    expect(sdk.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'Submit', actor_id: 'guest-1' }))
    expect(localStorage.length).toBe(0)
  })

  it('fails closed when the current policy cannot be fetched, before any write', async () => {
    sdk.getDocFromServer.mockRejectedValue(new Error('technical internal connection detail'))
    await expect(cloudBookingsDB.add(request)).rejects.toThrow('Booking dates could not be checked right now. Please try again.')
    expect(sdk.addDoc).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  // A refusal on a date that clears the lead time is NOT a lead-time failure.
  // `request.check_in` is 2026-10-31 against a system clock of 2026-10-01, so
  // the post-refusal re-check passes and the date is legal: saying otherwise
  // sends the Guest to move a date that was never the problem. This used to
  // assert the opposite.
  it.each(['permission-denied', 'unauthenticated'])('names a server %s refusal as a rules refusal, never as the date', async (code) => {
    sdk.addDoc.mockRejectedValue(Object.assign(new Error('internal rules evaluation detail'), { code }))
    const thrown = await cloudBookingsDB.add(request).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code })
    expect((thrown as Error).message).toMatch(/rules refused it/)
    expect((thrown as Error).message).not.toMatch(/30 days/)
    expect(sdk.transaction).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('keeps the refusal reason for the owner, not just a sentence for the Guest', async () => {
    sdk.addDoc.mockRejectedValue(
      Object.assign(new Error('internal rules evaluation detail'), { code: 'permission-denied' }),
    )
    const thrown = (await cloudBookingsDB.add(request).catch((e: unknown) => e)) as {
      advice: string
      firebaseMessage: string
    }
    expect(thrown.advice).toMatch(/firestore\.rules/)
    expect(thrown.firebaseMessage).toBe('internal rules evaluation detail')
    expect(lastCloudWriteFailure()).toMatchObject({
      code: 'permission-denied',
      message: 'internal rules evaluation detail',
    })
  })

  it('preserves the existing labelled fallback for a non-policy infrastructure failure', async () => {
    sdk.addDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }))
    expect(await cloudBookingsDB.add(request)).toMatchObject({ status: 'Pending', storage: 'local' })
  })
})


describe('server refusal after a client preflight', () => {
  it('reports a policy increase with the new minimum and creates no fallback record', async () => {
    sdk.getDocFromServer
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ minimumBookingLeadTimeDays: 45 }) })
    sdk.addDoc.mockRejectedValue(Object.assign(new Error('technical permission detail'), { code: 'permission-denied' }))
    await expect(cloudBookingsDB.add(request)).rejects.toMatchObject({
      code: 'MINIMUM_BOOKING_LEAD_TIME',
      message: 'This date is not available for advance booking. Please choose a check-in date at least 45 days from today.',
    })
    expect(localStorage.length).toBe(0)
    expect(sdk.transaction).not.toHaveBeenCalled()
  })
  it('reports Manila midnight turning a 30-day request into a 29-day request', async () => {
    sdk.addDoc.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-01T16:00:00Z'))
      throw Object.assign(new Error('technical permission detail'), { code: 'permission-denied' })
    })
    await expect(cloudBookingsDB.add(request)).rejects.toMatchObject({ code: 'MINIMUM_BOOKING_LEAD_TIME' })
    expect(localStorage.length).toBe(0)
    expect(sdk.transaction).not.toHaveBeenCalled()
  })
})
