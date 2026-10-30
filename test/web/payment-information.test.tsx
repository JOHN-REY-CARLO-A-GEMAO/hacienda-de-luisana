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
import {
  OFFICIAL_BDO_QR_IMAGE,
  OFFICIAL_GCASH_QR_IMAGE,
  OFFICIAL_PAYMENT_INFORMATION,
} from '../../src/config/officialBusiness'

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

  it('accepts GCash and BDO channels that carry only their official QR codes', () => {
    const qrOnly: PaymentInformation = {
      active: true,
      methods: [
        {
          method: 'GCash',
          recipient_name: 'Agueda H.',
          qr_image: OFFICIAL_GCASH_QR_IMAGE,
          qr_instructions: 'Scan this QR code using GCash to pay your downpayment.',
        },
        {
          method: 'BDO',
          recipient_name: 'Agueda Hortillas (Aida)',
          qr_image: OFFICIAL_BDO_QR_IMAGE,
          qr_instructions: 'Scan this QR code using BDO to pay your downpayment.',
        },
      ],
      instructions: 'Submit a screenshot or Gmail confirmation/reference.',
    }
    expect(validatePaymentInformation(qrOnly)).toEqual([])
    expect(validatePaymentInformation(OFFICIAL_PAYMENT_INFORMATION)).toEqual([])
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

  it('renders both official GCash and BDO QR codes with their transfer-fee notes', () => {
    const host = render(OFFICIAL_PAYMENT_INFORMATION)
    const images = [...host.querySelectorAll('img')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/images/payment/gcash-qr.png',
      '/images/payment/bdo-qr.png',
    ])
    expect(images[0]?.getAttribute('alt')).toContain('GCash QR code')
    expect(images[1]?.getAttribute('alt')).toContain('BDO QR code')
    // Dense codes: below ~180 CSS px a scanner stops reading them, so each image
    // keeps its native size as the layout's upper bound.
    for (const image of images) {
      expect(Number(image.getAttribute('width'))).toBeGreaterThanOrEqual(240)
    }
    expect(host.textContent).toContain('Scan this QR code using GCash to pay your downpayment.')
    expect(host.textContent).toContain('Scan this QR code using BDO to pay your downpayment.')
    expect(host.textContent).toContain('Transfer fees may apply.')
    expect(host.textContent).toContain('BDO to BDO transfers are free. Fees may apply for non-BDO transfers.')
    expect(host.textContent).not.toContain('09258507707')
    expect(host.textContent).not.toContain('005438013682')
  })

  it('does not give GCash instructions for another payment method', () => {
    const host = render({ active: true, methods: [{ method: 'Maya', recipient_name: 'Hacienda', qr_image: '/qr.png' }], instructions: 'Keep the receipt.' })
    expect(host.textContent).toContain('Use a compatible payment app')
    expect(host.textContent).not.toContain('In GCash, tap Scan QR')
  })

  it('fills in the official QR codes for an older published document that names GCash and BDO', () => {
    // What `site_config/payment` looked like before the owner supplied QR
    // codes: GCash and BDO with account numbers and no images.
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
    expect(merged.methods?.[1].qr_image).toBe(OFFICIAL_BDO_QR_IMAGE)
    // The stored numbers are not destroyed; the panel simply stops printing them.
    expect(legacy.methods?.[0].account_identifier).toBe('09258507707')
    expect(legacy.methods?.[1].account_identifier).toBe('005438013682')

    const host = render(merged)
    expect(host.textContent).not.toContain('09258507707')
    expect(host.textContent).not.toContain('005438013682')
    expect([...host.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      OFFICIAL_GCASH_QR_IMAGE,
      OFFICIAL_BDO_QR_IMAGE,
    ])
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

  it('ships the owner’s actual GCash and BDO QR images, in both apps, rather than stand-ins', () => {
    // A PNG named *-qr.png proves nothing on its own, which is why the
    // payloads were decoded off the owner's posters before they were committed
    // (see public/images/payment/README.md). What a test can hold on to is that
    // the exact files are present at the paths the config publishes, and that
    // the Flutter bundle carries the identical bytes.
    const assets = [
      { file: 'gcash-qr.png', width: 281, height: 281 },
      { file: 'bdo-qr.png', width: 470, height: 470 },
    ]
    for (const { file, width, height } of assets) {
      const web = join(process.cwd(), 'public', 'images', 'payment', file)
      expect(existsSync(web), `${web} is missing`).toBe(true)
      const bytes = readFileSync(web)
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
      expect(bytes.readUInt32BE(16)).toBe(width)
      expect(bytes.readUInt32BE(20)).toBe(height)

      const flutter = join(process.cwd(), 'assets', 'images', 'payment', file)
      expect(existsSync(flutter), `${flutter} is missing`).toBe(true)
      expect(readFileSync(flutter).equals(bytes)).toBe(true)
    }
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
