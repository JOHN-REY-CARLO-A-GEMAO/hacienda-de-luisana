import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../src/lib/firestoreBookings', () => ({
  cloudBookingsDB: { getAvailabilityCalendar: api.get },
}))

import { AvailabilityCalendar, calendarGridRange } from '../../src/components/Booking/AvailabilityCalendar'

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

  it('selects one standard-stay night and treats a booked next date as checkout only', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await settle()
    const night = container.querySelector<HTMLButtonElement>('[data-date="2026-11-21"]')!
    act(() => night.click())
    expect(onChange).toHaveBeenCalledWith('2026-11-21', '2026-11-22')
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
    expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ accommodation: 'main-house' }), expect.anything())

    api.get.mockResolvedValue(response('annex'))
    render({ ...props, accommodation: 'annex', accommodationName: 'HDL Annex' })
    await settle()
    expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ accommodation: 'annex' }), expect.anything())
  })
})
