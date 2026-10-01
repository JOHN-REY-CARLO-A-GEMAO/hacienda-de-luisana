import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOKING_TIME_ZONE,
  MINIMUM_BOOKING_LEAD_TIME_DAYS,
  bookingBusinessDate,
  configuredBookingLeadTimeDays,
  minimumCheckInDate,
  minimumBookingLeadTimeMessage,
  validateMinimumBookingLeadTime,
} from '../../src/lib/booking'
import { cloudBookingsDB, activityLogDB } from '../../src/lib/firestoreBookings'

const NOW = new Date('2026-10-01T12:00:00Z')
const datePlus = (days: number) => new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10)

const submission = (days: number) => ({
  guest_name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com', guests: 2,
  accommodation: 'main-house', special_requests: '', uid: 'guest-1',
  check_in: datePlus(days), check_out: datePlus(days + 2),
  payment_proof_url: 'payments/guest-1/HDL-1/proof-1.png',
  amount_claimed: 5000, amount_due: 5000,
})

describe('minimum guest booking lead time (calendar dates)', () => {
  it('defaults to 30 days in Asia/Manila', () => {
    expect(MINIMUM_BOOKING_LEAD_TIME_DAYS).toBe(30)
    expect(BOOKING_TIME_ZONE).toBe('Asia/Manila')
    expect(minimumCheckInDate(NOW)).toBe('2026-10-31')
  })

  it.each([0, 1, 7, 29])('rejects today + %i days', (days) => {
    expect(validateMinimumBookingLeadTime(datePlus(days), NOW)).toEqual({
      ok: false, code: 'MINIMUM_BOOKING_LEAD_TIME', reason: minimumBookingLeadTimeMessage(),
    })
  })

  it.each([30, 31, 60])('accepts today + %i days', (days) => {
    expect(validateMinimumBookingLeadTime(datePlus(days), NOW)).toEqual({ ok: true })
  })

  it.each([
    ['2026-09-30T15:59:59.999Z', '2026-09-30', '2026-10-30'],
    ['2026-09-30T16:00:00.000Z', '2026-10-01', '2026-10-31'],
    ['2026-10-01T15:59:59.999Z', '2026-10-01', '2026-10-31'],
    ['2026-10-01T16:00:00.000Z', '2026-10-02', '2026-11-01'],
    ['2026-09-30T09:00:00-07:00', '2026-10-01', '2026-10-31'],
    ['2026-10-02T05:00:00+14:00', '2026-10-01', '2026-10-31'],
  ])('resolves %s to Manila date %s and earliest %s', (instant, today, earliest) => {
    const now = new Date(instant)
    expect(bookingBusinessDate(now)).toBe(today)
    expect(minimumCheckInDate(now)).toBe(earliest)
    expect(validateMinimumBookingLeadTime(earliest, now).ok).toBe(true)
    const yesterday = new Date(Date.parse(`${earliest}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    expect(validateMinimumBookingLeadTime(yesterday, now).ok).toBe(false)
  })

  it.each([
    ['2026-12-20T04:00:00Z', '2027-01-19'],
    ['2028-02-01T04:00:00Z', '2028-03-02'],
    ['2028-02-29T04:00:00Z', '2028-03-30'],
  ])('handles year/month/leap-day rollover at %s', (instant, earliest) => {
    expect(minimumCheckInDate(new Date(instant))).toBe(earliest)
  })

  it.each(['', 'not-a-date', '2026-02-30', '2026-11-31', '2026-2-01', '2026-10-31T00:00:00Z', null, undefined, 20261031])(
    'refuses a non-canonical calendar date: %s', (date) => {
      expect(validateMinimumBookingLeadTime(date as string, NOW)).toMatchObject({ ok: false, code: 'INVALID_CHECK_IN_DATE' })
    },
  )

  it.each([45, 60])('uses a configured lead time of %i rather than a hard-coded rule', (days) => {
    expect(configuredBookingLeadTimeDays({ minimumBookingLeadTimeDays: days })).toBe(days)
    expect(validateMinimumBookingLeadTime(datePlus(days - 1), NOW, days).ok).toBe(false)
    expect(validateMinimumBookingLeadTime(datePlus(days), NOW, days).ok).toBe(true)
    expect(minimumBookingLeadTimeMessage(days)).toContain(`${days} days`)
  })

  it.each([null, {}, { minimumBookingLeadTimeDays: '45' }, { minimumBookingLeadTimeDays: -1 },
    { minimumBookingLeadTimeDays: 0 }, { minimumBookingLeadTimeDays: 1.5 }])('defaults an absent/malformed setting: %j', (data) => {
    expect(configuredBookingLeadTimeDays(data)).toBe(30)
  })
})

describe('direct guest creation through the existing store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers(); localStorage.clear() })

  it.each([0, 1, 7, 29])('rejects a direct today + %i request before any persistence', async (days) => {
    await expect(cloudBookingsDB.add(submission(days))).rejects.toMatchObject({
      code: 'MINIMUM_BOOKING_LEAD_TIME', message: minimumBookingLeadTimeMessage(),
    })
    // Even the demo seed must not be initialized by an invalid request.
    expect(localStorage.length).toBe(0)
  })

  it('does not trust actor.now or an actor/source claiming to be Admin on the public path', async () => {
    await expect(cloudBookingsDB.add(
      { ...submission(7), source: 'admin' },
      { actor: 'admin', actor_id: 'made-up-admin', now: '2026-01-01T00:00:00Z' },
    )).rejects.toMatchObject({ code: 'MINIMUM_BOOKING_LEAD_TIME' })
    expect(localStorage.length).toBe(0)
  })

  it('accepts exactly 30 days and preserves proof, Pending status, Date hold and Activity log', async () => {
    const created = await cloudBookingsDB.add(submission(30))
    expect(created).toMatchObject({ ...submission(30), status: 'Pending', payment_status: 'pending', storage: 'local' })
    expect(created.hold_expires_at).toBe('2026-10-02T12:00:00.000Z')
    expect((await activityLogDB.list(created.id)).map((entry) => entry.action)).toEqual(['Submit'])
    const availability = await cloudBookingsDB.checkAvailability(submission(30))
    expect(availability.available).toBe(false)
    expect(availability.conflicts.map((booking) => booking.id)).toContain(created.id)
    const approved = await cloudBookingsDB.transition(created.id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: await cloudBookingsDB.list() } },
      { actor: 'admin', actor_id: 'admin-1' },
    )
    expect(approved.ok).toBe(true)
    expect(await cloudBookingsDB.get(created.id)).toMatchObject({ status: 'Approved', payment_status: 'verified', amount_verified: 5000 })
  })

  it('does not loosen the mandatory proof gate for otherwise valid dates', async () => {
    await expect(cloudBookingsDB.add({ ...submission(30), payment_proof_url: '' })).rejects.toThrow(/screenshot/)
    expect(localStorage.length).toBe(0)
  })
})
