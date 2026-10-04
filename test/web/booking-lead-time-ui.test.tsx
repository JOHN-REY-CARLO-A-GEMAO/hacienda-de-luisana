// Render the existing pages, with real demo persistence and proof uploads.
// Only OCR (a convenience, not payment verification) is stubbed.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from '../../src/pages/BookingPage'
import { DownpaymentPage } from '../../src/pages/DownpaymentPage'
import { BookingStatusPage } from '../../src/pages/BookingStatusPage'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { saveBookingDraft, loadBookingDraft } from '../../src/lib/bookingDraft'
import { bookingPolicyDB } from '../../src/lib/bookingPolicyDB'
import { minimumBookingLeadTimeMessage } from '../../src/lib/booking'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { bookingsDB } from '../../src/lib/storage'
import * as payments from '../../src/lib/payments'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

vi.mock('../../src/lib/payments/ocr', () => ({ runReceiptOcr: vi.fn(async () => ({ reference: '', amount: '' })) }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement
const draft = (check_in = '2026-10-31') => ({
  check_in, check_out: '2026-11-02', guests: 2, accommodation: 'main-house',
  name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com', special_requests: '',
})

function open(path = '/book') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
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
  const deadline = performance.now() + 2000
  while (!test()) {
    if (performance.now() > deadline) throw new Error(`UI did not settle: ${container.textContent}`)
    // Keep asynchronous file reads, navigation and availability updates inside
    // act throughout the wait, like the existing tutorial's pump helper.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}
function fillDetails(checkIn: string) {
  fill('[data-tour-field="check-in"]', checkIn)
  fill('[data-tour-field="check-out"]', '2026-11-02')
  fill('[data-tour-field="guest-name"]', 'Ana Reyes')
  fill('[autocomplete="tel"]', '09171234567')
  fill('[type="email"]', 'ana@example.com')
  click(input('[type="checkbox"]'))
}
async function attachScreenshot() {
  const file = new File(['test screenshot'], 'proof.png', { type: 'image/png' })
  Object.defineProperty(input('[type="file"]'), 'files', { configurable: true, value: [file] })
  await act(async () => input('[type="file"]').dispatchEvent(new Event('change', { bubbles: true })))
  fill('[inputmode="decimal"]', '5000')
}
function submitProof() {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Submit booking'))
  if (!button) throw new Error('No proof submit button')
  click(button)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
  localStorage.setItem(LOCAL_RATES_KEY, JSON.stringify({
    version: 'test-v1', effective_date: '2026-10-01',
    accommodations: {
      'main-house': { property_name: 'The Main House', rate_unit: 'night', active: true, nightly_rate: 5000, security_deposit: 0, down_payment_percent: 50 },
    },
  }))
  resetRateLimit('booking:create')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T04:00:00Z'))
  // Reading demo availability legitimately initializes sample bookings. Keep
  // that baseline distinct from a booking created by the submission under test.
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
  vi.useRealTimers()
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
})

describe('the existing booking date picker', () => {
  it('disables the first 30 dates and allows exactly day 30 using the native date minimum', () => {
    open()
    const checkIn = input('[data-tour-field="check-in"]')
    expect(checkIn.min).toBe('2026-10-31')
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-08', '2026-10-30']) {
      checkIn.value = date
      expect(checkIn.validity.rangeUnderflow).toBe(true)
    }
    checkIn.value = '2026-10-31'
    expect(checkIn.validity.valid).toBe(true)
    expect(container.textContent).toContain('Book at least 30 days before check-in.')
    expect(container.textContent).toContain('Earliest check-in: 2026-10-31 (Philippine time).')
  })

  it('uses the same configurable policy as creation', () => {
    vi.spyOn(bookingPolicyDB, 'subscribe').mockImplementation((callback) => { callback(45); return () => {} })
    open()
    expect(input('[data-tour-field="check-in"]').min).toBe('2026-11-15')
    expect(container.textContent).toContain('Book at least 45 days')
  })

  it('refreshes a suspended form on focus after Manila midnight', () => {
    vi.setSystemTime(new Date('2026-10-01T15:59:59Z'))
    open()
    expect(input('[data-tour-field="check-in"]').min).toBe('2026-10-31')
    vi.setSystemTime(new Date('2026-10-01T16:00:00Z'))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(input('[data-tour-field="check-in"]').min).toBe('2026-11-01')
  })

  it('shows the clear validation message if a disabled date is manually injected', async () => {
    open()
    fillDetails('2026-10-30')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.textContent?.includes(minimumBookingLeadTimeMessage())))
    expect(loadBookingDraft()).toBeNull()
    expect(bookingsDB.list().some((booking) => booking.guest_name === 'Ana Reyes')).toBe(false)
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
  })

  it('still submits exactly day 30 through details, proof upload, Pending and status', async () => {
    open()
    fillDetails('2026-10-31')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.textContent?.includes('Booking submitted')))
    const created = bookingsDB.list().find((booking) => booking.guest_name === 'Ana Reyes')
    expect(created).toMatchObject({ check_in: '2026-10-31', status: 'Pending', payment_status: 'pending', amount_claimed: 5000 })
    expect(created?.payment_proof_url).toMatch(/^payments\/.+\/HDL-\d+\/proof-1.png$/)
    expect(localStorage.getItem('hdl:payment-proofs')).not.toBeNull()
    expect(loadBookingDraft()).toBeNull()
  })
})

describe('payment-page draft manipulation cannot skip the guard', () => {
  it.each(['2026-10-08', '2026-10-30'])('refuses tampered check-in %s before availability or upload', async (date) => {
    saveBookingDraft(draft(date))
    const before = localStorage.getItem('hdl:bookings')
    const upload = vi.spyOn(payments, 'uploadPaymentProof')
    const availability = vi.spyOn(cloudBookingsDB, 'checkAvailability')
    open('/book/pay')
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(minimumBookingLeadTimeMessage())
    expect(upload).not.toHaveBeenCalled()
    expect(availability).not.toHaveBeenCalled()
    expect(localStorage.getItem('hdl:bookings')).toBe(before)
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
    expect(localStorage.getItem('hdl:activity')).toBeNull()
  })

  it('rechecks a once-valid draft that aged past the boundary overnight', async () => {
    saveBookingDraft(draft())
    open('/book/pay')
    await attachScreenshot()
    vi.setSystemTime(new Date('2026-10-01T16:00:00Z'))
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(minimumBookingLeadTimeMessage())
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
    expect(bookingsDB.list().some((booking) => booking.guest_name === 'Ana Reyes')).toBe(false)
  })
})


describe('new date policy preserves the existing validation gates', () => {
  it('does not bypass guest details validation for an otherwise valid date', async () => {
    open()
    fillDetails('2026-10-31')
    fill('[autocomplete="tel"]', '0917ABC4567')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('Mobile number cannot contain letters')
    expect(loadBookingDraft()).toBeNull()
  })
  it('still checks availability separately and refuses a conflict before upload', async () => {
    saveBookingDraft(draft())
    vi.spyOn(cloudBookingsDB, 'checkAvailability').mockResolvedValue({ available: false, conflicts: [] })
    const upload = vi.spyOn(payments, 'uploadPaymentProof')
    open('/book/pay')
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Those dates were just held by another booking')
    expect(upload).not.toHaveBeenCalled()
    expect(bookingsDB.list().some((booking) => booking.guest_name === 'Ana Reyes')).toBe(false)
  })
  it('still refuses an invalid claimed payment amount for a lead-time-valid draft', async () => {
    saveBookingDraft(draft())
    open('/book/pay')
    await attachScreenshot()
    fill('[inputmode="decimal"]', '0')
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Amount must be at least')
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
  })
  it('checks again if availability/auth completes after Manila midnight, before proof upload', async () => {
    vi.setSystemTime(new Date('2026-10-01T15:59:59Z'))
    saveBookingDraft(draft())
    vi.spyOn(cloudBookingsDB, 'checkAvailability').mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-10-01T16:00:00Z'))
      return { available: true, conflicts: [] }
    })
    const upload = vi.spyOn(payments, 'uploadPaymentProof')
    open('/book/pay')
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(minimumBookingLeadTimeMessage())
    expect(upload).not.toHaveBeenCalled()
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
  })
  it('automatically advances the picker minimum at Manila midnight without a click', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-01T15:59:59Z'))
    open()
    await act(async () => { await Promise.resolve() })
    expect(input('[data-tour-field="check-in"]').min).toBe('2026-10-31')
    act(() => vi.advanceTimersByTime(1000))
    expect(input('[data-tour-field="check-in"]').min).toBe('2026-11-01')
  })
})
