import { describe, it } from 'vitest'
import { extractReferenceNumber, extractReceiptFields } from '../../src/lib/payments/ocr'

const CASES: Record<string, string> = {
  // The receipt in the screenshot: ref printed as three spaced groups, 9 digits.
  nineDigitSpaced: `10:23 AM
X
Express Send
JO:NI B.. CA..O G.
+63 310 425 7798
Sent via GCash
Amount 3,000.00
Total Amount Sent P3,000.00
Ref No. 310 425 7798
PAID: SUN, AUG 30, 2026 10:23 AM
279 grams
By going digital, you reduce your carbon footprint from
transportation, paper, and plastic.
Download Share`,
  // Phone number runs together in the OCR text.
  phoneRunTogether: `Express Send
+633104257798
Sent via GCash
Amount 3,000.00
Total Amount Sent P3,000.00
Ref No. 310 425 7798`,
  // Labelled 13-digit ref, the documented happy path.
  thirteen: `GCash
Ref No. 7044 357 122304
Amount 3,000.00`,
}

describe('scratch', () => {
  it('prints', () => {
    for (const [name, text] of Object.entries(CASES)) {
      const out = extractReceiptFields(text)
      console.log(
        `${name.padEnd(20)} ref=${JSON.stringify(out.reference).padEnd(18)} amt=${JSON.stringify(out.amount).padEnd(10)} via=${JSON.stringify(extractReferenceNumber(text))}`,
      )
    }
  })
})