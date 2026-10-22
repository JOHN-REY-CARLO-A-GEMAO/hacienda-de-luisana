import { describe, expect, it } from 'vitest'
import {
  calendarAvailability,
  datesOverlap,
  type HoldBearingBooking,
} from '../../src/lib/booking'

const NOW = '2026-10-22T04:00:00.000Z'
const range = { accommodation: 'main-house', from: '2026-11-20', to: '2026-11-27' }

function booking(
  id: string,
  status: string,
  check_in: string,
  check_out: string,
  accommodation = 'main-house',
  hold_expires_at: string | null = null,
): HoldBearingBooking {
  return { id, status, check_in, check_out, accommodation, hold_expires_at }
}

function states(bookings: HoldBearingBooking[], unitsAvailable = 1) {
  return Object.fromEntries(calendarAvailability(range, bookings, { now: NOW, unitsAvailable })
    .map((day) => [day.date, day.state]))
}

describe('privacy-safe day availability', () => {
  it('marks committed overnight dates booked and keeps checkout reusable', () => {
    const result = states([booking('approved', 'Approved', '2026-11-21', '2026-11-23')])
    expect(result['2026-11-21']).toBe('booked')
    expect(result['2026-11-22']).toBe('booked')
    expect(result['2026-11-23']).toBe('available')
    expect(datesOverlap('2026-11-23', '2026-11-24', '2026-11-21', '2026-11-23')).toBe(false)
  })

  it('marks an active Pending Date hold yellow and releases an expired one', () => {
    const active = states([
      booking('pending', 'Pending', '2026-11-21', '2026-11-22', 'main-house', '2026-10-23T04:00:00.000Z'),
    ])
    expect(active['2026-11-21']).toBe('pending')

    const expired = states([
      booking('pending', 'Pending', '2026-11-21', '2026-11-22', 'main-house', '2026-10-22T03:59:59.000Z'),
    ])
    expect(expired['2026-11-21']).toBe('available')
  })

  it.each(['Rejected', 'Cancelled', 'Expired', 'Completed'])('excludes %s Bookings', (status) => {
    expect(states([booking(status, status, '2026-11-21', '2026-11-22')])['2026-11-21']).toBe('available')
  })

  it('isolates each Accommodation', () => {
    const result = states([
      booking('annex', 'Approved', '2026-11-21', '2026-11-22', 'annex'),
    ])
    expect(result['2026-11-21']).toBe('available')
  })

  it('keeps a two-unit A-House available until its last unit is held', () => {
    const one = [booking('one', 'Approved', '2026-11-21', '2026-11-22', 'main-house')]
    expect(states(one, 2)['2026-11-21']).toBe('available')
    const two = [...one, booking('two', 'Pending', '2026-11-21', '2026-11-22', 'main-house', '2026-10-23T04:00:00Z')]
    expect(states(two, 2)['2026-11-21']).toBe('pending')
    const committed = [...one, booking('two', 'Approved', '2026-11-21', '2026-11-22')]
    expect(states(committed, 2)['2026-11-21']).toBe('booked')
  })

  it('never labels dates available when unit inventory is unknown', () => {
    expect(calendarAvailability(range, [], { now: NOW }).every((day) => day.state === 'unknown')).toBe(true)
  })

  it('rejects impossible or malformed projection boundaries', () => {
    expect(calendarAvailability({ ...range, from: '2026-02-30' }, [], { unitsAvailable: 1 })).toEqual([])
    expect(calendarAvailability({ ...range, from: 'not-a-date' }, [], { unitsAvailable: 1 })).toEqual([])
  })
})
