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

const REF_LABEL_RE =
  /(?:ref(?:erence)?(?:\s*(?:no\.?|number|#))?|txn|transaction|confirmation|trace|gcash\s*ref)/i
const MONTH_RE = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*$/i
const MERIDIEM_RE = /^(?:a\.?m\.?|p\.?m\.?|midnight|noon)$/i
/** `10:23`, `26/08/2026`, `2026-08-26` — the date and time column of a receipt. */
const DATE_TOKEN_RE = /^\d{1,4}[-/.:]\d{1,4}(?:[-/.:]\d{1,4})?$/

/** 10–13 digits collected so far, or '' while the reference is still too short. */
function settled(digits: string): string {
  return digits.length >= 10 && digits.length <= 13 ? digits : ''
}

/**
 * Add up the digit groups a labelled reference is printed as, carrying onto the
 * next row only while the reference is still being written.
 *
 * GCash prints its reference as `7044 357 122304` across two rows of a
 * two-column receipt, and Tesseract reads the right-hand date column as part of
 * those same rows, so the digits arrive as `Ref No. 7044 357 Aug 26, 2026 10:23`
 * then `122304 AM` — no single run of 10–13 digits anywhere. Step over the
 * month, the day, the year, the time and the meridiem and the groups add up.
 *
 * A row that ends on a real word (`Amount`, `Download`) closes the reference, so
 * the digits further down the receipt are never swallowed into it. Never
 * truncates and never guesses: too few digits, or a card or account number, both
 * return '' so the caller can fall back to the contiguous-run patterns.
 */
function walkGroups(lines: string[], line: number, start: number): string {
  let digits = ''
  let skipNumbers = 0
  for (let i = line; i < Math.min(line + 3, lines.length); i += 1) {
    for (const raw of (i === line ? lines[i].slice(start) : lines[i]).split(/\s+/)) {
      const bare = raw.replace(/[.,;]+$/, '')
      const word = raw.replace(/[^A-Za-z0-9]/g, '')
      if (!word) continue
      if (MONTH_RE.test(bare)) {
        // `Aug 26, 2026` — the month drags the day and the year along with it.
        skipNumbers = 2
        continue
      }
      if (MERIDIEM_RE.test(bare) || DATE_TOKEN_RE.test(bare)) {
        skipNumbers = 0
        continue
      }
      if (!/^\d+$/.test(word)) {
        // A real word closes the reference — `Amount`, `Download`, `Share` —
        // while a short connector like `ID` or `No.` is only part of the label.
        if (word.length >= 3) return settled(digits)
        continue
      }
      if (skipNumbers > 0) {
        skipNumbers -= 1
        continue
      }
      // A single run wider than a reference is a card or account number.
      if (word.length > 13) return ''
      digits += word
      if (digits.length > 13) return ''
    }
    if (digits.length >= 10) return digits
  }
  return settled(digits)
}

function labelledGroups(text: string): string {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const label = REF_LABEL_RE.exec(lines[i])
    if (label?.index === undefined) continue
    const digits = walkGroups(lines, i, label.index + label[0].length)
    if (digits) return digits
  }
  return ''
}

/**
 * Pull the 10–13 digit reference a GCash, Maya or bank transfer receipt carries
 * out of OCR'd text (task: OCR fills the Guest's reference input).
 *
 * A labelled reference wins ("Ref No.", "Txn ID", "GCash ref", "confirmation
 * no." …) — first as digit groups glued back together across the date column a
 * two-column receipt interleaves, then as a run printed with spacing like
 * `1234 567 890123` — and only then does a bare 10–13 digit run count. Anything
 * shorter, longer or absent returns '' for the Guest to type.
 */
export function extractReferenceNumber(text: string): string {
  const grouped = labelledGroups(text)
  if (grouped) return grouped
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

  // A reference split across the rows of a two-column receipt only reads off the
  // text as it was recognised, so the collapse below is not enough for this one.
  let reference = extractReferenceNumber(text)
  if (!reference) {
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
    return extractReceiptFields(await file.text())
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
