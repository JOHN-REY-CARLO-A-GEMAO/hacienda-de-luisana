/**
 * Receipt OCR is extraction only — never the source of truth.
 * Admin verification against known references is required.
 */

import { validateAmount, validateReference } from '../validation'

export type OcrExtract = {
  reference: string
  amount: string
  confidence: 'high' | 'low' | 'none'
  notes: string[]
}

const REF_PATTERNS = [
  /(?:ref(?:erence)?(?:\s*(?:no\.?|number|#))?|txn|transaction|gcash\s*ref)[:\s#-]*([A-Z0-9-]{6,40})/i,
  // GCash / Maya / bank transfer references are 10–13 digits; a 16-digit run is
  // a card number, not a reference, and is deliberately not matched.
  /\b([0-9]{10,13})\b/,
]

/**
 * Pull the 10–13 digit reference a GCash, Maya or bank transfer receipt carries
 * out of OCR'd text (task: OCR fills the Guest's reference input).
 *
 * A labelled reference wins ("Ref No.", "Txn ID", "GCash ref", "confirmation
 * no." …) — including runs printed with spacing like `1234 567 890123`, which
 * are collapsed back to bare digits — and only then does a bare 10–13 digit run
 * count. Anything shorter, longer or absent returns '' for the Guest to type.
 */
export function extractReferenceNumber(text: string): string {
  const compact = text.replace(/\s+/g, ' ')
  const labelled = compact.match(
    /(?:ref(?:erence)?|txn|transaction|confirmation|trace|gcash|maya|bank)[^\n]{0,24}?(\d[\d\s-]{8,24}\d)/i,
  )
  if (labelled) {
    const digits = labelled[1].replace(/[\s-]/g, '')
    if (digits.length >= 10 && digits.length <= 13) return digits
  }
  const bare = compact.match(/\b(\d{10,13})\b/)
  return bare?.[1] ?? ''
}

const AMOUNT_PATTERNS = [
  /(?:amount|total|paid|php|₱)\s*[:\-]*\s*([\d,]+(?:\.\d{1,2})?)/i,
  /₱\s*([\d,]+(?:\.\d{1,2})?)/,
]

export function extractReceiptFields(text: string): OcrExtract {
  const notes: string[] = []
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return { reference: '', amount: '', confidence: 'none', notes: ['No text found on the receipt. Enter the details yourself.'] }
  }

  let reference = ''
  for (const re of REF_PATTERNS) {
    const m = compact.match(re)
    if (m?.[1]) {
      const checked = validateReference(m[1])
      if (checked.ok) {
        reference = checked.value
        break
      }
    }
  }
  if (!reference) {
    // A labelled reference printed with spacing (`1234 567 890123`) survives
    // only this collapse-and-check path.
    const digits = extractReferenceNumber(compact)
    if (digits) reference = digits
  }

  let amount = ''
  for (const re of AMOUNT_PATTERNS) {
    const m = compact.match(re)
    if (m?.[1]) {
      const checked = validateAmount(m[1])
      if (checked.ok) {
        amount = checked.value
        break
      }
    }
  }

  if (!reference) notes.push('Could not read a reference number. Please type it from the receipt.')
  if (!amount) notes.push('Could not read an amount. Please type it from the receipt.')

  const confidence: OcrExtract['confidence'] =
    reference && amount ? 'high' : reference || amount ? 'low' : 'none'

  return { reference, amount, confidence, notes }
}

/**
 * Run OCR on the downpayment screenshot, client-side (task: OCR runs in the
 * Guest's browser the moment the screenshot is chosen, before any upload).
 *
 * tesseract.js is imported lazily so bundling, tests and demo pages never pay
 * for the engine — only a Guest picking an image does. Extraction is a hint for
 * the Guest to confirm or correct in the reference input; it never verifies
 * anything (`canAutoVerifyFromOcr` is hard-coded off).
 */
export async function runReceiptOcr(file: File): Promise<OcrExtract> {
  if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
    const text = await file.text()
    return extractReceiptFields(text)
  }
  try {
    const { recognize } = await import('tesseract.js')
    const { data } = await recognize(file, 'eng')
    const text = data?.text ?? ''
    if (text.trim()) return extractReceiptFields(text)
    return {
      reference: '',
      amount: '',
      confidence: 'none',
      notes: ['No text found on the receipt. Enter the details yourself.'],
    }
  } catch (e) {
    console.warn('[OCR] tesseract could not read this image', e)
    return {
      reference: '',
      amount: '',
      confidence: 'none',
      notes: [
        'OCR could not read this image automatically. Enter the reference number and amount from your receipt, then submit for Admin verification.',
      ],
    }
  }
}

export type PaymentMatch = {
  exists: boolean
  amountMatches: boolean
  duplicate: boolean
  status: 'pending' | 'verified' | 'rejected' | 'unknown'
}

export function matchPaymentReference(input: {
  reference: string
  amount: number
  catalog: { reference: string; amount: number; usedBy?: string | null }[]
  alreadyUsedBy?: string | null
}): PaymentMatch {
  const row = input.catalog.find((r) => r.reference.toUpperCase() === input.reference.toUpperCase())
  if (!row) {
    return { exists: false, amountMatches: false, duplicate: false, status: 'unknown' }
  }
  const amountMatches = Math.abs(row.amount - input.amount) < 0.005
  const duplicate = Boolean(row.usedBy && row.usedBy !== input.alreadyUsedBy)
  return {
    exists: true,
    amountMatches,
    duplicate,
    status: duplicate ? 'rejected' : amountMatches ? 'pending' : 'pending',
  }
}

/** OCR never verifies. Admin must match catalog + unused reference. */
export function canAutoVerifyFromOcr(): false {
  return false
}
