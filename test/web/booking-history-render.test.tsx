import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingHistory } from '../../src/components/Booking/BookingHistory'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import type { ActivityLogEntry } from '../../src/lib/booking'
import { formatDateTime } from '../../src/lib/formatDate'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
const timestamp = { seconds: 1_790_173_200, nanoseconds: 0 }

function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(<BookingHistory bookingId="booking-1" />))
  return container
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('Booking History timestamp rendering', () => {
  it('renders a Firestore wire Timestamp as a formatted string, never as an object child', async () => {
    vi.spyOn(cloudBookingsDB, 'history').mockResolvedValue([
      {
        booking_id: 'booking-1',
        action: 'ReviewPublished',
        from_status: 'none',
        to_status: 'published',
        actor: 'admin',
        actor_id: 'admin-1',
        actor_name: 'Hacienda Admin',
        at: timestamp,
        seq: 1,
      } as unknown as ActivityLogEntry,
    ])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const container = mount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Review published to the website')
    expect(container.textContent).toContain(formatDateTime(timestamp))
    expect(container.textContent).not.toContain('[object Object]')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
