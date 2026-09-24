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
  /\b([0-9]{10,16})\b/,
]

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

/** Images have no local OCR engine; guests confirm/correct the extracted fields. */
export async function runReceiptOcr(file: File): Promise<OcrExtract> {
  if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
    const text = await file.text()
    return extractReceiptFields(text)
  }
  // Try reading as text in case a screenshot pipeline stored OCR sidecar text.
  try {
    const maybe = await file.text()
    if (maybe && /[A-Za-z0-9]{6,}/.test(maybe) && maybe.length < 20_000) {
      const extracted = extractReceiptFields(maybe)
      if (extracted.confidence !== 'none') return extracted
    }
  } catch {
    /* binary image */
  }
  return {
    reference: '',
    amount: '',
    confidence: 'none',
    notes: [
      'OCR could not read this image automatically. Enter the reference number and amount from your receipt, then submit for Admin verification.',
    ],
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
