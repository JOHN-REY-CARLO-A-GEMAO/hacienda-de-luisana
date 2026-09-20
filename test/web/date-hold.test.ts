// Ticket #12: a submitted Booking holds its dates for 24 hours, the Guest can
// see the time left, and when the hold runs out the Booking reads as Expired and
// the dates go back into the pool — computed at read time, per ADR-0002.
import { formatHoldCountdown, unitsForAccommodation } from '../../src/lib/booking'
import { ACCOMMODATIONS } from '../../src/config/site'
import { cloudBookingsDB, activityLogDB } from '../../src/lib/firestoreBookings'

const guest = { actor: 'guest', actor_id: 'guest-1', actor_name: 'Maria Santos' } as const
const host = { actor: 'host', actor_id: 'host-1', actor_name: 'Ana Luisana' } as const
const NOW = '2026-09-20T01:00:00.000Z'
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

const request = {
  guest_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: 'maria@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-04',
  guests: 4,
  accommodation: 'main-house',
  special_requests: '',
}

beforeEach(() => {
  localStorage.clear()
  if (!('randomUUID' in crypto)) {
    let n = 0
    ;(crypto as Crypto & { randomUUID: () => string }).randomUUID = () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as ReturnType<typeof crypto.randomUUID>
  }
})

// The Guest's countdown is wording, and wording that says "0h -1m" or counts an
// expired hold as still running is worse than no countdown at all.
describe('formatHoldCountdown', () => {
  it('reads as hours and minutes while a day or more is left', () => {
    expect(formatHoldCountdown(23 * HOUR + 59 * MINUTE)).toBe('23h 59m')
    expect(formatHoldCountdown(24 * HOUR)).toBe('24h 0m')
    expect(formatHoldCountdown(6 * HOUR)).toBe('6h 0m')
  })

  it('counts down to the minute, and only shows seconds inside the last minute', () => {
    expect(formatHoldCountdown(6 * HOUR + 30 * MINUTE)).toBe('6h 30m')
    expect(formatHoldCountdown(45 * MINUTE)).toBe('45m')
    expect(formatHoldCountdown(90 * 1000)).toBe('1m')
    expect(formatHoldCountdown(45 * 1000)).toBe('0m 45s')
  })

  it('says the dates are released once there is nothing left', () => {
    expect(formatHoldCountdown(0)).toBe('Dates released')
    expect(formatHoldCountdown(-HOUR)).toBe('Dates released')
  })

  it('rounds down, never up: a Guest is not told they have time they do not have', () => {
    expect(formatHoldCountdown(HOUR + 59 * MINUTE + 59_999)).toBe('1h 59m')
  })
})

describe('unitsForAccommodation', () => {
  it('is the published unit count for an Accommodation that has one', () => {
    const camping = ACCOMMODATIONS.find((a) => a.availableUnits && a.availableUnits > 1)
    expect(camping).toBeDefined()
    expect(unitsForAccommodation(camping!.id, ACCOMMODATIONS)).toBe(camping!.availableUnits)
  })

  it('is one for an Accommodation that publishes no unit count', () => {
    const single = ACCOMMODATIONS.find((a) => !a.availableUnits)
    expect(single).toBeDefined()
    expect(unitsForAccommodation(single!.id, ACCOMMODATIONS)).toBe(1)
  })

  it('is one for the "Other / Ask Us" choice, which is not a real Accommodation', () => {
    expect(unitsForAccommodation('other', ACCOMMODATIONS)).toBe(1)
    expect(unitsForAccommodation('something-nobody-published', ACCOMMODATIONS)).toBe(1)
  })
})

describe('the hold on a submitted Booking', () => {
  it('runs for 24 hours from submission, and the Guest can see it counting down', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    expect(booking.hold_expires_at).toBe(new Date(Date.parse(NOW) + 24 * HOUR).toISOString())
    expect(cloudBookingsDB.holdRemaining(booking, Date.parse(NOW) + HOUR)).toBe(23 * HOUR)
    expect(formatHoldCountdown(cloudBookingsDB.holdRemaining(booking, Date.parse(NOW) + HOUR))).toBe('23h 0m')
  })

  it('makes the dates unavailable to another Guest the moment they are held', async () => {
    await cloudBookingsDB.add(request, { ...guest, now: NOW })

    const taken = await cloudBookingsDB.checkAvailability(
      { accommodation: 'main-house', check_in: '2026-10-03', check_out: '2026-10-06' },
      { now: NOW },
    )
    expect(taken.available).toBe(false)
    expect(taken.conflicts).toHaveLength(1)

    // A handover on the check-out day is not a clash.
    const free = await cloudBookingsDB.checkAvailability(
      { accommodation: 'main-house', check_in: '2026-10-04', check_out: '2026-10-06' },
      { now: NOW },
    )
    expect(free.available).toBe(true)
    expect(free.conflicts).toEqual([])
  })

  it('frees the dates once the hold has run out, without anybody writing anything', async () => {
    await cloudBookingsDB.add(request, { ...guest, now: NOW })
    const afterExpiry = Date.parse(NOW) + 25 * HOUR

    const freed = await cloudBookingsDB.checkAvailability(
      { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-04' },
      { now: afterExpiry },
    )

    expect(freed.available).toBe(true)
    // ADR-0002: reading availability writes nothing.
    expect(await activityLogDB.list((await cloudBookingsDB.list())[0].id)).toHaveLength(1)
  })

  it('reads as Expired to every surface that reads it, and the Host sees the same thing', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    const afterExpiry = Date.parse(NOW) + 25 * HOUR

    expect(cloudBookingsDB.readStatus(booking, afterExpiry)).toBe('Expired')
    expect(cloudBookingsDB.readStatus(booking, Date.parse(NOW) + HOUR)).toBe('Pending')

    const listed = await cloudBookingsDB.list()
    expect(cloudBookingsDB.readStatus(listed[0], afterExpiry)).toBe('Expired')
  })

  it('writes the expiry to the Activity log once, when a surface records it', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    const afterExpiry = new Date(Date.parse(NOW) + 25 * HOUR).toISOString()

    const expired = await cloudBookingsDB.materialiseExpiry(booking.id, afterExpiry)
    expect(expired.ok).toBe(true)

    const stored = await cloudBookingsDB.get(booking.id)
    expect(stored?.status).toBe('Expired')

    const history = await activityLogDB.list(booking.id)
    expect(history.map((entry) => entry.action)).toEqual(['Submit', 'Expire'])
    expect(history.at(-1)).toMatchObject({
      from_status: 'Pending',
      to_status: 'Expired',
      actor: 'system',
      reason: 'Date hold ran out before the Host reviewed the Booking.',
    })

    // Recording it twice must not log it twice: the expiry happened once.
    const again = await cloudBookingsDB.materialiseExpiry(booking.id, afterExpiry)
    expect(again.ok).toBe(false)
    expect((await activityLogDB.list(booking.id))).toHaveLength(2)
  })

  it('does not expire a Booking the Host has already approved', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    await cloudBookingsDB.transition(booking.id, { type: 'UploadKyc', kyc_id_url: 'gs://ids/1.jpg' }, { ...guest, now: NOW })
    const approved = await cloudBookingsDB.transition(
      booking.id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
      { ...host, now: NOW },
    )
    expect(approved.ok).toBe(true)

    const afterExpiry = new Date(Date.parse(NOW) + 25 * HOUR).toISOString()
    expect((await cloudBookingsDB.materialiseExpiry(booking.id, afterExpiry)).ok).toBe(false)

    const stored = await cloudBookingsDB.get(booking.id)
    expect(stored?.status).toBe('Approved')
    // Approved means the dates are firmly held, so the countdown is over.
    expect(cloudBookingsDB.holdRemaining(stored!, afterExpiry)).toBe(0)
  })
})
