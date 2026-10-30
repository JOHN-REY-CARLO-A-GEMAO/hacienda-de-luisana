import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { GuestAuthPage } from '../../src/pages/AuthPage'
import { StayRequestsSection } from '../../src/components/Booking/StayRequestsSection'
import type { PublishedRates } from '../../src/lib/booking'

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'guest' }, role: 'guest', loading: false }),
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('booking sign-in return', () => {
  it.each([
    ['/guest/auth?returnTo=book', 'booking destination'],
    ['/guest/auth?returnTo=https://example.com', 'account destination'],
    ['/guest/auth', 'account destination'],
  ])('allows only the booking destination for %s', (path, expected) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes>
        <Route path="/guest/auth" element={<GuestAuthPage />} />
        <Route path="/book" element={<div>booking destination</div>} />
        <Route path="/mybookings" element={<div>account destination</div>} />
      </Routes></MemoryRouter>))
      expect(container.textContent).toBe(expected)
    } finally { act(() => root.unmount()) }
  })
})

describe('add-on descriptions', () => {
  it('uses published unit prices rather than conflicting fallback amounts', () => {
    const published = {
      version: 'v1', effective_date: '2026-10-01', holiday_dates: [], accommodations: {},
      pet_policy: { fee_per_pet: 420, max_pets: 5 },
      late_checkout_per_hour: 375,
      policies: { optional_charges: { bonfire_wood: { label: 'Wood', amount: 225, automatic: false, note: '' } } },
    } as PublishedRates
    const html = renderToStaticMarkup(<StayRequestsSection
      published={published} fallback={{ fee_per_pet: 300, bonfire_wood_per_set: 150, late_checkout_per_hour: 250 }}
      values={{ pet_count: 1, bonfire_wood_sets: 1, late_checkout_hours: 1, event_purpose: '', event_purpose_detail: '', notes: '' }}
      onChange={() => {}}
    />)
    expect(html).toContain('₱420 per pet')
    expect(html).toContain('wood set is ₱225')
    expect(html).toContain('Extra hours are ₱375 per hour')
    expect(html).not.toContain('Extra hours are ₱250 per hour')
  })
})
