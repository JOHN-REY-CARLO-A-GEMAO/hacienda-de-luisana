// The strict receipt rule, without a browser in the way.
//
// `checkScannedReceipt` is what both payment forms call before they will file a
// proof, so it is the one place the guarantees live: all four values have to be
// read off the receipt, the claim has to be the scan's own values, the receipt
// has to be inside the Admin's window, and one reference pays for one Booking.
import { describe, expect, it } from 'vitest'

import {
  RECEIPT_MAX_AGE_DAYS_DEFAULT,
  checkScannedReceipt,
  configuredReceiptMaxAgeDays,
  displayPaymentReference,
  normalizePaymentReference,
  normalizeTimeOfDay,
  receiptAgeDays,
  receiptInstant,
  scannedProof,
} from '../../src/lib/payments/receipt-rules'
import type { OcrExtract } from '../../src/lib/payments/ocr'

const NOW = new Date('2026-11-07T02:00:00+08:00')

function extract(overrides: Partial<OcrExtract> = {}): OcrExtract {
  return {
    reference: '7044357122304',
    amount: '3000',
    amounts: [{ label: 'Total Amount Sent', value: '3000' }],
    senderName: 'Juan Dela Cruz',
    paymentDate: 'Nov 06, 2026',
    paymentDateIso: '2026-11-06',
    paymentTime: '10:23 AM',
    paymentTime24: '10:23',
    confidence: 'high',
    notes: [],
    ...overrides,
  }
}

function claim(overrides: Partial<{ reference: string; amount: string; paymentDate: string; paymentTime: string }> = {}) {
  return {
    reference: '7044357122304',
    amount: '3000',
    paymentDate: '2026-11-06',
    paymentTime: '10:23',
    ...overrides,
  }
}

/** The refusal message, in a test that has already established the refusal. */
function messageOf(verdict: ReturnType<typeof checkScannedReceipt>): string {
  if (verdict.ok) throw new Error('expected the receipt to be refused')
  return verdict.message
}

describe('reference identity', () => {
  it('folds case and drops separators without losing letters', () => {
    expect(normalizePaymentReference('BDO-1234 5678')).toBe('BDO12345678')
    expect(normalizePaymentReference('bdo12345678')).toBe('BDO12345678')
    expect(normalizePaymentReference('  gcash/ab12-34 ')).toBe('GCASHAB1234')
    // An all-letter reference is unusual but not silently emptied.
    expect(normalizePaymentReference('REFABC')).toBe('REFABC')
  })

  it('keeps the printed spelling for the Guest and the Admin', () => {
    expect(displayPaymentReference('  bdo 1234-5678 ')).toBe('BDO1234-5678')
  })
})

describe('the Admin window', () => {
  it('defaults to seven days when the policy says nothing usable', () => {
    expect(RECEIPT_MAX_AGE_DAYS_DEFAULT).toBe(7)
    expect(configuredReceiptMaxAgeDays(undefined)).toBe(7)
    expect(configuredReceiptMaxAgeDays({})).toBe(7)
    expect(configuredReceiptMaxAgeDays({ payment_proof_max_age_days: 0 })).toBe(7)
    expect(configuredReceiptMaxAgeDays({ payment_proof_max_age_days: 91 })).toBe(7)
    expect(configuredReceiptMaxAgeDays({ payment_proof_max_age_days: 3.5 })).toBe(7)
  })

  it('reads an Admin setting inside the range', () => {
    expect(configuredReceiptMaxAgeDays({ payment_proof_max_age_days: 3 })).toBe(3)
    expect(configuredReceiptMaxAgeDays({ payment_proof_max_age_days: 30 })).toBe(30)
  })
})

describe('Philippine time', () => {
  it('reads a printed date and time as Manila time, not UTC', () => {
    expect(receiptInstant('2026-11-07', '23:30')).toBe(Date.parse('2026-11-07T23:30:00+08:00'))
    // 23:30 in Manila is 15:30 UTC the same day, not 23:30 UTC.
    expect(new Date(receiptInstant('2026-11-07', '23:30')!).toISOString()).toBe('2026-11-07T15:30:00.000Z')
  })

  it('rejects a date or time that is not one', () => {
    expect(receiptInstant('2026-11-31', '10:00')).not.toBeNull()
    expect(receiptInstant('11/07/2026', '10:00')).toBeNull()
    expect(receiptInstant('2026-11-07', '25:00')).toBeNull()
    expect(normalizeTimeOfDay('9:5')).toBe('')
    expect(normalizeTimeOfDay('9:05')).toBe('09:05')
  })

  it('counts whole days since the receipt', () => {
    expect(receiptAgeDays('2026-11-06', '10:23', NOW)).toBe(0)
    expect(receiptAgeDays('2026-10-31', '10:23', NOW)).toBe(6)
  })
})

describe('scannedProof', () => {
  it('takes the reference, the first printed figure, the date and the 24-hour time', () => {
    expect(scannedProof(extract())).toEqual({
      reference: '7044357122304',
      amount: '3000',
      paymentDate: '2026-11-06',
      paymentTime: '10:23',
      amounts: [{ label: 'Total Amount Sent', value: '3000' }],
    })
  })

  it('is null when nothing was scanned', () => {
    expect(scannedProof(null)).toBeNull()
  })
})

describe('checkScannedReceipt', () => {
  it('accepts a complete, recent receipt whose claim is the scan', () => {
    expect(checkScannedReceipt({ extract: extract(), claim: claim(), now: NOW })).toEqual({
      ok: true,
      problems: [],
    })
  })

  it('refuses a proof with no scan at all', () => {
    const verdict = checkScannedReceipt({ extract: null, claim: claim(), now: NOW })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems[0].code).toBe('not-scanned')
  })

  it('names every value that could not be read, and refuses', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ paymentDateIso: '', paymentTime24: '', amount: '', amounts: [] }),
      claim: claim({ paymentDate: '', paymentTime: '', amount: '' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.map((problem) => problem.code)).toEqual(['unreadable'])
    expect(messageOf(verdict)).toContain('the amount')
    expect(messageOf(verdict)).toContain('the payment date')
    expect(messageOf(verdict)).toContain('the payment time')
  })

  it('refuses a claim that is not the scan, field by field', () => {
    const verdict = checkScannedReceipt({
      extract: extract(),
      claim: claim({ reference: '9999999999999', amount: '2000', paymentDate: '2026-11-05', paymentTime: '09:00' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.map((problem) => problem.code)).toEqual([
      'reference-mismatch',
      'amount-mismatch',
      'date-mismatch',
      'time-mismatch',
    ])
  })

  it('accepts a claim spelled differently but the same reference', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ reference: 'BDO-1234 5678' }),
      claim: claim({ reference: 'bdo12345678' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(true)
  })

  it('refuses a receipt older than the Admin window and says how old', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ paymentDateIso: '2026-10-28' }),
      claim: claim({ paymentDate: '2026-10-28' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.map((problem) => problem.code)).toEqual(['too-old'])
    expect(messageOf(verdict)).toContain('9 days ago')
    expect(messageOf(verdict)).toContain('within 7 days')
  })

  it('honours a longer Admin window', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ paymentDateIso: '2026-10-20' }),
      claim: claim({ paymentDate: '2026-10-20' }),
      now: NOW,
      maxAgeDays: 30,
    })
    expect(verdict.ok).toBe(true)
  })

  it('refuses a receipt dated in the future beyond clock skew', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ paymentDateIso: '2026-11-08' }),
      claim: claim({ paymentDate: '2026-11-08' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.map((problem) => problem.code)).toEqual(['in-future'])
  })

  it('tolerates a receipt a few minutes ahead of this browser', () => {
    const verdict = checkScannedReceipt({
      extract: extract({ paymentDateIso: '2026-11-07', paymentTime: '02:05', paymentTime24: '02:05' }),
      claim: claim({ paymentDate: '2026-11-07', paymentTime: '02:05' }),
      now: NOW,
    })
    expect(verdict.ok).toBe(true)
  })

  it('refuses a reference another Booking already carries', () => {
    const verdict = checkScannedReceipt({
      extract: extract(),
      claim: claim(),
      now: NOW,
      duplicateOf: 'HDL-1006',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.map((problem) => problem.code)).toEqual(['duplicate'])
    expect(messageOf(verdict)).toContain('Duplicate reference')
    expect(messageOf(verdict)).toContain('HDL-1006')
  })
})
