// The invoice is the one document a Guest prints or sends to whoever is paying,
// so its figures have to survive a redesign. These pin the arithmetic and the
// two things that make it a document rather than a screen: the reference a
// person quotes back, and a print path that drops the on-screen controls.
//
// It also pins the honest cases — a Booking with no recorded money must not
// invent a total, and a pending add-on must never be summed in as a charge.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingInvoice } from '../../src/components/Booking/BookingInvoice'
import type { Booking } from '../../src/lib/storage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

function render(over: Partial<Booking> = {}) {
  const booking = {
    id: 'bk-invoice-1',
    ref_id: 'HDL-7781',
    uid: 'guest-1',
    guest_name: 'Maria Santos',
    email: 'maria@example.com',
    phone: '09171234567',
    accommodation: 'main-house',
    check_in: '2026-12-18',
    check_out: '2026-12-20',
    guests: 8,
    status: 'Reserved',
    special_requests: '',
    created_at: '2026-10-01T04:00:00.000Z',
    stay_total: 24000,
    security_deposit: 2000,
    amount_due: 12000,
    amount_claimed: 12000,
    amount_verified: 12000,
    ...over,
  } as unknown as Booking

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<BookingInvoice booking={booking} onClose={() => {}} />)
  })
  return {
    container,
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    html: () => container.innerHTML,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('the invoice a Guest is handed', () => {
  it('names the Hacienda, the reference and the guest', () => {
    const page = render()
    expect(page.text()).toContain('Hacienda de LuisAna')
    expect(page.text()).toContain('HDL-7781')
    expect(page.text()).toContain('Maria Santos')
    expect(page.text()).toContain('maria@example.com')
    expect(page.text()).toContain('The Main House')
  })

  it('totals the stay, the deposit and what is still owed', () => {
    const page = render()
    const text = page.text()

    // 24,000 stay + 2,000 deposit = 26,000; 12,000 verified leaves 14,000.
    expect(text).toContain('₱26,000.00')
    expect(text).toContain('₱12,000.00')
    expect(text).toContain('₱14,000.00')
    expect(text).toContain('Balance due at check-in')
  })

  it('never lets the balance go negative when more was paid than was owed', () => {
    const page = render({ amount_verified: 40000, amount_claimed: 40000 })
    expect(page.text()).toContain('₱0.00')
    expect(page.text()).not.toContain('-₱')
  })

  it('shows no invented figures for a Booking that recorded no money', () => {
    const page = render({
      stay_total: undefined,
      total_amount: undefined,
      security_deposit: 0,
      amount_due: undefined,
      amount_claimed: undefined,
      amount_verified: undefined,
    })
    const text = page.text()

    // Everything resolves to zero rather than to a guess, and the refund line
    // says so instead of implying money moved.
    expect(text).toContain('₱0.00')
    expect(text).not.toContain('₱24,000')
    expect(text).not.toContain('NaN')
  })

  it('marks a pending add-on as pending, and does not charge for it', () => {
    const page = render({
      pet_request: {
        count: 2,
        estimated_fee: 600,
        status: 'pending',
        requested_at: '2026-10-02T00:00:00.000Z',
      },
    })
    const text = page.text()

    // The estimate is shown as an estimate, and the grand total is still
    // 26,000 — a fee the Admin has not approved is not a charge.
    expect(text).toContain('Pending Admin approval')
    expect(text).toContain('₱600.00 est.')
    expect(text).toContain('₱26,000.00')
    expect(text).not.toContain('₱26,600')
  })

  it('sums an approved late-checkout fee into the total', () => {
    const page = render({ late_checkout_fee: 500 })
    expect(page.text()).toContain('₱26,500.00')
  })

  it('prints without the on-screen controls, and can be closed', () => {
    const page = render()

    // The action row is `print:hidden`; the document itself is not.
    expect(page.html()).toContain('print:hidden')
    expect(page.text()).toContain('Print or save invoice')

    const close = [...page.container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Close'),
    )
    expect(close).toBeTruthy()
  })

  it('falls back to the stored id when a Booking has no reference', () => {
    const page = render({ ref_id: undefined })
    expect(page.text()).toContain('BK-INVOICE-1'.slice(0, 8))
  })
})
