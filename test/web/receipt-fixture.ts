// -----------------------------------------------------------------------------
// A receipt as the browser's scanner reads it, dated "now" on Philippine time.
//
// The strict receipt rule refuses a proof whose reference, date and time, and
// amount were not read, or whose receipt is older than the Admin's window. A
// test that only needs to get past that gate uses this: a complete read of a
// receipt paid a moment ago.
//
// Built inside the function, not at module load, because several suites move the
// clock with `vi.setSystemTime` and a fixture frozen at import time would be
// days old (or in the future) under a fake clock.
// -----------------------------------------------------------------------------
import type { OcrExtract } from '../../src/lib/payments/ocr'

export function scannedNow(overrides: Partial<OcrExtract> = {}): OcrExtract {
  const manila = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const date = manila.toISOString().slice(0, 10)
  const time = `${String(manila.getUTCHours()).padStart(2, '0')}:${String(manila.getUTCMinutes()).padStart(2, '0')}`
  return {
    reference: '7044357122304',
    amount: '3000',
    amounts: [{ label: 'Total Amount Sent', value: '3000' }],
    senderName: 'Juan Dela Cruz',
    paymentDate: date,
    paymentDateIso: date,
    paymentTime: time,
    paymentTime24: time,
    confidence: 'high',
    notes: [],
    ...overrides,
  }
}
