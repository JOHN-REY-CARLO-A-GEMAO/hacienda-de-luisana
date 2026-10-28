import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../src/lib/firestoreBookings', () => ({
  cloudBookingsDB: { getAvailabilityCalendar: api.get },
}))

import { AvailabilityCalendar, calendarGridRange, dualMonthRange } from '../../src/components/Booking/AvailabilityCalendar'
import { bookingBusinessDate } from '../../src/lib/booking/leadTime'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement

// ---------------------------------------------------------------------------
// Every date in this suite is computed from today's Hacienda business date
// (Asia/Manila), so the suite never depends on a hard-coded calendar date that
// may already be in the past (L-1). The calendar refuses check-ins before
// today, so every check-in/check-out used here is computed forward from today.
//
// UTC is used only for arithmetic on an already-resolved Manila calendar date,
// mirroring src/components/Booking/AvailabilityCalendar.
// ---------------------------------------------------------------------------
const today = bookingBusinessDate()
function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}
function moveMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number)
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7)
}
function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}

// A check-in comfortably in the future, and the two-month grid that shows it.
const base = addDays(today, 45)
const gridMonth = base.slice(0, 7)
const grid = calendarGridRange(gridMonth)
const range = dualMonthRange(gridMonth)
const bookedNight = addDays(base, 3)
const pendingNight = addDays(base, 4)

function response(accommodation = 'main-house') {
  return {
    accommodation,
    from: grid.from,
    to: grid.to,
    generated_at: `${today}T00:00:00.000Z`,
    days: grid.dates.map((date) => ({
      date,
      state:
        date === bookedNight
          ? ('booked' as const)
          : date === pendingNight
            ? ('pending' as const)
            : ('available' as const),
    })),
  }
}

function render(overrides: Partial<ComponentProps<typeof AvailabilityCalendar>> = {}) {
  const props: ComponentProps<typeof AvailabilityCalendar> = {
    accommodation: 'main-house',
    accommodationName: 'The Main House',
    earliestCheckIn: base,
    checkIn: '',
    checkOut: '',
    onChange: vi.fn(),
    ...overrides,
  }
  act(() => root.render(<AvailabilityCalendar {...props} />))
  return props
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue(response())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('dual-month availability range', () => {
  it('never asks the callable for more than its 62-night bound', () => {
    for (let offset = 0; offset < 24; offset += 1) {
      const month = new Date(Date.UTC(2026, offset, 1)).toISOString().slice(0, 7)
      const range = dualMonthRange(month)
      const nights = Math.round(
        (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) /
          86_400_000,
      )
      expect(nights).toBeGreaterThanOrEqual(59)
      expect(nights).toBeLessThanOrEqual(62)
      expect(range.months[0]).toBe(month)
    }
  })
})

describe('interactive availability calendar', () => {
  it('renders accessible available/booked/pending/invalid states and a visible key', async () => {
    render()
    await settle()

    expect(container.querySelector(`[data-date="${base}"]`)?.getAttribute('data-availability')).toBe('available')
    expect(container.querySelector(`[data-date="${bookedNight}"]`)?.getAttribute('data-availability')).toBe('booked')
    expect(container.querySelector(`[data-date="${pendingNight}"]`)?.getAttribute('data-availability')).toBe('pending')
    // A night before the earliest check-in is invalid.
    expect(container.querySelector(`[data-date="${addDays(base, -1)}"]`)?.getAttribute('data-availability')).toBe('invalid')
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${bookedNight}"]`)?.disabled).toBe(true)
    expect(container.textContent).toContain('Available')
    expect(container.textContent).toContain('Booked')
    expect(container.textContent).toContain('Pending hold')
    expect(container.textContent).toContain('Past / invalid / unknown')
  })

  it('selects a check-in first, then a checkout date', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await settle()

    act(() => container.querySelector<HTMLButtonElement>(`[data-date="${base}"]`)!.click())
    expect(onChange).toHaveBeenLastCalledWith(base, '')

    render({ onChange, checkIn: base })
    await settle()
    expect(container.textContent).toContain('Now choose a checkout date')

    act(() => container.querySelector<HTMLButtonElement>(`[data-date="${addDays(base, 1)}"]`)!.click())
    expect(onChange).toHaveBeenLastCalledWith(base, addDays(base, 1))
  })

  it('shows two consecutive months and pages them together', async () => {
    render()
    await settle()

    const monthLabels = [...container.querySelectorAll('[data-month-label]')].map(
      (node) => node.getAttribute('data-month-label'),
    )
    expect(monthLabels).toEqual([monthLabel(gridMonth), monthLabel(moveMonth(gridMonth, 1))])

    const previous = container.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!
    expect(previous.disabled).toBe(true)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click())
    await settle()
    expect(
      [...container.querySelectorAll('[data-month-label]')].map(
        (node) => node.getAttribute('data-month-label'),
      ),
    ).toEqual([monthLabel(moveMonth(gridMonth, 1)), monthLabel(moveMonth(gridMonth, 2))])
  })

  it('highlights both endpoints and the whole stay range between them', async () => {
    const checkOut = addDays(base, 5)
    render({ checkIn: base, checkOut })
    await settle()

    expect(container.querySelector(`[data-date="${base}"]`)?.getAttribute('data-selected')).toBe('start')
    expect(container.querySelector(`[data-date="${checkOut}"]`)?.getAttribute('data-selected')).toBe('end')
    expect(
      container.querySelector(`[data-date="${addDays(base, 1)}"]`)?.closest('[data-in-range]')?.getAttribute('data-in-range'),
    ).toBe('true')
    expect(
      container.querySelector(`[data-date="${addDays(base, 2)}"]`)?.closest('[data-in-range]')?.getAttribute('data-in-range'),
    ).toBe('true')
    expect(container.querySelector(`[data-date="${base}"]`)?.closest('[data-in-range]')).toBeNull()
    expect(container.querySelector(`[data-date="${checkOut}"]`)?.closest('[data-in-range]')).toBeNull()
  })

  it('lets a booked date be the checkout boundary but not part of the stay', async () => {
    const onChange = vi.fn()
    render({ checkIn: base, onChange })
    await settle()

    const bookedBoundary = container.querySelector<HTMLButtonElement>(`[data-date="${bookedNight}"]`)!
    expect(bookedBoundary.disabled).toBe(false)
    expect(bookedBoundary.getAttribute('data-checkout-candidate')).toBe('true')
    act(() => bookedBoundary.click())
    expect(onChange).toHaveBeenLastCalledWith(base, bookedNight)

    // Staying across the booked night starts a fresh selection instead.
    const laterNight = container.querySelector<HTMLButtonElement>(`[data-date="${addDays(base, 5)}"]`)!
    act(() => laterNight.click())
    expect(onChange).toHaveBeenLastCalledWith(addDays(base, 5), '')
  })

  it('offers only checkout dates the current booking policy supports', async () => {
    const onChange = vi.fn()
    const checkIn = addDays(base, 6)
    render({
      checkIn,
      onChange,
      validateRange: (checkIn, checkOut) =>
        checkOut > checkIn &&
        (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000 === 1
          ? { ok: true }
          : { ok: false, reason: 'Online booking currently supports one standard stay.' },
    })
    await settle()

    const oneNight = addDays(checkIn, 1)
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${oneNight}"]`)!.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${oneNight}"]`)!.getAttribute('data-checkout-candidate')).toBe('true')
    const twoNights = addDays(checkIn, 2)
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${twoNights}"]`)!.disabled).toBe(false)
    expect(
      container.querySelector<HTMLButtonElement>(`[data-date="${twoNights}"]`)!.getAttribute('data-checkout-candidate'),
    ).toBeNull()

    act(() => container.querySelector<HTMLButtonElement>(`[data-date="${twoNights}"]`)!.click())
    expect(onChange).toHaveBeenLastCalledWith(twoNights, '')
  })

  it('offers the twentieth night but never the twenty-first, even if the policy would allow it', async () => {
    const onChange = vi.fn()
    const upToTwentyNights = (checkIn: string, checkOut: string) => {
      const nights = Math.round(
        (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000,
      )
      return nights > 0 && nights <= 20 ? { ok: true } : { ok: false, reason: 'A stay may be at most 20 nights.' }
    }
    // This fixture keeps every night free so only the stay-length maximum can
    // refuse the 21st night.
    api.get.mockResolvedValue({
      accommodation: 'main-house',
      from: range.from,
      to: range.to,
      generated_at: `${today}T00:00:00.000Z`,
      days: grid.dates.map((date) => ({ date, state: 'available' as const })),
    })
    render({ earliestCheckIn: base, checkIn: base, onChange, validateRange: upToTwentyNights })
    await settle()

    const twentieth = addDays(base, 20)
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${twentieth}"]`)!.disabled).toBe(false)
    expect(
      container.querySelector<HTMLButtonElement>(`[data-date="${twentieth}"]`)!.getAttribute('data-checkout-candidate'),
    ).toBe('true')

    // The 21st night is free in the fixture, so only the stay-length maximum
    // can be what keeps it from being offered as a checkout.
    const twentyFirst = addDays(base, 21)
    expect(container.querySelector(`[data-date="${twentyFirst}"]`)?.getAttribute('data-availability')).toBe('available')
    expect(
      container.querySelector(`[data-date="${twentyFirst}"]`)?.getAttribute('data-checkout-candidate'),
    ).toBeNull()

    act(() => container.querySelector<HTMLButtonElement>(`[data-date="${twentieth}"]`)!.click())
    expect(onChange).toHaveBeenLastCalledWith(base, twentieth)
  })

  it('clears a checkout that the new check-in date makes invalid', async () => {
    const onChange = vi.fn()
    const checkIn = addDays(base, 10)
    const checkOut = addDays(base, 30)
    render({ earliestCheckIn: base, checkIn, checkOut, onChange })
    await settle()

    // Moving the check-in earlier stretches the stay past 20 nights, so the
    // already-chosen checkout can no longer stand.
    const earlier = addDays(base, 9)
    const checkInField = container.querySelector<HTMLInputElement>('[data-tour-field="check-in"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(checkInField, earlier)
    act(() => checkInField.dispatchEvent(new Event('input', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(earlier, '')

    // Moving it later than the checkout clears it too.
    const later = addDays(base, 35)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(checkInField, later)
    act(() => checkInField.dispatchEvent(new Event('input', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(later, '')
  })

  it.each([1, 2, 5, 20])('allows a %i-night range and highlights every night of it', async (nights) => {
    // bookedNight is base+3 and pendingNight is base+4, so a stay starting at
    // base would span a blocked night once it reaches 4+ nights. Start the
    // stay after both so every 1-20 night stay is a valid checkout candidate.
    const stayStart = addDays(base, 5)
    const onChange = vi.fn()
    const checkOut = addDays(stayStart, nights)
    render({
      earliestCheckIn: base,
      checkIn: stayStart,
      checkOut,
      onChange,
      // Allow every 1-20 night stay so the stay-length maximum is the only
      // boundary, mirroring the twentieth-night fixture.
      validateRange: (checkIn, checkOut) => {
        const n = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
        return n > 0 && n <= 20 ? { ok: true } : { ok: false, reason: 'A stay may be at most 20 nights.' }
      },
    })
    await settle()

    act(() => container.querySelector<HTMLButtonElement>(`[data-date="${checkOut}"]`)!.click())
    expect(onChange).toHaveBeenLastCalledWith(stayStart, checkOut)

    // Every night strictly between check-in and check-out is highlighted.
    for (let n = 1; n < nights; n += 1) {
      const night = addDays(stayStart, n)
      expect(container.querySelector(`[data-date="${night}"]`)?.closest('[data-in-range]')?.getAttribute('data-in-range')).toBe('true')
    }
  })

  it('highlights both selected boundaries and permits a booked checkout boundary', async () => {
    render({ checkIn: base, checkOut: bookedNight })
    await settle()
    expect(container.querySelector(`[data-date="${base}"]`)?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector(`[data-date="${bookedNight}"]`)?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('another Guest may check in on')
  })

  it('clears and explains a selected check-in that has become unavailable', async () => {
    const onChange = vi.fn()
    const onInvalidated = vi.fn()
    render({ checkIn: bookedNight, checkOut: pendingNight, onChange, onInvalidated })
    await settle()
    expect(onChange).toHaveBeenCalledWith('', '')
    expect(onInvalidated).toHaveBeenCalledWith(expect.stringContaining('already booked'))
  })

  it('fails closed when availability cannot be read', async () => {
    api.get.mockRejectedValue(new Error('Availability could not be confirmed right now.'))
    render()
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Availability unknown')
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${base}"]`)?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>(`[data-date="${base}"]`)?.getAttribute('data-availability')).toBe('unknown')
  })

  it('requests only the selected Accommodation and switches cleanly', async () => {
    const props = render()
    await settle()
    expect(api.get).toHaveBeenLastCalledWith(
      { accommodation: 'main-house', from: range.from, to: range.to },
      expect.anything(),
    )

    api.get.mockResolvedValue(response('annex'))
    render({ ...props, accommodation: 'annex', accommodationName: 'HDL Annex' })
    await settle()
    expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ accommodation: 'annex' }), expect.anything())
  })
})
