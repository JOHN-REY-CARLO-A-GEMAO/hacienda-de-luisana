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
import * as ocr from '../../src/lib/payments/ocr'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

// `runReceiptOcr` is stubbed because the real one loads tesseract.js. The rest of
// the module is spread through from the original so an export added to ocr.ts is
// still there: a closed list here silently breaks every later import of it, which
// is how `amountMismatchNote` went missing and took all 7 of these tests with it.
vi.mock('../../src/lib/payments/ocr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/payments/ocr')>()),
  runReceiptOcr: vi.fn(async () => ({ reference: '', amount: '', amounts: [], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' })),
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement
const checkoutAfter = (checkIn: string) => {
  const date = new Date(`${checkIn}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
const draft = (check_in = '2026-10-31') => ({
  check_in, check_out: checkoutAfter(check_in), guests: 2, accommodation: 'main-house',
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
  fill('[data-tour-field="check-out"]', checkoutAfter(checkIn))
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

beforeEach(() => {
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
  it('retries the selected stay after an unknown response without treating it as available', async () => {
    const check = vi.spyOn(cloudBookingsDB, 'checkAvailability')
      .mockResolvedValueOnce({ available: false, conflicts: [], blockingState: 'unknown' })
      .mockResolvedValue({ available: true, conflicts: [] })
    open()
    fill('[data-tour-field="check-in"]', '2026-11-06')
    fill('[data-tour-field="check-out"]', '2026-11-07')
    await until(() => container.textContent?.includes('Availability is unknown.') ?? false)
    expect(container.querySelector<HTMLButtonElement>('[data-tour="submit-booking"]')?.disabled).toBe(true)
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Retry selected stay'))!
    click(retry)
    await until(() => container.textContent?.includes('Selected stay is available.') ?? false)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('saves incomplete details only when leaving for sign-in, without creating a payment draft', async () => {
    open()
    fill('[data-tour-field="guest-name"]', 'Ana Reyes')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/guest/auth?returnTo=book"]')!
    expect(link).toBeTruthy()
    click(link)
    expect(loadBookingDraft()).toBeNull()
    act(() => root!.unmount())
    root = undefined
    container.remove()
    open()
    expect(input('[data-tour-field="guest-name"]').value).toBe('Ana Reyes')
  })

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
    // The native value stays ISO for the date rule; the visible explanation is
    // intentionally a readable long date for Guests.
    expect(container.textContent).toContain('Pinakamaagang check-in:')
    expect(container.textContent).toContain('October 31, 2026')
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

  it('lets the dual-month picker choose any checkout up to 20 nights, not just the next day', async () => {
    open()
    await until(() => Boolean(container.querySelector('[data-date="2026-10-31"]:not([disabled])')))

    click(container.querySelector('[data-date="2026-10-31"]') as HTMLButtonElement)
    await until(() => input('[data-tour-field="check-in"]').value === '2026-10-31')
    expect(input('[data-tour-field="check-out"]').value).toBe('')
    await until(() => container.textContent!.includes('Now choose a checkout date'))

    // Date-range selection is no longer gated by the one-night pricing rule: a
    // five-night checkout is a normal selectable date.
    expect(container.querySelector('[data-date="2026-11-05"]')?.getAttribute('data-checkout-candidate')).toBe('true')
    // The 20-night boundary is the 20th of November; a 21st night is not offered.
    expect(container.querySelector('[data-date="2026-11-20"]')?.getAttribute('data-checkout-candidate')).toBe('true')
    expect(container.querySelector('[data-date="2026-11-21"]')?.getAttribute('data-checkout-candidate')).toBeNull()

    click(container.querySelector('[data-date="2026-11-05"]') as HTMLButtonElement)
    await until(() => input('[data-tour-field="check-out"]').value === '2026-11-05')
    expect(container.querySelector('[data-date="2026-11-01"]')?.closest('[data-in-range]')).not.toBeNull()
    expect(container.textContent).toContain('5-night range selected.')
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

  it('restores the same stay and guest details when returning from payment', async () => {
    open()
    fillDetails('2026-10-31')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))

    expect(container.querySelectorAll('.flow-steps__step')).toHaveLength(7)
    expect(container.textContent).toContain('Downpayment due now')
    expect(container.textContent).toContain('October 31, 2026')
    expect(container.textContent).toContain('November 1, 2026')

    const back = [...container.querySelectorAll<HTMLAnchorElement>('a')]
      .find((item) => item.textContent?.includes('Back to details'))!
    click(back)
    await until(() => Boolean(container.querySelector('[data-tour-field="guest-name"]')))

    expect(input('[data-tour-field="check-in"]').value).toBe('2026-10-31')
    expect(input('[data-tour-field="check-out"]').value).toBe('2026-11-01')
    expect(input('[data-tour-field="guest-name"]').value).toBe('Ana Reyes')
    expect(input('[autocomplete="tel"]').value).toBe('09171234567')
    expect(input('[type="email"]').value).toBe('ana@example.com')
    expect(container.textContent).toContain('Naibalik ang iyong booking details')
    expect(container.querySelectorAll('.flow-steps__step')).toHaveLength(7)
  })

  it('still submits exactly day 30 through details, proof upload, Pending and status', async () => {
    open()
    fillDetails('2026-10-31')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.textContent?.includes('Booking submitted')))
    expect(container.querySelectorAll('.flow-steps__step')).toHaveLength(7)
    expect(container.querySelector('.flow-steps [aria-current="step"]')?.textContent).toContain('Approval at susunod na hakbang')
    expect(container.textContent).toContain('Susunod na Hakbang')
    const created = bookingsDB.list().find((booking) => booking.guest_name === 'Ana Reyes')
    expect(created).toMatchObject({ check_in: '2026-10-31', check_out: '2026-11-01', status: 'Pending', payment_status: 'pending', amount_claimed: 3000, stay_total: 6000, amount_due: 3000, rate_classification: 'weekend_holiday', policy_version: 'test-v2', policy_effective_date: '2026-10-01', refund_policy_snapshot: null })
    expect(created?.payment_proof_url).toMatch(/^payments\/.+\/HDL-\d+\/proof-1-[0-9a-f-]{36}\.png$/i)
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
  it('warns against sending payment when no published rate is available', async () => {
    saveBookingDraft(draft())
    localStorage.removeItem(LOCAL_RATES_KEY)
    open('/book/pay')
    await until(() => container.textContent?.includes('online submission requires an applicable published rate') ?? false)
    expect(container.textContent).toContain('Dates are not held yet.')
    expect(container.textContent).not.toContain('Kumpirmahin sa Hacienda')
    expect(container.querySelector('.booking-light-surface')).not.toBeNull()
  })

  it('does not overwrite manual entries typed while OCR is running', async () => {
    saveBookingDraft(draft())
    let resolveScan!: (value: Awaited<ReturnType<typeof ocr.runReceiptOcr>>) => void
    vi.mocked(ocr.runReceiptOcr).mockImplementationOnce(() => new Promise((resolve) => { resolveScan = resolve }))
    open('/book/pay')
    Object.defineProperty(input('[type="file"]'), 'files', { configurable: true, value: [new File(['image'], 'proof.png', { type: 'image/png' })] })
    await act(async () => { input('[type="file"]').dispatchEvent(new Event('change', { bubbles: true })) })
    fill('[inputmode="decimal"]', '3100')
    fill('[placeholder="GCash / Maya / bank ref"]', 'MYREF')
    await act(async () => { resolveScan({ reference: 'OCRREF', amount: '9000', amounts: [{ value: '9000', label: 'Amount' }], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' }) })
    expect(input('[inputmode="decimal"]').value).toBe('3100')
    expect(input('[placeholder="GCash / Maya / bank ref"]').value).toBe('MYREF')
  })

  it('reports unknown availability without asserting that another booking holds the dates', async () => {
    saveBookingDraft(draft())
    vi.spyOn(cloudBookingsDB, 'checkAvailability').mockResolvedValue({ available: false, conflicts: [], blockingState: 'unknown' })
    const upload = vi.spyOn(payments, 'uploadPaymentProof')
    open('/book/pay')
    await attachScreenshot()
    submitProof()
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Availability could not be checked')
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain('held by another')
    expect(upload).not.toHaveBeenCalled()
  })

  it('ignores late OCR for removed and replaced screenshots and clears the old reference', async () => {
    saveBookingDraft(draft())
    let resolveFirst!: (value: Awaited<ReturnType<typeof ocr.runReceiptOcr>>) => void
    vi.mocked(ocr.runReceiptOcr).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ reference: 'NEWREF', amount: '', amounts: [], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' })
    open('/book/pay')
    const select = async (name: string) => {
      Object.defineProperty(input('[type="file"]'), 'files', { configurable: true, value: [new File(['image'], name, { type: 'image/png' })] })
      await act(async () => { input('[type="file"]').dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await select('old.png')
    expect(container.textContent).toContain('Reading the screenshot')
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Reading screenshot'))?.disabled).toBe(true)
    await select('new.png')
    expect(input('[placeholder="GCash / Maya / bank ref"]').value).toBe('NEWREF')
    await act(async () => { resolveFirst({ reference: 'OLDREF', amount: '9000', amounts: [{ value: '9000', label: 'Amount' }], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' }) })
    expect(input('[placeholder="GCash / Maya / bank ref"]').value).toBe('NEWREF')
    expect(input('[inputmode="decimal"]').value).not.toBe('9000')
    click([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Remove screenshot'))!)
    expect(input('[placeholder="GCash / Maya / bank ref"]').value).toBe('')
  })

  it('allows manual entry if OCR is slow and ignores the late result', async () => {
    saveBookingDraft(draft())
    let resolveScan!: (value: Awaited<ReturnType<typeof ocr.runReceiptOcr>>) => void
    vi.mocked(ocr.runReceiptOcr).mockImplementationOnce(() => new Promise((resolve) => { resolveScan = resolve }))
    open('/book/pay')
    Object.defineProperty(input('[type="file"]'), 'files', { configurable: true, value: [new File(['image'], 'proof.png', { type: 'image/png' })] })
    await act(async () => { input('[type="file"]').dispatchEvent(new Event('change', { bubbles: true })) })
    click([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('enter details manually'))!)
    fill('[inputmode="decimal"]', '3100')
    await act(async () => { resolveScan({ reference: 'STALE', amount: '9000', amounts: [{ value: '9000', label: 'Amount' }], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' }) })
    expect(input('[inputmode="decimal"]').value).toBe('3100')
    expect(input('[placeholder="GCash / Maya / bank ref"]').value).toBe('')
    expect(container.textContent).toContain('Automatic reading skipped')
  })

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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Those dates are no longer available')
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
