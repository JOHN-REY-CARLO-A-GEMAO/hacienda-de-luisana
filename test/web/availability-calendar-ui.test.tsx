import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../src/lib/firestoreBookings', () => ({
  cloudBookingsDB: { getAvailabilityCalendar: api.get },
}))

import { AvailabilityCalendar, calendarGridRange, dualMonthRange } from '../../src/components/Booking/AvailabilityCalendar'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement

function response(accommodation = 'main-house') {
  const grid = calendarGridRange('2026-11')
  return {
    accommodation,
    from: grid.from,
    to: grid.to,
    generated_at: '2026-10-22T04:00:00.000Z',
    days: grid.dates.map((date) => ({
      date,
      state: date === '2026-11-22' ? 'booked' as const
        : date === '2026-11-23' ? 'pending' as const
          : 'available' as const,
    })),
  }
}

function render(overrides: Partial<ComponentProps<typeof AvailabilityCalendar>> = {}) {
  const props: ComponentProps<typeof AvailabilityCalendar> = {
    accommodation: 'main-house',
    accommodationName: 'The Main House',
    earliestCheckIn: '2026-11-21',
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
      const nights = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000)
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

    expect(container.querySelector('[data-date="2026-11-21"]')?.getAttribute('data-availability')).toBe('available')
    expect(container.querySelector('[data-date="2026-11-22"]')?.getAttribute('data-availability')).toBe('booked')
    expect(container.querySelector('[data-date="2026-11-23"]')?.getAttribute('data-availability')).toBe('pending')
    expect(container.querySelector('[data-date="2026-11-20"]')?.getAttribute('data-availability')).toBe('invalid')
    expect(container.querySelector<HTMLButtonElement>('[data-date="2026-11-22"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('Available')
    expect(container.textContent).toContain('Booked')
    expect(container.textContent).toContain('Pending hold')
    expect(container.textContent).toContain('Past / invalid / unknown')
  })

  it('selects a check-in first, then a checkout date', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await settle()

    act(() => container.querySelector<HTMLButtonElement>('[data-date="2026-11-21"]')!.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-11-21', '')

    render({ onChange, checkIn: '2026-11-21' })
    await settle()
    expect(container.textContent).toContain('Now choose a checkout date')

    act(() => container.querySelector<HTMLButtonElement>('[data-date="2026-11-22"]')!.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-11-21', '2026-11-22')
  })

  it('shows two consecutive months and pages them together', async () => {
    render()
    await settle()

    const monthLabels = [...container.querySelectorAll('[data-month-label]')].map((node) => node.getAttribute('data-month-label'))
    expect(monthLabels).toEqual(['November 2026', 'December 2026'])

    const previous = container.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!
    expect(previous.disabled).toBe(true)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click())
    await settle()
    expect([...container.querySelectorAll('[data-month-label]')].map((node) => node.getAttribute('data-month-label')))
      .toEqual(['December 2026', 'January 2027'])
  })

  it('highlights both endpoints and the whole stay range between them', async () => {
    render({ checkIn: '2026-11-25', checkOut: '2026-11-28' })
    await settle()

    expect(container.querySelector('[data-date="2026-11-25"]')?.getAttribute('data-selected')).toBe('start')
    expect(container.querySelector('[data-date="2026-11-28"]')?.getAttribute('data-selected')).toBe('end')
    expect(container.querySelector('[data-date="2026-11-26"]')?.closest('[data-in-range]')?.getAttribute('data-in-range')).toBe('true')
    expect(container.querySelector('[data-date="2026-11-27"]')?.closest('[data-in-range]')?.getAttribute('data-in-range')).toBe('true')
    expect(container.querySelector('[data-date="2026-11-25"]')?.closest('[data-in-range]')).toBeNull()
    expect(container.querySelector('[data-date="2026-11-28"]')?.closest('[data-in-range]')).toBeNull()
  })

  it('lets a booked date be the checkout boundary but not part of the stay', async () => {
    const onChange = vi.fn()
    render({ checkIn: '2026-11-21', onChange })
    await settle()

    const bookedBoundary = container.querySelector<HTMLButtonElement>('[data-date="2026-11-22"]')!
    expect(bookedBoundary.disabled).toBe(false)
    expect(bookedBoundary.getAttribute('data-checkout-candidate')).toBe('true')
    act(() => bookedBoundary.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-11-21', '2026-11-22')

    // 24 would stay across the booked 22nd, so it is not a checkout and starts
    // a fresh selection instead of producing a conflicting stay.
    const laterNight = container.querySelector<HTMLButtonElement>('[data-date="2026-11-24"]')!
    act(() => laterNight.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-11-24', '')
  })

  it('offers only checkout dates the current booking policy supports', async () => {
    const onChange = vi.fn()
    render({
      checkIn: '2026-11-24',
      onChange,
      validateRange: (checkIn, checkOut) => (
        checkOut > checkIn && (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000 === 1
          ? { ok: true }
          : { ok: false, reason: 'Online booking currently supports one standard stay.' }
      ),
    })
    await settle()

    expect(container.querySelector<HTMLButtonElement>('[data-date="2026-11-25"]')!.disabled).toBe(false)
    expect(container.querySelector('[data-date="2026-11-25"]')!.getAttribute('data-checkout-candidate')).toBe('true')
    const twoNights = container.querySelector<HTMLButtonElement>('[data-date="2026-11-26"]')!
    expect(twoNights.disabled).toBe(false)
    expect(twoNights.getAttribute('data-checkout-candidate')).toBeNull()

    act(() => twoNights.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-11-26', '')
  })

  it('offers the twentieth night but never the twenty-first, even if the policy would allow it', async () => {
    const onChange = vi.fn()
    const upToTwentyNights = (checkIn: string, checkOut: string) => {
      const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000)
      return nights > 0 && nights <= 20 ? { ok: true } : { ok: false, reason: 'A stay may be at most 20 nights.' }
    }
    // 26 October → 15 November is 20 nights, and this fixture keeps every night
    // free so only the stay-length maximum can refuse the 21st.
    api.get.mockResolvedValue({
      accommodation: 'main-house',
      from: '2026-10-01',
      to: '2027-01-01',
      generated_at: '2026-10-22T04:00:00.000Z',
      days: Array.from({ length: 92 }, (_, index) => ({
        date: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10),
        state: 'available' as const,
      })),
    })
    render({
      earliestCheckIn: '2026-10-01',
      checkIn: '2026-10-26',
      onChange,
      validateRange: upToTwentyNights,
    })
    await settle()

    const twentieth = container.querySelector<HTMLButtonElement>('[data-date="2026-11-15"]')!
    expect(twentieth.disabled).toBe(false)
    expect(twentieth.getAttribute('data-checkout-candidate')).toBe('true')

    // The 21st night is free in the fixture, so only the stay-length maximum can
    // be what keeps it from being offered as a checkout.
    expect(container.querySelector('[data-date="2026-11-16"]')?.getAttribute('data-availability')).toBe('available')
    expect(container.querySelector('[data-date="2026-11-16"]')?.getAttribute('data-checkout-candidate')).toBeNull()

    act(() => twentieth.click())
    expect(onChange).toHaveBeenLastCalledWith('2026-10-26', '2026-11-15')
  })

  it('clears a checkout that the new check-in date makes invalid', async () => {
    const onChange = vi.fn()
    render({ earliestCheckIn: '2026-11-01', checkIn: '2026-11-15', checkOut: '2026-11-30', onChange })
    await settle()

    // Moving the check-in earlier stretches the stay past 20 nights, so the
    // already-chosen checkout can no longer stand.
    const checkInField = container.querySelector<HTMLInputElement>('[data-tour-field="check-in"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(checkInField, '2026-11-05')
    act(() => checkInField.dispatchEvent(new Event('input', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-05', '')

    // Moving it later than the checkout clears it too: a checkout before
    // check-in is never a stay.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(checkInField, '2026-12-02')
    act(() => checkInField.dispatchEvent(new Event('input', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('2026-12-02', '')
  })

  it('states the maximum stay and the last valid checkout for the chosen check-in', async () => {
    render({ earliestCheckIn: '2026-11-01', checkIn: '2026-11-10' })
    await settle()
    expect(container.textContent).toContain('Stays are 1 to 20 nights')
    expect(container.textContent).toContain('the latest checkout is Nov 30, 2026')
    expect(container.querySelector<HTMLInputElement>('[data-tour-field="check-out"]')!.max).toBe('2026-11-30')
  })

  it('clears both dates, and Close hides the calendars without losing the fields', async () => {
    const onChange = vi.fn()
    render({ checkIn: '2026-11-21', checkOut: '2026-11-22', onChange })
    await settle()

    const clear = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Clear dates')!
    act(() => clear.click())
    expect(onChange).toHaveBeenLastCalledWith('', '')

    const close = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Close')!
    act(() => close.click())
    expect(container.querySelector('[data-calendar-body]')).toBeNull()
    expect(container.querySelector('[data-tour-field="check-in"]')).toBeTruthy()
    expect(container.querySelector('[data-tour-field="check-out"]')).toBeTruthy()
    expect(container.textContent).toContain('Edit dates')
  })

  it('highlights both selected boundaries and permits a booked checkout boundary', async () => {
    render({ checkIn: '2026-11-21', checkOut: '2026-11-22' })
    await settle()
    expect(container.querySelector('[data-date="2026-11-21"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-date="2026-11-22"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('another Guest may check in on')
  })

  it('clears and explains a selected check-in that has become unavailable', async () => {
    const onChange = vi.fn()
    const onInvalidated = vi.fn()
    render({
      checkIn: '2026-11-22', checkOut: '2026-11-23', onChange, onInvalidated,
    })
    await settle()
    expect(onChange).toHaveBeenCalledWith('', '')
    expect(onInvalidated).toHaveBeenCalledWith(expect.stringContaining('already booked'))
  })

  it('fails closed when availability cannot be read', async () => {
    api.get.mockRejectedValue(new Error('Availability could not be confirmed right now.'))
    render()
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Availability unknown')
    expect(container.querySelector<HTMLButtonElement>('[data-date="2026-11-21"]')?.disabled).toBe(true)
    expect(container.querySelector('[data-date="2026-11-21"]')?.getAttribute('data-availability')).toBe('unknown')
  })

  it('requests only the selected Accommodation and switches cleanly', async () => {
    const props = render()
    await settle()
    expect(api.get).toHaveBeenLastCalledWith(
      { accommodation: 'main-house', from: '2026-11-01', to: '2027-01-01' },
      expect.anything(),
    )

    api.get.mockResolvedValue(response('annex'))
    render({ ...props, accommodation: 'annex', accommodationName: 'HDL Annex' })
    await settle()
    expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ accommodation: 'annex' }), expect.anything())
  })
})
