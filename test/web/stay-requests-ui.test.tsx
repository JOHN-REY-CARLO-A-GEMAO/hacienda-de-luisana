// The structured add-ons & requests UI on the real BookingPage, with real demo
// persistence and proof uploads — the same harness the lead-time UI test uses.
// It proves: the steppers and chips drive a live peso breakdown, the estimated
// total is untouched by unpriced requests, the conditional "Other" field
// appears, quantities cannot go negative, and a submitted booking stores the
// composed Notes text plus the structured request fields an Admin reviews.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from '../../src/pages/BookingPage'
import { DownpaymentPage } from '../../src/pages/DownpaymentPage'
import { BookingStatusPage } from '../../src/pages/BookingStatusPage'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { loadBookingDraft, saveBookingDraft } from '../../src/lib/bookingDraft'
import { bookingsDB } from '../../src/lib/storage'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

vi.mock('../../src/lib/payments/ocr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/payments/ocr')>()),
  runReceiptOcr: vi.fn(async () => ({ reference: '', amount: '', amounts: [], confidence: 'none', notes: [] })),
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement
const checkoutAfter = (checkIn: string) => {
  const date = new Date(`${checkIn}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

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
function element(selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing element: ${selector}\n${container.textContent}`)
  return found
}
function fill(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!field) throw new Error(`Missing input: ${selector}`)
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value)
  act(() => field.dispatchEvent(new Event('input', { bubbles: true })))
}
function choose(selector: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(selector)
  if (!select) throw new Error(`Missing select: ${selector}`)
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  act(() => select.dispatchEvent(new Event('change', { bubbles: true })))
}
function click(target: HTMLElement) {
  act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}
async function until(test: () => boolean) {
  const deadline = performance.now() + 2000
  while (!test()) {
    if (performance.now() > deadline) throw new Error(`UI did not settle: ${container.textContent}`)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}
function increase(label: string) {
  click(element(`button[aria-label="Increase ${label}"]`))
}
function decrease(label: string) {
  click(element(`button[aria-label="Decrease ${label}"]`))
}
function chip(label: string) {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
  const found = buttons.find((button) => button.textContent?.trim() === label)
  if (!found) throw new Error(`Missing chip: ${label}`)
  return found
}

function fillDetails(checkIn: string) {
  fill('[data-tour-field="check-in"]', checkIn)
  fill('[data-tour-field="check-out"]', checkoutAfter(checkIn))
  fill('[data-tour-field="guest-name"]', 'Ana Reyes')
  fill('[autocomplete="tel"]', '09171234567')
  fill('[type="email"]', 'ana@example.com')
  click(container.querySelector<HTMLInputElement>('[type="checkbox"]')!)
}
async function attachScreenshotAndSubmit() {
  const file = new File(['test screenshot'], 'proof.png', { type: 'image/png' })
  const input = container.querySelector<HTMLInputElement>('[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  fill('[inputmode="decimal"]', '3000')
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Submit booking'))
  if (!button) throw new Error('No proof submit button')
  click(button)
  await until(() => Boolean(container.textContent?.includes('Booking submitted')))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
  // The published document carries NO pet_policy and NO late_checkout_per_hour,
  // exactly like the production Admin app publishes today: every add-on is an
  // Admin-approval request and the quoted total must not move.
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

describe('the add-ons & requests section', () => {
  it('replaces the free-text box with structured controls and starts at zero', () => {
    open()
    expect(container.textContent).toContain('Add-ons & Requests')
    expect(element('button[aria-label="Increase pets"]')).toBeTruthy()
    expect(element('button[aria-label="Increase bonfire wood sets"]')).toBeTruthy()
    expect(container.querySelector('[data-tour-field="special-requests"]')).toBeTruthy()
    expect(container.textContent).toContain('No add-ons selected yet. Estimated additional fees: ₱0.')
    // Quantities can never go below zero: the decrement is disabled at 0.
    expect((element('button[aria-label="Decrease pets"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('updates the breakdown live: 2 pets + 1 wood set + 2 hours = ₱1,250, total untouched', async () => {
    open()
    await until(() => Boolean(container.textContent?.includes('Estimated Total')))
    increase('pets'); increase('pets')
    increase('bonfire wood sets')
    choose('select[aria-label="Late checkout hours"]', '2')
    await until(() => Boolean(container.textContent?.includes('₱1,250')))
    const text = container.textContent!
    expect(text).toContain('Pets (2)')
    expect(text).toContain('₱600')
    expect(text).toContain('Bonfire wood (1 set)')
    expect(text).toContain('₱150')
    expect(text).toContain('Late checkout (+2 hours)')
    expect(text).toContain('₱500')
    expect(text).toContain('Estimated additional fees')
    // Nothing is priced into the stay: the badges on every requested line are
    // approval requests…
    expect(text).toContain('Pending approval')
    // …and the estimated total stays the bare weekend stay (no dates chosen yet,
    // so choose dates and confirm the total is the stay alone).
    fillDetails('2026-10-31')
    await until(() => Boolean(container.textContent?.includes('₱6,000')))
    expect(container.textContent).toContain('₱6,000')
  })

  it('reveals the explanation field only for "Other" and toggles chips off', () => {
    open()
    expect(container.querySelector('input[placeholder^="e.g. 50th birthday"]')).toBeNull()
    click(chip('Other'))
    expect(container.querySelector('input[placeholder^="e.g. 50th birthday"]')).toBeTruthy()
    fill('input[placeholder^="e.g. 50th birthday"]', 'Baptism reception')
    expect(container.querySelector<HTMLInputElement>('input[placeholder^="e.g. 50th birthday"]')!.value)
      .toBe('Baptism reception')
    click(chip('Reunion'))
    expect(container.querySelector('input[placeholder^="e.g. 50th birthday"]')).toBeNull()
    expect((chip('Reunion') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    click(chip('Reunion'))
    expect((chip('Reunion') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
  })

  it('clamps the steppers at the published ceilings', () => {
    open()
    for (let i = 0; i < 12; i++) increase('bonfire wood sets')
    expect((element('button[aria-label="Increase bonfire wood sets"]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toContain('Bonfire wood (10 sets)')
  })
})

describe('submitting structured requests in demo mode', () => {
  it('stores the composed Notes text and the pending request fields, and never invents charges', async () => {
    open()
    fillDetails('2026-10-31')
    increase('pets'); increase('pets')
    increase('bonfire wood sets')
    choose('select[aria-label="Late checkout hours"]', '2')
    click(chip('Other'))
    fill('input[placeholder^="e.g. 50th birthday"]', 'Family reunion lunch')
    fill('[data-tour-field="special-requests"]', 'Arriving around 3 PM.')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))
    // The draft carried every structured value to the payment step.
    expect(loadBookingDraft()).toMatchObject({
      pet_count: 2, bonfire_wood_sets: 1, late_checkout_hours: 2,
      event_purpose: 'other', event_purpose_detail: 'Family reunion lunch',
      special_requests: 'Arriving around 3 PM.',
    })
    // The payment page echoes the requests and their pending status.
    await until(() => Boolean(container.textContent?.includes('Estimated additional fees')))
    expect(container.textContent).toContain('₱1,250')
    await attachScreenshotAndSubmit()

    const created = bookingsDB.list().find((booking) => booking.guest_name === 'Ana Reyes')
    expect(created).toBeTruthy()
    // Money is exactly the published weekend stay: unpriced requests never
    // touch stay_total, the 50/50 split or the claim.
    expect(created).toMatchObject({ stay_total: 6000, amount_due: 3000, balance_due: 3000, amount_claimed: 3000 })
    // Priced keys are absent — nothing was priced — and the request shapes the
    // Admin app already renders are present instead.
    expect(created!.pet_count).toBeUndefined()
    expect(created!.late_checkout_hours).toBeUndefined()
    expect(created!.pet_request).toMatchObject({ count: 2, estimated_fee: 600, status: 'pending' })
    expect(created!.late_checkout_request).toMatchObject({ hours: 2, fee: 500, status: 'pending' })
    expect(created!.bonfire_wood_sets).toBe(1)
    expect(created!.event_purpose).toBe('other')
    expect(created!.event_purpose_detail).toBe('Family reunion lunch')
    // The Admin's Notes view (Flutter reads `special_requests`) sees everything.
    expect(created!.special_requests).toContain('Pets: 2 at ₱300 per pet (estimated fee, pending Admin approval).')
    expect(created!.special_requests).toContain('Bonfire wood: 1 set at ₱150 per set (pending Admin approval')
    expect(created!.special_requests).toContain('Late checkout: +2 hours after 12:00 noon at ₱250 per hour (requested')
    expect(created!.special_requests).toContain('Event / purpose: Other — Family reunion lunch.')
    expect(created!.special_requests).toContain('Notes: Arriving around 3 PM.')
  })

  it('submits unchanged with zero selections and no notes (legacy shape)', async () => {
    open()
    fillDetails('2026-10-31')
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await until(() => Boolean(container.querySelector('[type="file"]')))
    await attachScreenshotAndSubmit()
    const created = bookingsDB.list().find((booking) => booking.guest_name === 'Ana Reyes')
    expect(created).toMatchObject({ stay_total: 6000, special_requests: '' })
    expect(created!.pet_request).toBeUndefined()
    expect(created!.late_checkout_request).toBeUndefined()
    expect(created!.bonfire_wood_sets).toBeUndefined()
    expect(created!.event_purpose).toBeUndefined()
  })

  it('loads a draft saved by the old free-text-only form', async () => {
    // A sessionStorage draft from before the structured fields existed.
    saveBookingDraft({
      check_in: '2026-10-31', check_out: '2026-11-01', guests: 2, accommodation: 'main-house',
      name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com',
      special_requests: 'Bringing 1 small friendly corgi dog.',
    } as never)
    open('/book/pay')
    await until(() => Boolean(container.textContent?.includes('Downpayment due now')))
    expect(loadBookingDraft()).toMatchObject({ pet_count: 0, bonfire_wood_sets: 0, late_checkout_hours: 0 })
    expect(container.textContent).toContain('Ana Reyes')
  })

  it('clamps a hand-edited draft back inside the ceilings on load', async () => {
    sessionStorage.setItem('hdl:booking-draft', JSON.stringify({
      check_in: '2026-10-31', check_out: '2026-11-01', guests: 2, accommodation: 'main-house',
      name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.com',
      special_requests: '', pet_count: 40, late_checkout_hours: 99, bonfire_wood_sets: -3,
      event_purpose: 'invented',
    }))
    open('/book/pay')
    await until(() => Boolean(container.textContent?.includes('Downpayment due now')))
    // The sanitizer clamps on load, so even a forged draft can only ever carry
    // ceiling values into a quote, a fee line or the stored Booking.
    expect(loadBookingDraft()).toMatchObject({
      pet_count: 10, late_checkout_hours: 6, bonfire_wood_sets: 0, event_purpose: '',
    })
    // The clamped requests are echoed as pending approvals, never as charges
    // inside the due-now figure: 50% of the bare ₱6,000 weekend stay.
    expect(container.textContent).toContain('₱3,000')
  })
})
