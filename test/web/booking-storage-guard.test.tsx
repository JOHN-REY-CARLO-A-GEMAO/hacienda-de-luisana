// A blocked or full store must not look like a booking failure.
//
// After the Booking exists, rememberBookingId writes localStorage. Before
// payment, saveBookingDraft writes sessionStorage. Both can throw
// (QuotaExceededError, SecurityError). Those writes are a convenience: losing
// them must not tell the Guest the stay was not submitted, or that the
// booking rules could not be checked.
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from '../../src/pages/BookingPage'
import { DownpaymentPage } from '../../src/pages/DownpaymentPage'
import { BookingStatusPage } from '../../src/pages/BookingStatusPage'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { LAST_BOOKING_KEY, saveBookingDraft } from '../../src/lib/bookingDraft'
import { bookingsDB } from '../../src/lib/storage'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

vi.mock('../../src/lib/payments/ocr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/payments/ocr')>()),
  runReceiptOcr: vi.fn(async () => ({
    reference: '', amount: '', amounts: [], confidence: 'none', notes: [],
    senderName: '', paymentDate: '', paymentDateIso: '',
  })),
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement
const paths: string[] = []

function PathProbe() {
  const location = useLocation()
  useEffect(() => {
    paths.push(location.pathname)
  }, [location.pathname])
  return null
}

function open(path = '/book') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PathProbe />
        <Routes>
          <Route path="/book" element={<BookingPage />} />
          <Route path="/book/pay" element={<DownpaymentPage />} />
          <Route path="/booking/status" element={<BookingStatusPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  ))
}

function input(selector: string) {
  const element = container.querySelector<HTMLInputElement>(selector)
  if (!element) throw new Error(`Missing input: ${selector}`)
  return element
}

function fill(selector: string, value: string) {
  const field = input(selector)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  act(() => field.dispatchEvent(new Event('input', { bubbles: true })))
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}

async function until(test: () => boolean) {
  const deadline = performance.now() + 4000
  while (!test()) {
    if (performance.now() > deadline) throw new Error(`UI did not settle: ${container.textContent}`)
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

function fillDetails() {
  fill('[data-tour-field="check-in"]', '2029-06-01')
  fill('[data-tour-field="check-out"]', '2029-06-02')
  fill('[data-tour-field="guest-name"]', 'Ana Reyes')
  fill('[autocomplete="tel"]', '09171234567')
  fill('[type="email"]', 'ana@example.com')
  click(input('[type="checkbox"]'))
}

async function attachScreenshot() {
  const file = new File(['test screenshot'], 'proof.png', { type: 'image/png' })
  Object.defineProperty(input('[type="file"]'), 'files', { configurable: true, value: [file] })
  await act(async () => input('[type="file"]').dispatchEvent(new Event('change', { bubbles: true })))
  fill('[inputmode="decimal"]', '3000')
}

function submitProof() {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Submit booking'))
  if (!button) throw new Error('No proof submit button')
  click(button)
}

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

beforeEach(() => {
  paths.length = 0
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
  localStorage.setItem(LOCAL_RATES_KEY, JSON.stringify({
    version: 'test-v2', effective_date: '2026-10-01', holiday_dates: [],
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
  resetRateLimit('booking:create')
  bookingsDB.list()
  const NativeURL = URL
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL() { return 'blob:test-screenshot' }
    static revokeObjectURL() {}
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
})

describe('storage writes on the booking path', () => {
  it('still reaches /book/pay when sessionStorage.setItem throws', async () => {
    open()
    fillDetails()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === sessionStorage) throw quota()
      return original.call(this, key, value)
    })

    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))

    expect(paths).toContain('/book/pay')
    expect(container.textContent).not.toMatch(/Booking rules could not be checked/i)
    expect(container.textContent).not.toMatch(/could not be submitted/i)
  })

  it('still reaches /booking/status when localStorage.setItem throws after the Booking is saved', async () => {
    saveBookingDraft({
      check_in: '2029-06-01', check_out: '2029-06-02', guests: 2, accommodation: 'main-house',
      name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com', special_requests: '',
    })
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === sessionStorage || key === LAST_BOOKING_KEY) throw quota()
      return original.call(this, key, value)
    })

    open('/book/pay')
    await until(() => Boolean(container.querySelector('[type="file"]')))
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.textContent?.includes('Booking submitted')))

    expect(paths).toContain('/booking/status')
    expect(container.textContent).not.toMatch(/could not be submitted/i)
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').not.toMatch(/could not be submitted/i)
  })
})
