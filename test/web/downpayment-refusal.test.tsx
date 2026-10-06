// DownpaymentPage refuses a Booking it cannot attach to anybody.
//
// The bug this exists for. `firestore.rules` refuses a Booking whose `uid` is
// empty, and `ensureGuestUid()` returns `null` when anonymous sign-in is off —
// which it is by default in a new Firebase project. The page carried on anyway:
// it uploaded the Guest's screenshot, wrote a Booking with no `uid`, took the
// rules' `permission-denied`, and reported it as a lead-time failure. The Guest
// was told to move a date that was never the problem, and the real cause was
// discarded on the way.
//
// So a missing identity is caught before the screenshot leaves the device: it
// is a certain refusal, not a risk of one, and there is nothing to send.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adapter = vi.hoisted(() => ({
  add: vi.fn(),
  checkAvailability: vi.fn(async () => ({ available: true, conflicts: [] })),
  validateGuestCheckIn: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../src/lib/guestAuth', () => ({ ensureGuestUid: async () => null }))
vi.mock('../../src/lib/payments', () => ({
  uploadPaymentProof: async () => ({ ok: true, url: 'payments/demo/proof.png', uid: 'demo' }),
}))
vi.mock('../../src/lib/firestoreBookings', () => ({
  cloudBookingsDB: {
    get isCloud() {
      return true
    },
    add: adapter.add,
    checkAvailability: adapter.checkAvailability,
    validateGuestCheckIn: adapter.validateGuestCheckIn,
  },
}))

import { DownpaymentPage } from '../../src/pages/DownpaymentPage'
import { saveBookingDraft, clearBookingDraft } from '../../src/lib/bookingDraft'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:test-preview' })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  }
})

const mounted: Root[] = []
const PUMP_MS = 10

async function pump(turns = 1) {
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

function renderPage(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <DownpaymentPage />
      </MemoryRouter>,
    )
  })
  mounted.push(root)
  return container
}

async function submitBooking(container: HTMLElement) {
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!fileInput) throw new Error('the screenshot uploader is missing')
  const receipt = new File(['Amount 3,000.00'], 'receipt.png', { type: 'image/png' })
  await act(async () => {
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [receipt] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await pump(3)

  const submit = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Submit booking'))
  if (!submit) throw new Error('the submit button is missing')
  await act(async () => {
    submit!.click()
  })
  await pump(3)
}

describe('DownpaymentPage with no Guest identity to attach the Booking to', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem(LOCAL_RATES_KEY, JSON.stringify({
      version: 'test-v1', effective_date: '2026-10-01', holiday_dates: [],
      accommodations: {
        'main-house': {
          property_name: 'The Main House', rate_unit: 'standard_stay', active: true,
          security_deposit: 0, down_payment_percent: 50,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
          },
        },
      },
    }))
    clearBookingDraft()
    saveBookingDraft({
      accommodation: 'main-house',
      check_in: '2029-06-01',
      check_out: '2029-06-02',
      guests: 10,
      name: 'John Guest',
      phone: '09304857798',
      email: 'j23245164@gmail.com',
      special_requests: '',
    })
  })

  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
    document.body.innerHTML = ''
  })

  it('never reaches Firestore with a Booking the rules would refuse', async () => {
    const container = renderPage()
    await pump(2)
    await submitBooking(container)

    // The rules refuse a Booking with no `uid`. Sending one to be told so wastes
    // the Guest's upload and turns a deployment fault into their date mistake.
    expect(adapter.add).not.toHaveBeenCalled()
    expect(container.textContent).toContain('could not attach this booking to you')
  })

  it('does not blame the check-in date for a fault that has nothing to do with dates', async () => {
    const container = renderPage()
    await pump(2)
    await submitBooking(container)

    // The wording that sent the real Guest looking for another date.
    expect(container.textContent).not.toMatch(/days from today/i)
    expect(container.textContent).not.toMatch(/lead time|advance booking/i)
  })

  it('tells the Guest nothing was saved, so they do not think it is on its way', async () => {
    const container = renderPage()
    await pump(2)
    await submitBooking(container)

    expect(container.textContent).toContain('Nothing was saved')
  })
})