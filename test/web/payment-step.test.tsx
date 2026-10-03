// PaymentStep as a Guest actually meets it: the plan first, then the proof —
// with the OCR pre-fill, the editable reference and the terms gate in between.
//
// Rendering follows the same pattern as auth-flow.test.tsx: a real DOM root,
// pumped by condition. The Booking is driven through the real lifecycle
// (Submit → Approve → ChoosePaymentPlan) on the local adapter, so what the
// test looks at is what a Guest without Firebase credentials sees.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PaymentStep } from '../../src/components/Booking/PaymentStep'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import type { Booking } from '../../src/lib/storage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom's File predates the ReadableStream-era API; browsers ship `.text()`
// and the OCR path reads the chosen receipt with it.
beforeAll(() => {
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

function renderStep(booking: Booking): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <PaymentStep booking={booking} />
      </MemoryRouter>,
    )
  })
  mounted.push(root)
  return container
}

/** A Booking approved by the Admin, with its payment plan already chosen. */
async function approvedWithPlan(): Promise<Booking> {
  const guest = { actor: 'guest' as const, actor_id: 'guest-ocr', actor_name: 'OCR Guest' }
  const admin = { actor: 'admin' as const, actor_id: 'admin-1', actor_name: 'The Admin' }
  const created = await cloudBookingsDB.add(
    {
      guest_name: 'OCR Guest',
      phone: '0917 000 2222',
      email: 'ocr@example.com',
      guests: 2,
      special_requests: '',
      accommodation: 'main-house',
      check_in: '2029-06-01',
      check_out: '2029-06-03',
      uid: 'guest-ocr',
      payment_status: 'pending',
      payment_proof_url: 'payments/guest-ocr/proof.jpg',
      amount_claimed: 4500,
      amount_due: 4500,
      stay_total: 9000,
    },
    guest,
  )
  // Historical payment step: the Booking was already opened for payment.
  await cloudBookingsDB.update(created.id, {
    status: 'Payment Pending',
    hold_expires_at: null,
    payment_status: 'unpaid',
  })
  await cloudBookingsDB.transition(
    created.id,
    {
      type: 'ChoosePaymentPlan',
      plan: 'down-payment',
      stayTotal: 9000,
      rate: { securityDeposit: 2000, downPaymentPercent: 50 },
    },
    guest,
  )
  const booking = await cloudBookingsDB.get(created.id)
  if (!booking) throw new Error('the seeded Booking vanished')
  return booking
}

const byPlaceholder = (root: HTMLElement, placeholder: string) =>
  root.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)

describe('PaymentStep', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
    document.body.innerHTML = ''
  })

  it('keeps the proof uploader closed until the plan is chosen', async () => {
    const guest = { actor: 'guest' as const, actor_id: 'guest-ocr', actor_name: 'OCR Guest' }
    const admin = { actor: 'admin' as const, actor_id: 'admin-1', actor_name: 'The Admin' }
    const created = await cloudBookingsDB.add(
      {
        guest_name: 'OCR Guest',
        phone: '0917 000 2222',
        email: 'ocr@example.com',
        guests: 2,
        special_requests: '',
        accommodation: 'main-house',
        check_in: '2029-06-01',
        check_out: '2029-06-03',
        uid: 'guest-ocr',
        payment_status: 'pending',
        payment_proof_url: 'payments/guest-ocr/proof.jpg',
        amount_claimed: 4500,
        amount_due: 4500,
        stay_total: 9000,
      },
      guest,
    )
    await cloudBookingsDB.update(created.id, {
      status: 'Payment Pending',
      hold_expires_at: null,
      payment_status: 'unpaid',
      payment_plan: undefined,
      payment_proof_url: undefined,
    })
    const approved = await cloudBookingsDB.get(created.id)
    if (!approved) throw new Error('the seeded Booking vanished')

    const container = renderStep(approved)
    expect(container.textContent).toContain('Choose how to pay')
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toContain('Choose this plan')
  })

  it('refuses a send without a file, then accepts a proof with OCR filling the reference', async () => {
    const booking = await approvedWithPlan()
    expect(booking.payment_plan).toBe('down-payment')
    const container = renderStep(booking)

    // The whole upload section, including the terms gate that used to be
    // unwinnable (no checkbox ever set it).
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const terms = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const reference = byPlaceholder(container, 'e.g. 1234567890123')
    const amount = byPlaceholder(container, 'e.g. 10500')
    const send = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send my proof')
    expect(fileInput).not.toBeNull()
    expect(terms).not.toBeNull()
    expect(reference).not.toBeNull()
    expect(amount).not.toBeNull()
    expect(send).toBeTruthy()

    await act(async () => {
      send!.click()
    })
    await pump(1)
    expect(container.textContent).toContain('Choose a photo or screenshot of your payment receipt first.')

    // Choose the screenshot: a receipt-as-text file exercises the OCR path
    // without a network round-trip (runReceiptOcr's text shortcut).
    // Declared as an image so the proof contract accepts it, named `.txt` so
    // runReceiptOcr takes its no-network text shortcut.
    const receipt = new File(['GCash Ref No: 1234567890123\nAmount 4500.00'], 'receipt.txt', { type: 'image/png' })
    await act(async () => {
      // jsdom has no DataTransfer; the handler only reads `files[0]`.
      Object.defineProperty(fileInput!, 'files', { configurable: true, value: [receipt] })
      fileInput!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await pump(3)
    expect(container.textContent).toContain('receipt.txt chosen.')
    expect(reference!.value).toBe('1234567890123')

    // The OCR result is a hint the Guest confirms: fill the amount, tick the
    // terms, and send — the upload lands in the browser's demo store (ADR-0011).
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(amount!, '4500')
      amount!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      terms!.click()
    })
    await pump(1)
    expect(terms!.checked).toBe(true)

    await act(async () => {
      send!.click()
    })
    await pump(6)
    expect(container.textContent).toContain('Proof sent. The Admin will verify it')

    // What the Booking now carries for the Admin to verify against.
    const stored = await cloudBookingsDB.get(booking.id)
    expect(stored?.payment_status).toBe('pending')
    expect(stored?.payment_proof_url).toMatch(/^payments\//)
    expect(stored?.payment_reference).toBe('1234567890123')
    expect(stored?.extractedRefNumber).toBe('1234567890123')
  })
})
