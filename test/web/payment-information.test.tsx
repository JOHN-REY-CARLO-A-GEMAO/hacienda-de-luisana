import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PaymentInformationPanel } from '../../src/components/Booking/PaymentInformationPanel'
import { validatePaymentInformation, type PaymentInformation } from '../../src/lib/paymentInfoDB'

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

describe('payment information configuration', () => {
  it('accepts the public fields an Admin may configure', () => {
    expect(validatePaymentInformation(valid)).toEqual([])
  })

  it('accepts and renders both official payment channels', () => {
    const channels: PaymentInformation = {
      active: true,
      methods: [
        { method: 'GCash', recipient_name: 'Agueda H.', account_identifier: '09258507707' },
        { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
      ],
      instructions: 'Submit a screenshot or Gmail confirmation/reference.',
    }
    expect(validatePaymentInformation(channels)).toEqual([])
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<PaymentInformationPanel payment={channels} />))
    expect(host.textContent).toContain('09258507707')
    expect(host.textContent).toContain('005438013682')
    expect(host.textContent).toContain('Gmail confirmation/reference')
    act(() => root.unmount())
  })

  it('rejects missing or unsafe oversized configuration', () => {
    expect(validatePaymentInformation({ ...valid, method: '', instructions: 'x'.repeat(1001) }).map((p) => p.path))
      .toEqual(['method', 'instructions'])
  })

  it('shows configured instructions and the authoritative required amount', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<PaymentInformationPanel payment={valid} requiredAmount={5250} />))
    expect(host.textContent).toContain('GCash')
    expect(host.textContent).toContain('Hacienda de LuisAna')
    expect(host.textContent).toContain('₱5,250')
    expect(host.textContent).toContain('keep the reference')
    act(() => root.unmount())
  })

  it('fails closed to official contact confirmation when configuration is missing', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<PaymentInformationPanel payment={null} requiredAmount={5000} />))
    expect(host.textContent).toContain('Payment account confirmation required')
    expect(host.textContent).toContain('₱5,000')
    act(() => root.unmount())
  })
})
