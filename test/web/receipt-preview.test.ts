/**
 * The receipt reader says where a value goes, not only what it says.
 *
 * `ocr.ts` can read a reference off a GCash screenshot; that is only half of
 * what a Guest needs to know before hitting "Send my proof". These tests pin the
 * second half: the Booking field each value is written to, the untouched copy
 * kept as evidence beside it, and the one decision the app refuses to make for
 * the Guest — which of two printed figures they actually sent.
 */
import { describe, expect, it } from 'vitest'

import { extractReceiptFields } from '../../src/lib/payments/ocr'
import {
  paymentReferenceDocId,
  scanFields,
  scanVerdict,
  unreadFields,
} from '../../src/lib/payments/receipt-preview'

/** The real captured GCash "Express Send" receipt the OCR tests already use. */
const GCASH_EXPRESS_SEND = `10:23 AM @ Tl ft.
X Express Send
JO:N R.« CA..O G.
+63 930 485 7798
Sent via GCash
Amount 1,020.00
Total Amount Sent $1,020.00
Ref No. 7044 357 Aug 26, 2026 10:23
122304 AM
By going digital, you reduce your carbon footprint from
transportation, paper, and plastic.
(¥) Download of Share `

describe('scanFields', () => {
  const fields = scanFields(extractReceiptFields(GCASH_EXPRESS_SEND))

  it('names the Booking field and the evidence field for a read reference', () => {
    const reference = fields.find((field) => field.key === 'reference')
    expect(reference).toMatchObject({
      value: '7044357122304',
      bookingField: 'payment_reference',
      evidenceField: 'ocr_reference',
    })
    // The Admin reads it back from the catalogue row a verification files.
    expect(reference?.adminSurface).toContain('payment_references')
  })

  it('gives every value a confirmed field and an untouched copy', () => {
    expect(fields.map((field) => field.bookingField)).toEqual([
      'payment_reference',
      'amount_claimed',
      // The captured receipt prints the sender as a phone number, so no name is
      // read and no sender row is invented — see `unreadFields` below.
      'payment_date',
    ])
    expect(fields.map((field) => field.evidenceField)).toEqual([
      'ocr_reference',
      'ocr_amount',
      'ocr_payment_date',
    ])
    // No row may claim a value without saying where the receipt's own copy goes.
    for (const field of fields) expect(field.evidenceField).not.toBe(field.bookingField)
  })

  it('prints the amount as pesos, the way the payment form asks for it', () => {
    expect(fields.find((field) => field.key === 'amount')?.value).toBe('₱1,020.00')
  })

  it('keeps the printed date as text next to the calendar date it was normalized to', () => {
    const date = fields.find((field) => field.key === 'date')
    expect(date?.value).toBe('2026-08-26 (reads "Aug 26, 2026")')
  })

  it('does not choose between two figures — it names both and asks', () => {
    // A fee-charged Express Send: what the recipient got and what left the
    // sender are different numbers.
    const twoFigures = extractReceiptFields(`Sent via GCash
Amount: 2,500.00
Total Amount Sent: 1,020.00
Ref No. 7044357122304`)
    const amount = scanFields(twoFigures).find((field) => field.key === 'amount')
    expect(amount?.value).toContain('2500.00')
    expect(amount?.value).toContain('1020.00')
    expect(amount?.note).toMatch(/which one|pick the one/i)
  })

  it('shows no row for a value it could not read', () => {
    const blank = scanFields(extractReceiptFields('   '))
    expect(blank).toEqual([])
  })
})

describe('unreadFields', () => {
  it('lists what the Guest still has to type', () => {
    // The captured GCash receipt names its sender as a phone number, which is
    // deliberately not accepted as a name.
    expect(unreadFields(extractReceiptFields(GCASH_EXPRESS_SEND))).toContain('Sender on the receipt')
  })

  it('lists everything when nothing was read', () => {
    expect(unreadFields(extractReceiptFields('   '))).toEqual([
      'Reference number',
      'Amount you sent',
      'Sender on the receipt',
      'Date on the receipt',
    ])
  })

  it('lists nothing for a receipt that gave up all four values', () => {
    const full = extractReceiptFields(`GCash Express Send
From: Juan Dela Cruz
Amount 1,020.00
Ref No. 7044 357 122304
Aug 26, 2026 10:23 AM`)
    expect(unreadFields(full)).toEqual([])
  })
})

describe('scanVerdict', () => {
  it('is confident only when both the reference and an amount were read', () => {
    const verdict = scanVerdict(extractReceiptFields(GCASH_EXPRESS_SEND))
    expect(verdict.tone).toBe('success')
    expect(verdict.headline).toBe('Reference and amount read')
  })

  it('warns when only part of the receipt was read', () => {
    const verdict = scanVerdict(extractReceiptFields('GCash\n₱5,000.00\nRef No. 12345'))
    expect(verdict.tone).toBe('warning')
    expect(verdict.detail).toMatch(/Type those from the receipt/)
  })

  it('never claims a verdict reads as verified', () => {
    for (const text of [GCASH_EXPRESS_SEND, '   ', 'GCash\n₱5,000.00']) {
      expect(scanVerdict(extractReceiptFields(text)).detail).toMatch(/Nothing here is verified/)
    }
  })
})

describe('paymentReferenceDocId', () => {
  // Mirrors `_recordPaymentReference` in
  // `lib/views/bookings/payment_verification_queue_screen.dart`.
  it('keys the catalogue row by reference and Booking id', () => {
    expect(paymentReferenceDocId('7044357122304', 'abc123')).toBe('7044357122304_abc123')
  })

  it('folds the characters Firestore forbids in a document id', () => {
    expect(paymentReferenceDocId('TRX/004455 667788', 'abc 123')).toBe('TRX_004455_667788_abc_123')
  })

  it('never produces a slash, whatever the reference looks like', () => {
    expect(paymentReferenceDocId('a/b/c', '1/2')).not.toContain('/')
  })
})
