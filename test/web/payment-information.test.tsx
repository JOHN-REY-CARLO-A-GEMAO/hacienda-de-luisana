import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaymentInformationPanel } from '../../src/components/Booking/PaymentInformationPanel'
import {
  validatePaymentInformation,
  withOfficialQrCode,
  type PaymentInformation,
} from '../../src/lib/paymentInfoDB'
import { OFFICIAL_GCASH_QR_IMAGE } from '../../src/config/officialBusiness'

const valid: PaymentInformation = {
  active: true,
  method: 'GCash',
  recipient_name: 'Hacienda de LuisAna',
  account_identifier: '09XX XXX XXXX',
  instructions: 'Send the exact amount and keep the reference.',
  security_deposit_notes: 'Refundable after checkout, subject to damage inspection.',
  notes: 'Do not share your OTP.',
}

afterEach(() => { document.body.innerHTML = '' })

function render(payment: PaymentInformation | null, requiredAmount?: number): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<PaymentInformationPanel payment={payment} requiredAmount={requiredAmount} />))
  // The panel is the only thing rendered; unmounting would hide the DOM the
  // assertions read, so the root is left mounted and the body cleared after.
  return host
}

describe('payment information configuration', () => {
  it('accepts the public fields an Admin may configure', () => {
    expect(validatePaymentInformation(valid)).toEqual([])
  })

  it('accepts a GCash channel that carries only the official QR code', () => {
    const qrOnly: PaymentInformation = {
      active: true,
      methods: [
        {
          method: 'GCash',
          recipient_name: 'Agueda H.',
          qr_image: OFFICIAL_GCASH_QR_IMAGE,
          qr_instructions: 'Scan this QR code using GCash to pay your downpayment.',
        },
        { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
      ],
      instructions: 'Submit a screenshot or Gmail confirmation/reference.',
    }
    expect(validatePaymentInformation(qrOnly)).toEqual([])
  })

  it('refuses a channel with neither an account nor a QR code, and unsafe QR sources', () => {
    expect(validatePaymentInformation({
      active: true,
      methods: [{ method: 'GCash', recipient_name: 'Agueda H.' }],
      instructions: 'Send the down payment.',
    }).map((p) => p.path)).toEqual(['methods[0].account_identifier'])

    const unsafe = [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//evil.example/qr.png',
      `https://example.com/${'x'.repeat(500)}`,
    ]
    for (const qr_image of unsafe) {
      expect(validatePaymentInformation({
        active: true,
        methods: [{ method: 'GCash', recipient_name: 'Agueda H.', qr_image }],
        instructions: 'Send the down payment.',
      }).map((p) => p.path)).toEqual(['methods[0].qr_image'])
    }
  })

  it('renders the official GCash QR code instead of the owner’s mobile number', () => {
    const channels: PaymentInformation = {
      active: true,
      methods: [
        {
          method: 'GCash',
          recipient_name: 'Agueda H.',
          qr_image: OFFICIAL_GCASH_QR_IMAGE,
          qr_instructions: 'Scan this QR code using GCash to pay your downpayment.',
        },
        { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
      ],
      instructions: 'Submit a screenshot or Gmail confirmation/reference.',
    }
    const host = render(channels)
    const image = host.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/images/payment/gcash-qr.png')
    expect(image?.getAttribute('alt')).toContain('GCash QR code')
    // Dense code: below ~180 CSS px a scanner stops reading it, so the image
    // keeps its full native size as the layout's upper bound.
    expect(Number(image?.getAttribute('width'))).toBeGreaterThanOrEqual(240)
    expect(host.textContent).toContain('Scan this QR code using GCash to pay your downpayment.')
    expect(host.textContent).not.toContain('09258507707')
    // The bank channel that has no QR code still shows its account number.
    expect(host.textContent).toContain('005438013682')
    expect(host.textContent).toContain('Gmail confirmation/reference')
  })

  it('fills in the official QR code for an older published document that names GCash', () => {
    // What `site_config/payment` looked like before the owner supplied a QR
    // code: GCash with a mobile number and no image.
    const legacy: PaymentInformation = {
      active: true,
      methods: [
        { method: 'GCash', recipient_name: 'Agueda H.', account_identifier: '09258507707' },
        { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
      ],
      instructions: 'Send the 50% down payment.',
    }
    const merged = withOfficialQrCode(legacy)
    expect(merged.methods?.[0].qr_image).toBe(OFFICIAL_GCASH_QR_IMAGE)
    expect(merged.methods?.[1].qr_image).toBeUndefined()
    // The stored number is not destroyed; the panel simply stops printing it.
    expect(legacy.methods?.[0].account_identifier).toBe('09258507707')

    const host = render(merged)
    expect(host.textContent).not.toContain('09258507707')
    expect(host.querySelector('img')?.getAttribute('src')).toBe(OFFICIAL_GCASH_QR_IMAGE)
  })

  it('keeps a channel’s own QR code rather than replacing it', () => {
    const custom: PaymentInformation = {
      active: true,
      methods: [{ method: 'GCash', recipient_name: 'Agueda H.', qr_image: 'https://example.com/owner-qr.png' }],
      instructions: 'Send the 50% down payment.',
    }
    expect(withOfficialQrCode(custom).methods?.[0].qr_image).toBe('https://example.com/owner-qr.png')
  })

  it('enlarges the QR code on request and closes it again', () => {
    const host = render({
      active: true,
      methods: [{
        method: 'GCash',
        recipient_name: 'Agueda H.',
        qr_image: OFFICIAL_GCASH_QR_IMAGE,
      }],
      instructions: 'Send the 50% down payment.',
    })
    const button = [...host.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Enlarge QR code'))
    expect(button).toBeTruthy()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe(OFFICIAL_GCASH_QR_IMAGE)
    // The enlarged view is where a Guest scans the screen from another phone,
    // so it must offer more than the card's native 281 px.
    expect(dialog?.querySelector('img')?.className).toContain('max-w-[420px]')
    expect(dialog?.textContent).toContain('Scan this QR code using GCash to pay your downpayment.')

    const close = [...dialog!.querySelectorAll('button')]
      .find((b) => b.textContent === 'Close')
    act(() => close!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('names the method when a QR channel publishes no instruction of its own', () => {
    const host = render({
      active: true,
      methods: [{ method: 'GCash', recipient_name: 'Agueda H.', qr_image: OFFICIAL_GCASH_QR_IMAGE }],
      instructions: 'Send the 50% down payment.',
    })
    expect(host.textContent).toContain('Scan this QR code using GCash to pay your downpayment.')
  })

  it('ships the owner’s actual QR image, in both apps, rather than a stand-in', () => {
    // A PNG named gcash-qr.png proves nothing on its own, which is why the
    // payload was decoded off the owner's poster before it was committed (see
    // public/images/payment/README.md). What a test can hold on to is that the
    // exact file is present at the path the config publishes, and that the
    // Flutter bundle carries the identical bytes.
    const web = join(process.cwd(), 'public', 'images', 'payment', 'gcash-qr.png')
    expect(existsSync(web), `${web} is missing`).toBe(true)
    const bytes = readFileSync(web)
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBe(281)
    expect(bytes.readUInt32BE(20)).toBe(281)

    const flutter = join(process.cwd(), 'assets', 'images', 'payment', 'gcash-qr.png')
    expect(existsSync(flutter), `${flutter} is missing`).toBe(true)
    expect(readFileSync(flutter).equals(bytes)).toBe(true)
  })

  it('rejects missing or unsafe oversized configuration', () => {
    expect(validatePaymentInformation({ ...valid, method: '', instructions: 'x'.repeat(1001) }).map((p) => p.path))
      .toEqual(['method', 'instructions'])
  })

  it('shows configured instructions and the authoritative required amount', () => {
    const host = render(valid, 5250)
    expect(host.textContent).toContain('GCash')
    expect(host.textContent).toContain('Hacienda de LuisAna')
    expect(host.textContent).toContain('₱5,250')
    expect(host.textContent).toContain('keep the reference')
    // A channel with no QR code keeps the account field it always had.
    expect(host.textContent).toContain('09XX XXX XXXX')
    expect(host.querySelector('img')).toBeNull()
  })

  it('fails closed to official contact confirmation when configuration is missing', () => {
    const host = render(null, 5000)
    expect(host.textContent).toContain('Payment account confirmation required')
    expect(host.textContent).toContain('₱5,000')
  })
})
