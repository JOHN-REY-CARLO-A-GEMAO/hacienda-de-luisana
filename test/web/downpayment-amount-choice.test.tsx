// DownpaymentPage as a Guest meets it: the screenshot, then the claim.
//
// The bug this exists for. A GCash Express Send receipt prints two figures —
// `Amount` (what the recipient receives) and `Total Amount Sent` (what left the
// sender) — and they disagree whenever a fee was charged. The amount field is
// pre-filled from the published `dueNow`, and `submit` refuses only a claim
// *below* `dueNow`, so a pre-filled field agrees with itself: a Guest who sent
// 1,020 against a 2,500 downpayment filed a claim of 2,500 and nothing complained
// until the Admin opened the image by hand.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownpaymentPage } from '../../src/pages/DownpaymentPage'
import { saveBookingDraft, clearBookingDraft } from '../../src/lib/bookingDraft'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom's File predates the ReadableStream-era API; `runReceiptOcr` reads the
// chosen receipt with `.text()`.
// jsdom has no object-URL support; the page makes a preview of the chosen
// screenshot with `URL.createObjectURL`. Nothing under test reads the preview,
// so a stable string is enough for it to render.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:test-preview',
    })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  }
  if (typeof File.prototype.text !== 'function') {
    Object.defineProperty(File.prototype, 'text', {
      configurable: true,
      value(this: File): Promise<string> {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error ?? new Error('read failed'))
          reader.readAsText(this)
        })
      },
    })
  }
})

const PUMP_MS = 10

async function pump(turns = 1) {
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

const mounted: Root[] = []

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

/** A receipt whose two labels carry different numbers, as GCash prints it. */
const DISAGREEING_RECEIPT = `10:23 AM @ Tl ft.
X Express Send
Sent via GCash
Amount: 2,500.00
Total Amount Sent: 1,020.00
Ref No. 7044 357 122304
Download Share`

/** A fee-free send: both labels carry the same number. */
const AGREEING_RECEIPT = `Amount 1,020.00
Total Amount Sent 1,020.00
Ref No. 7044357122304`

async function attachReceipt(container: HTMLElement, text: string) {
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!fileInput) throw new Error('the screenshot uploader is missing')
  const receipt = new File([text], 'receipt.txt', { type: 'image/png' })
  await act(async () => {
    // jsdom has no DataTransfer; the handler only reads `files[0]`.
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [receipt] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await pump(3)
}

const amountInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')

describe('DownpaymentPage and a screenshot that shows two amounts', () => {
  beforeEach(() => {
    localStorage.clear()
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

  it('asks which amount was sent instead of choosing one silently', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, DISAGREEING_RECEIPT)

    // Both figures are offered, each with the label the receipt printed it under.
    expect(container.textContent).toContain('2 different amounts')
    const radios = [...container.querySelectorAll('input[name="screenshot-amount"]')]
    expect(radios).toHaveLength(2)
    expect(container.textContent).toContain('Total Amount Sent')
    expect(container.textContent).toContain('(Amount)')
  })

  it('does not ask when the screenshot agrees with itself', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, AGREEING_RECEIPT)

    // One figure printed twice is one figure, not a question.
    expect(container.textContent).not.toContain('different amounts')
    expect(container.querySelectorAll('input[name="screenshot-amount"]')).toHaveLength(0)
  })

  it('puts the figure the receipt actually says into the claim', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, DISAGREEING_RECEIPT)

    // The Guest picks the figure the receipt says left their account.
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[name="screenshot-amount"]')]
    const senderTotal = radios.find((r) => r.closest('label')?.textContent?.includes('Total Amount Sent'))
    expect(senderTotal).toBeTruthy()
    await act(async () => {
      senderTotal!.click()
    })
    await pump(1)

    // Whatever the Guest chose is now the claim — the receipt's own figure, not
    // whichever number OCR happened to read first.
    expect(amountInput(container)?.value).toBe('1020.00')
  })

  it('does not accuse the Guest of a mismatch when no downpayment is published', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, DISAGREEING_RECEIPT)

    // With no published rate there is no `dueNow` to disagree with, so a mismatch
    // warning here would be inventing a discrepancy the Admin has to disprove.
    expect(container.textContent).not.toMatch(/this Booking asks for/i)
  })

  it('reads a lone figure off the screenshot rather than keeping the pre-fill', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, AGREEING_RECEIPT)

    // One unambiguous number is the Guest's own claim, so it replaces whatever the
    // published rate pre-filled.
    expect(amountInput(container)?.value).toBe('1020.00')
    expect(container.querySelectorAll('input[name="screenshot-amount"]')).toHaveLength(0)
  })

  it('clears the choice when the screenshot is removed', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, DISAGREEING_RECEIPT)
    expect(container.querySelectorAll('input[name="screenshot-amount"]')).toHaveLength(2)

    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Remove screenshot'),
    )
    expect(remove).toBeTruthy()
    await act(async () => {
      remove!.click()
    })
    await pump(1)

    // No stale radios left over a screenshot that is no longer attached.
    expect(container.querySelectorAll('input[name="screenshot-amount"]')).toHaveLength(0)
  })
})

/**
 * The strict receipt rule.
 *
 * A proof is filed only when the screenshot it is filed with actually shows the
 * reference, the date and time, and the amount on the form. The fields are the
 * scan's own and cannot be typed over: a claim the system cannot check against
 * the image is not a proof (ADR-0026).
 */
describe('DownpaymentPage and a receipt that has to carry its own values', () => {
  const PREFILL = '3000'

  beforeEach(() => {
    localStorage.clear()
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

  const receiptFields = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLInputElement>('input[readonly]')]

  it('shows the four scanned fields read-only, and refuses a screenshot with one missing', async () => {
    const container = renderPage()
    await pump(2)
    // No date and no time printed: the receipt cannot be checked against a window.
    await attachReceipt(container, AGREEING_RECEIPT)
    expect(receiptFields(container)).toHaveLength(4)
    for (const field of receiptFields(container)) expect(field.readOnly).toBe(true)
    expect(container.textContent).toContain('could not read')
    expect(container.textContent).toContain('date')
  })

  it('keeps the amount field read-only once the screenshot has been read', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, AGREEING_RECEIPT)
    expect(amountInput(container)?.value).toBe('1020.00')
    expect(amountInput(container)?.readOnly).toBe(true)
    expect(container.textContent).not.toContain('claim-off-receipt')
  })

  it('pops up "Duplicate reference" when the reference is already on another payment', async () => {
    localStorage.setItem('hdl:bookings', JSON.stringify([{
      id: 'bk_existing', ref_id: 'HDL-9001', uid: 'other-guest', guest_name: 'Other Guest',
      status: 'Pending', payment_status: 'pending', payment_reference: '7044357122304',
      check_in: '2029-06-01', check_out: '2029-06-02', guests: 2, accommodation: 'main-house',
      created_at: '2026-10-01T00:00:00.000Z',
    }]))
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, AGREEING_RECEIPT)
    await pump(3)
    const dialog = container.querySelector('[role="alertdialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('Duplicate reference')
    expect(dialog?.textContent).toContain('7044357122304')
  })

  it('clears the scanned values when the screenshot is removed', async () => {
    const container = renderPage()
    await pump(2)
    await attachReceipt(container, AGREEING_RECEIPT)
    expect(amountInput(container)?.value).toBe('1020.00')

    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Remove screenshot'),
    )
    await act(async () => { remove!.click() })
    await pump(1)

    expect(receiptFields(container).map((field) => field.value)).toEqual(['', PREFILL, '', ''])
  })
})
