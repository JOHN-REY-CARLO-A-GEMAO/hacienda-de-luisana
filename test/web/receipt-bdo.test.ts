/**
 * BDO Pay ("Sent!") receipt extraction.
 *
 * The Hacienda's Guests pay from BDO as well as GCash, and BDO Pay prints a
 * different template: a `PHP 3,310.00` headline, a dotted month date
 * (`Oct. 1, 2025 06:25 PM`), the principal under `Send Money Amount`, the fee
 * on its own row (`Service Fee PHP 10.00`), an `Invoice number`, and an
 * alphanumeric reference (`Reference no. BN-20251001-57580325`).
 *
 * Three things about that template used to break the read: the dotted month was
 * not a date the engine knew, the ten-peso fee read as a second payment amount
 * (so the Guest was asked to "choose" between what they sent and the fee), and
 * the principal had no label of its own. The fixtures below are the screenshot's
 * text as Tesseract returns it, in both line orders the engine produces — label
 * and figure on one row, and each on its own row.
 */
import { describe, expect, it } from 'vitest'
import {
  extractPaymentDate,
  extractReceiptAmounts,
  extractReceiptFields,
} from '../../src/lib/payments/ocr'

/** Label and figure on the same row, as a row-wise read returns them. */
const BDO_PAY_ONE_LINE = `X
Sent!
PHP 3,310.00
Oct. 1, 2025 06:25 PM
Send Money Amount PHP 3,310.00
Service Fee PHP 10.00
To JUAN DELA CRUZ
From BDO KABAYAN PESO SAVINGS ACCT ........4929
Invoice number 625868
Reference no. BN-20251001-57580325
Thank you for using
BDO pay
Split bill
Save Image Share Favorite`

/** Each label on its own row with the figure below it, as the screenshot prints. */
const BDO_PAY_SPLIT_LINES = `Sent!
PHP 3,310.00
Oct. 1, 2025 06:25 PM
Send Money Amount
PHP 3,310.00
Service Fee
PHP 10.00
To
JUAN DELA CRUZ
From
BDO KABAYAN PESO SAVINGS ACCT ........4929
Invoice number
625868
Reference no.
BN-20251001-57580325
Thank you for using
BDO pay`

describe('extractReceiptFields on a BDO Pay receipt', () => {
  it.each([
    ['label and figure on one row', BDO_PAY_ONE_LINE],
    ['label and figure on separate rows', BDO_PAY_SPLIT_LINES],
  ])('reads reference, amount, sender, date and time (%s)', (_name, text) => {
    const out = extractReceiptFields(text)
    expect(out.reference).toBe('BN-20251001-57580325')
    expect(out.amount).toBe('3310.00')
    expect(out.amounts).toEqual([{ label: 'Send Money Amount', value: '3310.00' }])
    expect(out.senderName).toBe('BDO KABAYAN PESO SAVINGS')
    expect(out.paymentDate).toBe('Oct. 1, 2025')
    expect(out.paymentDateIso).toBe('2025-10-01')
    expect(out.paymentTime).toBe('06:25 PM')
    expect(out.paymentTime24).toBe('18:25')
    expect(out.confidence).toBe('high')
    expect(out.notes).toEqual([])
  })

  it('never reads the invoice number as the reference or an amount', () => {
    for (const text of [BDO_PAY_ONE_LINE, BDO_PAY_SPLIT_LINES]) {
      const out = extractReceiptFields(text)
      expect(out.reference).not.toContain('625868')
      expect(out.amounts.map((a) => a.value)).not.toContain('625868.00')
    }
  })
})

describe('extractReceiptAmounts on fee rows', () => {
  it('drops a service fee printed on the same row as its figure', () => {
    expect(extractReceiptAmounts('Service Fee PHP 10.00')).toEqual([])
    expect(extractReceiptAmounts('Send Money Amount PHP 3,310.00\nService Fee PHP 10.00')).toEqual([
      { label: 'Send Money Amount', value: '3310.00' },
    ])
  })

  it('drops a service fee whose figure sits on the row below', () => {
    expect(extractReceiptAmounts('Service Fee\nPHP 10.00')).toEqual([])
  })

  it('drops other fee wordings, whatever their case', () => {
    expect(extractReceiptAmounts('Convenience Fee PHP 15.00')).toEqual([])
    expect(extractReceiptAmounts('SERVICE FEE\nPHP 10.00')).toEqual([])
    expect(extractReceiptAmounts('Service Charge PHP 10.00')).toEqual([])
  })

  it('keeps a real amount when a fee word shares its row with an amount label', () => {
    // A two-column read can interleave the next row's words before the figure;
    // the amount label is the receipt saying this figure is money.
    expect(extractReceiptAmounts('Send Money Amount Service Fee PHP 3,310.00')).toEqual([
      { label: 'Send Money Amount', value: '3310.00' },
    ])
  })
})

describe('extractPaymentDate on a dotted month', () => {
  it('reads `Oct. 1, 2025` as BDO Pay prints it', () => {
    expect(extractPaymentDate('Oct. 1, 2025 06:25 PM')).toEqual({
      display: 'Oct. 1, 2025',
      iso: '2025-10-01',
      ambiguous: false,
    })
  })

  it('reads other dotted abbreviations, month-first and day-first', () => {
    expect(extractPaymentDate('Sept. 5, 2025')?.iso).toBe('2025-09-05')
    expect(extractPaymentDate('26 Oct. 2026')?.iso).toBe('2026-10-26')
  })

  it('still reads a month without the dot', () => {
    expect(extractPaymentDate('Oct 1, 2025')?.iso).toBe('2025-10-01')
  })
})
