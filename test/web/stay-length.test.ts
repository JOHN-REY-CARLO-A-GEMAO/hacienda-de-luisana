import { describe, expect, it } from 'vitest'
import {
  MAX_STAY_NIGHTS,
  maximumCheckoutDate,
  stayLengthProblem,
  validateBookingSelection,
  type PublishedRates,
} from '../../src/lib/booking'
import { MAX_BOOKING_NIGHTS, validateStayDates } from '../../src/lib/validation'

const published: PublishedRates = {
  version: 'v1-guest-v3',
  effective_date: '2026-10-05',
  holiday_dates: [],
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

const NOW = new Date('2026-10-01T04:00:00Z')
const CHECK_IN = '2026-11-06'

function checkoutAfter(nights: number): string {
  return new Date(Date.parse(`${CHECK_IN}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10)
}

function selection(checkIn: string, checkOut: string) {
  return validateBookingSelection(
    { accommodation: 'main-house', check_in: checkIn, check_out: checkOut, guests: 2 },
    { published, now: NOW, minimumBookingLeadTimeDays: 30 },
  )
}

describe('the maximum stay length is one number', () => {
  it('is 20 nights, and the courtesy validator reads the same constant', () => {
    expect(MAX_STAY_NIGHTS).toBe(20)
    expect(MAX_BOOKING_NIGHTS).toBe(MAX_STAY_NIGHTS)
  })

  it('names the last usable checkout date', () => {
    expect(maximumCheckoutDate(CHECK_IN)).toBe(checkoutAfter(20))
    expect(maximumCheckoutDate('2026-02-30')).toBeNull()
  })

  it('accepts a one-night stay and exactly twenty nights', () => {
    expect(stayLengthProblem(CHECK_IN, checkoutAfter(1))).toBeNull()
    expect(stayLengthProblem(CHECK_IN, checkoutAfter(20))).toBeNull()
  })

  it('rejects twenty-one nights', () => {
    expect(stayLengthProblem(CHECK_IN, checkoutAfter(21))).toBe('STAY_TOO_LONG')
  })

  it('rejects a checkout that is not after the check-in', () => {
    expect(stayLengthProblem(CHECK_IN, CHECK_IN)).toBe('CHECK_OUT_NOT_AFTER_CHECK_IN')
    expect(stayLengthProblem(CHECK_IN, '2026-11-01')).toBe('CHECK_OUT_NOT_AFTER_CHECK_IN')
  })

  it('leaves unparseable dates to the date validators', () => {
    expect(stayLengthProblem('not-a-date', checkoutAfter(21))).toBeNull()
  })
})

describe('validateStayDates carries the same ceiling and message', () => {
  it('accepts 1 night and exactly 20 nights', () => {
    expect(validateStayDates(CHECK_IN, checkoutAfter(1), NOW)).toEqual({ ok: true })
    expect(validateStayDates(CHECK_IN, checkoutAfter(20), NOW)).toEqual({ ok: true })
  })

  it('refuses 21 nights with a message naming the limit and the last valid checkout', () => {
    const result = validateStayDates(CHECK_IN, checkoutAfter(21), NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('check_out')
    expect(result.message).toContain('at most 20 nights')
    expect(result.message).toContain(checkoutAfter(20))
  })

  it('refuses a checkout on or before the check-in', () => {
    const result = validateStayDates(CHECK_IN, CHECK_IN, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('check_out')
    expect(result.message).toBe('Check-out must be after check-in')
  })
})

describe('the shared booking preflight refuses a stay over the maximum', () => {
  it('names the 20-night rule before the one-standard-stay rule', () => {
    const result = selection(CHECK_IN, checkoutAfter(21))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('STAY_LENGTH_NOT_SUPPORTED')
    expect(result.failure.field).toBe('check_out')
    expect(result.failure.message).toContain('at most 20 nights')
    expect(result.failure.message).toContain('21')
  })

  it('still applies the existing published-stay rule inside the maximum', () => {
    // Exactly 20 nights passes the cap, and is then refused by the one 22-hour
    // standard stay the Published rate model supports. The cap is additive.
    const result = selection(CHECK_IN, checkoutAfter(20))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('STAY_LENGTH_NOT_SUPPORTED')
    expect(result.failure.message).toContain('one 22-hour standard stay')
  })

  it('refuses a checkout before the check-in', () => {
    const result = selection(CHECK_IN, '2026-11-01')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('CHECK_OUT_BEFORE_CHECK_IN')
  })
})
