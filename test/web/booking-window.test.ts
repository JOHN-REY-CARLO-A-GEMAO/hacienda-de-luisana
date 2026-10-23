import { describe, expect, it } from 'vitest'
import {
  configuredBookingsOpenUntil,
  isBeyondBookingWindow,
  lastBookableCheckOut,
  validateBookableCheckIn,
  validateBookingSelection,
  type PublishedRates,
} from '../../src/lib/booking'

const NOW = new Date('2026-10-01T12:00:00Z')
const CUTOFF = '2026-11-20'

const published: PublishedRates = {
  version: 'v1-guest-v3',
  effective_date: '2026-10-05',
  holiday_dates: [],
  refund: {
    tiers: [
      { min_days_before_check_in: 30, refund_percent: 100 },
      { min_days_before_check_in: 14, refund_percent: 50 },
    ],
    deposit_refund_percent: 100,
  },
  accommodations: {
    'main-house': {
      property_name: 'The Main House',
      available_units: 1,
      rate_unit: 'standard_stay',
      active: true,
      security_deposit: 2000,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
  },
}

const selection = (check_in: string, check_out: string) => ({
  accommodation: 'main-house',
  check_in,
  check_out,
  guests: 2,
})

describe('the Admin booking window (last bookable check-in)', () => {
  it('reads only a real calendar date, and an absent or malformed setting means open', () => {
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: CUTOFF })).toBe(CUTOFF)
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: '' })).toBe('')
    expect(configuredBookingsOpenUntil({})).toBe('')
    expect(configuredBookingsOpenUntil(null)).toBe('')
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: '2026-02-30' })).toBe('')
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: '2026-1-1' })).toBe('')
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: '2026-11-20T00:00:00Z' })).toBe('')
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: 20261120 })).toBe('')
    expect(configuredBookingsOpenUntil({ bookingsOpenUntil: null })).toBe('')
  })

  it('lets the last night check out the next day, never later', () => {
    expect(lastBookableCheckOut(CUTOFF)).toBe('2026-11-21')
    expect(lastBookableCheckOut('')).toBe('')
  })

  it('opens the cutoff date itself and closes the day after', () => {
    expect(validateBookableCheckIn(CUTOFF, NOW, 30, CUTOFF)).toEqual({ ok: true })
    expect(validateBookableCheckIn('2026-11-19', NOW, 30, CUTOFF)).toEqual({ ok: true })
    expect(validateBookableCheckIn('2026-11-21', NOW, 30, CUTOFF)).toEqual({
      ok: false,
      code: 'BOOKING_WINDOW_CLOSED',
      reason: 'Check-in is open only through 2026-11-20. Please choose a check-in on or before that date.',
    })
    expect(isBeyondBookingWindow('2026-11-21', CUTOFF)).toBe(true)
    expect(isBeyondBookingWindow('2026-11-20', CUTOFF)).toBe(false)
    expect(isBeyondBookingWindow('2030-01-01', '')).toBe(false)
  })

  it('keeps the lead time in force, so a cutoff never makes a too-soon date bookable', () => {
    expect(validateBookableCheckIn('2026-10-30', NOW, 30, CUTOFF)).toEqual({
      ok: false,
      code: 'MINIMUM_BOOKING_LEAD_TIME',
      reason: 'This date is not available for advance booking. Please choose a check-in date at least 30 days from today.',
    })
    expect(validateBookableCheckIn('2026-10-31', NOW, 30, CUTOFF)).toEqual({ ok: true })
    expect(validateBookableCheckIn('2026-11-01', NOW, 30, CUTOFF)).toEqual({ ok: true })
  })

  it('is open through the cutoff and closed when the cutoff precedes the lead time', () => {
    const open = validateBookingSelection(selection('2026-11-20', '2026-11-21'), {
      published,
      minimumBookingLeadTimeDays: 30,
      now: NOW,
      bookingsOpenUntil: CUTOFF,
    })
    expect(open.ok).toBe(true)

    const afterCutoff = validateBookingSelection(selection('2026-11-21', '2026-11-22'), {
      published,
      minimumBookingLeadTimeDays: 30,
      now: NOW,
      bookingsOpenUntil: CUTOFF,
    })
    expect(afterCutoff).toMatchObject({
      ok: false,
      failure: { code: 'BOOKING_WINDOW_CLOSED', field: 'check_in' },
    })

    // The Admin can close a season so early that the 30-day lead time already
    // reaches past it: no date satisfies both, and the Guest is told both facts.
    const closed = validateBookingSelection(selection('2026-10-31', '2026-11-01'), {
      published,
      minimumBookingLeadTimeDays: 30,
      now: NOW,
      bookingsOpenUntil: '2026-10-20',
    })
    expect(closed).toMatchObject({ ok: false, failure: { code: 'BOOKING_WINDOW_CLOSED', field: 'check_in' } })
  })

  it('still enforces the cutoff when the caller supplied a fresh server policy boundary', () => {
    const result = validateBookingSelection(selection('2026-11-21', '2026-11-22'), {
      published,
      minimumBookingLeadTimeDays: 30,
      now: NOW,
      bookingsOpenUntil: CUTOFF,
      checkLeadTime: false,
    })
    expect(result).toMatchObject({ ok: false, failure: { code: 'BOOKING_WINDOW_CLOSED', field: 'check_in' } })
  })

  it('refuses a multi-night stay that would run past the last bookable checkout', () => {
    const result = validateBookingSelection(selection('2026-11-19', '2026-11-22'), {
      published,
      minimumBookingLeadTimeDays: 30,
      now: NOW,
      bookingsOpenUntil: CUTOFF,
      checkLeadTime: false,
    })
    expect(result).toMatchObject({ ok: false, failure: { code: 'BOOKING_WINDOW_CLOSED', field: 'check_out' } })
  })
})
