/**
 * `/receipt-scan` — the reader, on its own.
 *
 * The payment step already runs this engine, so what this page has to prove is
 * narrower: that a Guest can see what was read *and* which field each value
 * lands in, without a Booking, without an upload, and without the page ever
 * implying that a readable receipt is a verified payment.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { ReceiptScanPage } from '../../src/pages/ReceiptScanPage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const GCASH_EXPRESS_SEND = `10:23 AM @ Tl ft.
X Express Send
JO:N R.« CA..O G.
+63 930 485 7798
Sent via GCash
Amount 1,020.00
Total Amount Sent $1,020.00
Ref No. 7044 357 Aug 26, 2026 10:23
122304 AM
(¥) Download of Share`

const mounted: Root[] = []

function renderPage(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <ReceiptScanPage />
      </MemoryRouter>,
    )
  })
  mounted.push(root)
  return container
}

afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

/** Type into a controlled field the way a person does (React reads the DOM value). */
function typeInto(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const buttonSaying = (container: HTMLElement, text: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((button) =>
    (button.textContent ?? '').trim().startsWith(text),
  )
  if (!found) throw new Error(`no button starts with "${text}"`)
  return found
}

async function readPastedReceipt(container: HTMLElement, text: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) throw new Error('the paste box is missing')
  act(() => typeInto(textarea, text))
  await act(async () => {
    buttonSaying(container, 'Read pasted text').click()
  })
}

describe('/receipt-scan', () => {
  it('starts empty and says what it is for', () => {
    const container = renderPage()
    expect(container.textContent).toContain('Nothing read yet')
    // Nothing is verified here, and the page says so before anything is read.
    expect(container.textContent).toContain('canAutoVerifyFromOcr() === false')
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('reads a pasted GCash receipt and shows the reference it found', async () => {
    const container = renderPage()
    await readPastedReceipt(container, GCASH_EXPRESS_SEND)

    expect(container.textContent).toContain('Reference and amount read')
    expect(container.textContent).toContain('7044357122304')
    expect(container.textContent).toContain('₱1,020.00')
    // The reference is offered for copying into the form, not hidden in a table.
    expect(container.textContent).toContain('Copy')
  })

  it('names the Booking field and the evidence field for each value', () => {
    const container = renderPage()
    // The mapping is a promise about the submission, so it is on the page even
    // before a receipt is chosen.
    for (const field of [
      'payment_reference',
      'ocr_reference',
      'amount_claimed',
      'ocr_amount',
      'payment_sender_name',
      'ocr_sender_name',
      'payment_date',
      'ocr_payment_date',
    ]) {
      expect(container.textContent).toContain(field)
    }
  })

  it('asks the Guest to type what could not be read instead of failing quietly', async () => {
    const container = renderPage()
    // A real receipt template the engine has not seen: prose, no figures.
    await readPastedReceipt(container, 'Download Share\nBy going digital you reduce your carbon footprint')

    expect(container.textContent).toContain('Nothing was read off this image')
    expect(container.textContent).toContain('Could not read: Reference number, Amount you sent')
  })

  it('refuses an empty paste without pretending to have read something', () => {
    const container = renderPage()
    act(() => {
      buttonSaying(container, 'Read pasted text').click()
    })
    expect(container.textContent).toContain('Paste the text of your receipt first')
    expect(container.textContent).toContain('Nothing read yet')
  })

  it('never tells a Guest their payment is verified', async () => {
    const container = renderPage()
    await readPastedReceipt(container, GCASH_EXPRESS_SEND)
    const text = container.textContent ?? ''
    expect(text).toMatch(/Nothing here is verified/)
    expect(text).not.toMatch(/payment (was )?verified/i)
  })
})
