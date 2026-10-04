/**
 * Multi-amount extraction and the mismatch check that protects the booking.
 *
 * The screenshot this exists for is a GCash Express Send receipt whose figures
 * disagree: `Amount 2,500.00` is what the recipient receives, while
 * `Total Amount Sent 1,020.00` is what left the sender. The old extraction took
 * the first number it found and wrote it straight into the Guest's form, so a
 * Guest who paid 1,020 filed a claim of 2,500 and nobody could tell until the
 * Admin opened the image by hand.
 *
 * These are the extracted text as Tesseract returns it, not a retyped fixture.
 */
import { describe, expect, it } from 'vitest'
import {
  amountMismatchNote,
  extractReceiptAmounts,
  extractReceiptFields,
  suggestedAmount,
} from '../../src/lib/payments/ocr'

/** The receipt from the screenshot: two figures that disagree. */
const DISAGREEING = `10:23 AM @ Tl ft.
X Express Send
JD-IN-PH-...-CA-0-G-
+63 905 485 7794
Sent via GCash
Amount: 2,500.00
Total Amount Sent: 1,020.00
Ref No. 7044 357 122304
Download Share`

/** The common case: a fee-free send, so both labels carry the same number. */
const AGREEING = `Amount 1,020.00
Total Amount Sent 1,020.00
Ref No. 7044357122304`

describe('extractReceiptAmounts', () => {
  it('reads both figures off a receipt whose labels disagree', () => {
    expect(extractReceiptAmounts(DISAGREEING)).toEqual([
      { label: 'Total Amount Sent', value: '1020.00' },
      { label: 'Amount', value: '2500.00' },
    ])
  })

  it('keeps one figure when the same number is printed under two labels', () => {
    // A fee-free send prints `Amount` and `Total Amount Sent` with the same value.
    // Offering that Guest a choice would be noise.
    expect(extractReceiptAmounts(AGREEING)).toEqual([
      { label: 'Total Amount Sent', value: '1020.00' },
    ])
  })

  it('reads a bare peso figure printed on its own line', () => {
    expect(extractReceiptAmounts('Money Sent\n₱5,000.00\nTo\nMARIA SANTOS')).toEqual([
      { label: 'Amount', value: '5000.00' },
    ])
  })

  it('does not read the reference as an amount', () => {
    // `7044 357 122304` sits under a reference label, never an amount one.
    expect(extractReceiptAmounts('Amount 1,000.00\nRef No. 7044357122304')).toEqual([
      { label: 'Amount', value: '1000.00' },
    ])
  })

  it('returns nothing when the receipt carries no peso figure at all', () => {
    expect(extractReceiptAmounts('GCash\nRef No. 7044357122304\nSent successfully')).toEqual([])
  })
})

describe('extractReceiptFields with disagreeing figures', () => {
  it('keeps the sender total as the single best guess, not the receiver amount', () => {
    const out = extractReceiptFields(DISAGREEING)
    expect(out.amount).toBe('1020.00')
    expect(out.amounts).toHaveLength(2)
  })

  it('tells the Guest the receipt shows two different amounts', () => {
    const out = extractReceiptFields(DISAGREEING)
    expect(out.notes.join(' ')).toMatch(/2 different amounts/)
    expect(out.notes.join(' ')).toContain('1020.00')
    expect(out.notes.join(' ')).toContain('2500.00')
  })

  it('does not warn about a choice when there is only one amount', () => {
    const out = extractReceiptFields(AGREEING)
    expect(out.notes.join(' ')).not.toMatch(/different amounts/)
    expect(out).toMatchObject({ amount: '1020.00', confidence: 'high' })
  })

  it('keeps the reference readable alongside the amounts', () => {
    expect(extractReceiptFields(DISAGREEING).reference).toBe('7044357122304')
  })
})

describe('suggestedAmount', () => {
  const both = [
    { label: 'Total Amount Sent', value: '1020.00' },
    { label: 'Amount', value: '2500.00' },
  ]

  it('suggests the figure the Guest actually owes', () => {
    expect(suggestedAmount(both, 1020)?.value).toBe('1020.00')
    expect(suggestedAmount(both, 2500)?.value).toBe('2500.00')
  })

  it('suggests the nearest figure when neither matches exactly', () => {
    // A Guest owing 8,500 with only 1,020 and 2,500 on the receipt: neither is
    // right, but 2,500 is nearest, and the UI's mismatch warning does the real
    // work — it tells the Guest the number does not match what is owed.
    expect(suggestedAmount(both, 8500)?.value).toBe('2500.00')
  })

  it('asks when two figures are equally close', () => {
    expect(suggestedAmount([{ label: 'A', value: '1000.00' }, { label: 'B', value: '1020.00' }], 1010)).toBeNull()
  })

  it('asks when there is nothing to choose from', () => {
    expect(suggestedAmount([], 1020)).toBeNull()
    expect(suggestedAmount(both, 0)).toBeNull()
  })
})

describe('the mismatch a Guest is warned about', () => {
  it('says nothing when the claim matches what is owed', () => {
    expect(amountMismatchNote(1020, 1020)).toBeNull()
    // Two-decimal money must not trip the check on floating point alone.
    expect(amountMismatchNote(1019.99, 1020)).not.toBeNull()
    expect(amountMismatchNote(1050, 1050)).toBeNull()
  })

  it('warns when the Guest claims more than is owed', () => {
    const note = amountMismatchNote(2500, 1020)
    expect(note).toContain('2,500.00')
    expect(note).toContain('1,020.00')
  })

  it('warns when the Guest underpaid', () => {
    expect(amountMismatchNote(500, 1020)).toContain('1,020.00')
  })

  it('stays quiet when either side is unknown', () => {
    // A historical Booking with no snapshot has an unknown `owed`, which is a
    // missing quote, not a discrepancy — and must not accuse the Guest of one.
    expect(amountMismatchNote(0, 1020)).toBeNull()
    expect(amountMismatchNote(1020, 0)).toBeNull()
    expect(amountMismatchNote(Number.NaN, 1020)).toBeNull()
    expect(amountMismatchNote(1020, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('is a warning and never a block: it returns text, not a verdict', () => {
    // The Guest may genuinely have sent a different figure. The Admin verifies
    // (ocr.ts) — a form that refused to submit would only push them to phone the
    // Hacienda to say the same thing.
    const note = amountMismatchNote(2500, 1020)
    expect(typeof note).toBe('string')
    expect(note).toContain('Admin will check it against your receipt')
  })
})