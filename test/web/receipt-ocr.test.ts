/**
 * Receipt OCR extraction. The real captured text is a GCash "Express Send"
 * receipt: the 13-digit reference is printed as `7044 357 122304`, and the
 * two-column layout makes Tesseract interleave the right-hand date column
 * between the first and last group, so the digits never appear as one run.
 */
import { describe, expect, it } from 'vitest'
import {
  claimAgainstReceipt,
  extractReceiptFields,
  extractReferenceNumber,
} from '../../src/lib/payments/ocr'

const GCASH_EXPRESS_SEND = `10:23 AM @ Tl ft.
X Express Send
JO:N R.« CA..O G.
+63 930 485 7798
Sent via GCash
Amount 1,020.00
Total Amount Sent $1,020.00
Ref No. 7044 357 Aug 26, 2026 10:23
122304 AM
W5 2799 geome
By going digital, you reduce your carbon footprint from
transportation, paper, and plastic.
(¥) Download of Share `

describe('extractReceiptFields', () => {
  it('glues a reference back together when a date column splits it across lines', () => {
    const out = extractReceiptFields(GCASH_EXPRESS_SEND)
    expect(out.reference).toBe('7044357122304')
    expect(out.amount).toBe('1020.00')
    expect(out.notes).toEqual([])
  })

  it('reads the reference off the same text through extractReferenceNumber', () => {
    expect(extractReferenceNumber(GCASH_EXPRESS_SEND)).toBe('7044357122304')
  })

  it('does not absorb a date, a time or a card number into the reference', () => {
    // The date sits after the groups.
    expect(extractReceiptFields('Ref No. 7044 357 122304\nAug 26, 2026 10:23 AM').reference).toBe(
      '7044357122304',
    )
    // The date sits between the label and the groups.
    expect(extractReceiptFields('Ref No.\nAug 26, 2026 10:23\n7044 357 122304').reference).toBe(
      '7044357122304',
    )
    // A 16-digit card number elsewhere on the receipt is never the reference.
    expect(
      extractReceiptFields('Card 1234 5678 9012 3456\nRef No. 7044 357 122304\nAmount 1,020.00')
        .reference,
    ).toBe('7044357122304')
  })
})

describe('extractReferenceNumber', () => {
  const cases: [string, string][] = [
    ['GCash\nRef No. 1234567890123', '1234567890123'],
    ['GCash\nRef No: 1234 5678 9012 3', '1234567890123'],
    ['BDO\nReference No.\n1234567890123', '1234567890123'],
    ['MAYA\nTransaction ID 1234567890123', '1234567890123'],
    ['BDO\nTrace No. 1234567890123', '1234567890123'],
    // No label: a bare 10–13 digit run still counts.
    ['Sent 1234567890123 today', '1234567890123'],
    // A labelled reference always wins over a bare run.
    ['Ref No. 1234567890123 and 9999999999999', '1234567890123'],
  ]

  it.each(cases)('reads %j', (text, expected) => {
    expect(extractReferenceNumber(text)).toBe(expected)
  })

  it('leaves the reference to the Guest when there is nothing 10–13 digits wide', () => {
    expect(extractReferenceNumber('GCash\n₱5,000.00\nRef No. 12345')).toBe('')
    expect(extractReferenceNumber('GCash\n₱5,000.00')).toBe('')
  })

  it('never truncates a longer number into a plausible-looking reference', () => {
    // A 16-digit run is kept whole by the labelled path rather than cut to 13.
    expect(extractReceiptFields('Ref No. 1234567890123456').reference).toBe('1234567890123456')
    // And a 9-digit run stays a non-reference for the Guest to type.
    expect(extractReceiptFields('Ref No. 123456789').reference).toBe('123456789')
  })
})

describe('extractReceiptFields on other receipts', () => {
  it('reads amount and reference off a plain GCash receipt', () => {
    const out = extractReceiptFields(
      'GCash\nMoney Sent\n₱5,000.00\nTo\nMARIA SANTOS\n0917 555 1234\nRef No. 1234567890123',
    )
    expect(out).toMatchObject({ reference: '1234567890123', amount: '5000.00', confidence: 'high' })
  })

  it('says so when it can read neither field', () => {
    const out = extractReceiptFields('   ')
    expect(out).toMatchObject({ reference: '', amount: '', confidence: 'none' })
    expect(out.notes).toEqual(['No text found on the receipt. Enter the details yourself.'])
  })

  it('reports low confidence when only the amount is readable', () => {
    const out = extractReceiptFields('GCash\n₱5,000.00\nRef No. 12345')
    expect(out).toMatchObject({ reference: '', amount: '5000.00', confidence: 'low' })
  })
})

describe('claimAgainstReceipt', () => {
  // The captured receipt above prints one figure — `1,020.00`, under `Amount` and
  // under the more specific `Total Amount Sent` — so this is the real shape a
  // Guest's claim is checked against.
  const receipt = extractReceiptFields(GCASH_EXPRESS_SEND).amounts
  const claim = (raw: string, figures = receipt) => claimAgainstReceipt(raw, figures)

  it('accepts the figure the screenshot prints', () => {
    expect(claim('1020.00')).toEqual({ ok: true })
  })

  it('accepts the same figure however the Guest typed it', () => {
    // A Guest copying off a phone keyboard writes commas, one decimal, or none
    // at all. The figure is the same peso value and must read as the same claim.
    for (const raw of ['1,020', '1020', '1020.0', ' 1020.00 ', '1,020.00']) {
      expect(claim(raw)).toEqual({ ok: true })
    }
  })

  it('refuses a claim the screenshot never printed, and names the figure it did', () => {
    // The bug this exists for: the published downpayment pre-fills the field, a
    // Guest who sent something else files that number anyway, and the only thing
    // that can catch it is the receipt they attached.
    const out = claim('2000')
    expect(out.ok).toBe(false)
    const message = out.ok ? '' : out.message
    expect(message).toContain('₱2,000.00')
    expect(message).toContain('₱1,020.00')
    // Under the label the receipt printed it under, so the Guest knows which of
    // the two figures on the screen is the one being claimed.
    expect(message).toContain('(Total Amount Sent)')
  })

  it('accepts either of two figures a screenshot prints', () => {
    const two = extractReceiptFields('Amount 2,500.00\nTotal Amount Sent 1,020.00').amounts
    expect(claim('2500.00', two)).toEqual({ ok: true })
    expect(claim('1020', two)).toEqual({ ok: true })
    expect(claim('2000', two).ok).toBe(false)
  })

  it('validates nothing when the screenshot printed no figure at all', () => {
    // A photo the engine could not read leaves nothing to compare against.
    // Blocking here would wall off a Guest who paid perfectly well.
    expect(claim('2000', [])).toEqual({ ok: true })
    expect(claimAgainstReceipt('2000', extractReceiptFields('Ref No. 7044 357 122304').amounts)).toEqual({
      ok: true,
    })
  })

  it('leaves a claim that is not a number to the field validator', () => {
    // One typo, one complaint — `validateAmount` says what is wrong with it.
    expect(claim('')).toEqual({ ok: true })
    expect(claim('abc')).toEqual({ ok: true })
    expect(claim('10.999')).toEqual({ ok: true })
  })

  it('promises an Admin reading of the screenshot only when the claim clears the amount owed', () => {
    // The promise is about a path that exists. `/book/pay` refuses a claim below
    // the due-now figure before anything is uploaded, so no Admin is ever involved
    // and the sentence must not say otherwise.
    const above = claimAgainstReceipt('2500', receipt, 2000)
    expect(above.ok).toBe(false)
    expect(above.ok ? '' : above.message).toContain('the Admin will read it off your screenshot')

    const below = claimAgainstReceipt('2000', receipt, 3000)
    expect(below.ok).toBe(false)
    expect(below.ok ? '' : below.message).not.toContain('the Admin will read it')
    expect(below.ok ? '' : below.message).toContain('cannot be submitted')
  })

  it('treats an unknown amount owed as reaching the Admin', () => {
    // No published rate is not a gate — the claim is submitted and a person reads
    // it. Refusing to promise a review there would invent a block that is not there.
    for (const owed of [undefined, Number.NaN, 0]) {
      const out = claimAgainstReceipt('2000', receipt, owed)
      expect(out.ok).toBe(false)
      expect(out.ok ? '' : out.message).toContain('the Admin will read it off your screenshot')
    }
  })
})
