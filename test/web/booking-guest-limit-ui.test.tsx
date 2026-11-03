// The guest-count input is capped by the selected accommodation's capacity
// (falling back to the platform-wide 100-guest online limit), so a guest can
// never type or step past what the unit sleeps.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from '../../src/pages/BookingPage'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'
import { bookingsDB } from '../../src/lib/storage'

vi.mock('../../src/lib/payments/ocr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/payments/ocr')>()),
  runReceiptOcr: vi.fn(async () => ({ reference: '', amount: '', amounts: [], confidence: 'none', notes: [], senderName: '', paymentDate: '', paymentDateIso: '' })),
}))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement

function open() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(
    <MemoryRouter initialEntries={['/book']}>
      <AuthProvider>
        <Routes>
          <Route path="/book" element={<BookingPage />} />
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
function choose(selector: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(selector)
  if (!select) throw new Error(`Missing select: ${selector}`)
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  act(() => select.dispatchEvent(new Event('change', { bubbles: true })))
}
function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}
function stepper(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Missing stepper: ${label}`)
  return button
}
async function until(test: () => boolean) {
  const deadline = performance.now() + 2000
  while (!test()) {
    if (performance.now() > deadline) throw new Error(`UI did not settle: ${container.textContent}`)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
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
  bookingsDB.list()
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('guest-count limit follows the selected accommodation', () => {
  it('defaults to the 100-guest online cap before a unit is chosen', async () => {
    open()
    await until(() => Boolean(container.querySelector('#guest-count')))
    expect(input('#guest-count').max).toBe('100')
  })

  it('caps the input, the steppers and typed values at the unit capacity (A-House: 3)', async () => {
    open()
    await until(() => Boolean(container.querySelector('select')))
    choose('select', 'house-a-camping')
    await until(() => input('#guest-count').max === '3')
    expect(container.textContent).toContain('Hanggang 3 bisita')

    // Steppers clamp at the capacity: 2 -> 3 -> 3.
    click(stepper('Dagdagan ang bilang ng bisita'))
    expect(input('#guest-count').value).toBe('3')
    click(stepper('Dagdagan ang bilang ng bisita'))
    expect(input('#guest-count').value).toBe('3')

    // Typed values clamp too: typing 19 lands on 3.
    fill('#guest-count', '19')
    expect(input('#guest-count').value).toBe('3')

    // The lower bound stays 1.
    click(stepper('Bawasan ang bilang ng bisita'))
    click(stepper('Bawasan ang bilang ng bisita'))
    click(stepper('Bawasan ang bilang ng bisita'))
    expect(input('#guest-count').value).toBe('1')
  })

  it('clamps an existing count down when a smaller unit is picked', async () => {
    open()
    await until(() => Boolean(container.querySelector('#guest-count')))
    fill('#guest-count', '8')
    expect(input('#guest-count').value).toBe('8')
    choose('select', 'house-a-camping')
    await until(() => input('#guest-count').value === '3')
    expect(input('#guest-count').max).toBe('3')
  })
})
