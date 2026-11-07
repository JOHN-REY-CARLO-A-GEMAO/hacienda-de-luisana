/**
 * Receipt OCR extraction. The real captured text is a GCash "Express Send"
 * receipt: the 13-digit reference is printed as `7044 357 122304`, and the
 * two-column layout makes Tesseract interleave the right-hand date column
 * between the first and last group, so the digits never appear as one run.
 */
import { describe, expect, it } from 'vitest'
import {
  extractPaymentDate,
  extractReceiptFields,
  extractReferenceNumber,
  extractSenderName,
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

describe('extractSenderName', () => {
  it('reads a sender name under a Sender label', () => {
    expect(extractSenderName('GCash\nSender: Juan Dela Cruz\nAmount 1,000.00')).toBe(
      'Juan Dela Cruz',
    )
  })

  it('reads a bank remitter from the next line when the label stands alone', () => {
    expect(
      extractSenderName('BDO Online Transfer\nRemitter\nMaria Clara Santos\n₱5,000.00'),
    ).toBe('Maria Clara Santos')
  })

  it('reads a From label', () => {
    expect(extractSenderName('MAYA\nFrom: Jose Rizal\nRef No. 1234567890123')).toBe(
      'Jose Rizal',
    )
  })

  it('ignores a bare phone number without a sender label (GCash prints the number)', () => {
    expect(extractSenderName('+63 930 485 7798\nSent via GCash\nAmount 1,020.00')).toBe(
      '',
    )
  })

  it('returns nothing when there is no sender label or plausible name', () => {
    expect(extractSenderName('GCash\nAmount 1,000.00\nRef No. 1234567890123')).toBe('')
    expect(
      extractSenderName('1234567890123\nAug 26, 2026 10:23 AM'),
    ).toBe('')
  })

  it('stops at a figure and keeps the name plausible', () => {
    expect(
      extractSenderName('Sender: Juan Dela Cruz Ref 1234567890123'),
    ).toBe('Juan Dela Cruz')
  })
})

describe('extractPaymentDate', () => {
  it('normalizes an unambiguous month name date', () => {
    const found = extractPaymentDate('Ref No. 7044 357 Aug 26, 2026 10:23')
    expect(found).toEqual({ display: 'Aug 26, 2026', iso: '2026-08-26', ambiguous: false })
  })

  it('normalizes a day-first month name date', () => {
    // The month in the middle, as several bank apps (and some GCash receipt
    // variants) print it — unambiguous, and previously invisible.
    expect(extractPaymentDate('Date 26 Aug 2026')).toEqual({
      display: '26 Aug 2026',
      iso: '2026-08-26',
      ambiguous: false,
    })
    expect(extractPaymentDate('1 November 2026 3:47 PM')?.iso).toBe('2026-11-01')
  })

  it('normalizes an ISO date', () => {
    const found = extractPaymentDate('Date 2026-08-26')
    expect(found).toEqual({ display: '2026-08-26', iso: '2026-08-26', ambiguous: false })
  })

  it('reads day-first slash dates', () => {
    const found = extractPaymentDate('26/08/2026')
    expect(found?.iso).toBe('2026-08-26')
  })

  it('flags ambiguous slash dates but still returns a day-first reading', () => {
    const found = extractPaymentDate('08/05/2026')
    expect(found).toEqual({
      display: '08/05/2026',
      iso: '2026-05-08',
      ambiguous: true,
    })
  })

  it('prefers an unambiguous date over an ambiguous one', () => {
    const found = extractPaymentDate('08/05/2026 Aug 26, 2026')
    expect(found).toEqual({ display: 'Aug 26, 2026', iso: '2026-08-26', ambiguous: false })
  })

  it('returns null when there is no date', () => {
    expect(extractPaymentDate('GCash\nAmount 1,000.00')).toBeNull()
  })

  it('ignores references and amounts that look like numbers', () => {
    expect(extractPaymentDate('Ref No. 1234567890123 Amount 1,000.00')).toBeNull()
  })
})

describe('extractReceiptFields with a tesseract-mangled GCash receipt', () => {
  // The receipt behind the bug: GCash prints each label on its own row with
  // the `₱figure` below it, tesseract has no `₱` and returns `P`, and the date
  // is printed day-first. The reference read fine (it is a digit-group read)
  // while the amount and the date both came back empty, so the Admin app
  // showed "Hindi nabasa" for the two fields the receipt plainly carried.
  const MANGLED = `GCash
Sent to
JOHN REY CARLO G.
09** *** 1234
Amount
P7,500.00
Total Amount Sent
P7,500.00
Ref No.
8159 662 488150
1 November 2026 3:47 PM`

  it('reads reference, amount and date', () => {
    const out = extractReceiptFields(MANGLED)
    expect(out.reference).toBe('8159662488150')
    expect(out.amount).toBe('7500.00')
    expect(out.paymentDateIso).toBe('2026-11-01')
    expect(out.confidence).toBe('high')
  })
})

describe('extractReceiptFields sender and date', () => {
  it('returns sender name and normalized date from a GCash-style receipt', () => {
    const out = extractReceiptFields(
      `GCash Express Send
      From: Juan Dela Cruz
      Amount 1,020.00
      Ref No. 7044 357 122304
      Aug 26, 2026 10:23 AM`,
    )
    expect(out.senderName).toBe('Juan Dela Cruz')
    expect(out.paymentDate).toBe('Aug 26, 2026')
    expect(out.paymentDateIso).toBe('2026-08-26')
    expect(out.reference).toBe('7044357122304')
    expect(out.amount).toBe('1020.00')
  })

  it('keeps confidence none when only the date is readable (reference+amount decide)', () => {
    const out = extractReceiptFields('Aug 26, 2026 10:23 AM')
    expect(out.senderName).toBe('')
    expect(out.paymentDate).toBe('Aug 26, 2026')
    expect(out.confidence).toBe('none')
  })
})
