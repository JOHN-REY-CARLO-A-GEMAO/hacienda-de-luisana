// -----------------------------------------------------------------------------
// What makes a payment proof acceptable — pure, and the same answer everywhere.
//
// The Guest uploads a screenshot of a GCash / bank transfer receipt and
// the browser reads it with OCR. This module decides whether that read is good
// enough to file:
//
//   1. **A receipt has to have been read.** The reference number, the payment
//      date and time, and the amount must all come off the image. A photo the
//      engine could not read is not a proof the system can check, and the
//      Guest is asked for a clearer screenshot instead of being let through.
//   2. **What the Guest files is what the receipt says.** The reference, the
//      amount and the timestamp on the form are the scan's own values. A claim
//      that disagrees with the image is refused, not warned about.
//   3. **The receipt has to be recent.** Proof older than the Admin's window
//      (default 7 days, `site_config/booking.payment_proof_max_age_days`) is
//      refused. A receipt dated in the future beyond a few minutes of clock
//      skew is refused too.
//   4. **One reference, one payment.** A reference already used by another
//      Booking is a duplicate and the form pops up "Duplicate reference".
//
// The Admin still verifies the money (ADR-0012); nothing here can approve
// anything. These are the checks that stop a proof the Admin should never have
// been shown from being filed at all.
// -----------------------------------------------------------------------------

import type { OcrExtract, ReceiptAmount } from './ocr'

/** How old a receipt may be when the policy document says nothing. */
export const RECEIPT_MAX_AGE_DAYS_DEFAULT = 7

/** The ceiling the Admin's own setting may reach. */
export const RECEIPT_MAX_AGE_DAYS_CEILING = 90

/**
 * How far ahead of this browser's clock a receipt may be dated.
 *
 * A receipt's timestamp is printed by the payment app on the sender's phone, and
 * a phone whose clock runs a minute fast is not fraud. Anything further ahead is
 * a date the receipt does not support.
 */
export const RECEIPT_FUTURE_TOLERANCE_MINUTES = 10

/**
 * The Admin's window, read out of `site_config/booking`.
 *
 * An absent, non-integer or out-of-range setting falls back to the default: a
 * policy document that cannot be read is not a reason to accept a year-old
 * receipt, and it is not a reason to refuse every receipt either.
 */
export function configuredReceiptMaxAgeDays(value: unknown): number {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>).payment_proof_max_age_days : undefined
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return RECEIPT_MAX_AGE_DAYS_DEFAULT
  if (raw < 1 || raw > RECEIPT_MAX_AGE_DAYS_CEILING) return RECEIPT_MAX_AGE_DAYS_DEFAULT
  return raw
}

/**
 * The comparison key of a reference: upper-case, letters and digits only.
 *
 * Bank apps print the same reference as `BDO-1234 5678`, `bdo12345678` and
 * `BDO12345678` depending on where it is copied from. The duplicate check has to
 * see one number, so the key drops every separator and folds case. The reference
 * the Guest sees and the Admin reads keeps its printed spelling.
 */
export function normalizePaymentReference(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The reference as it is filed: trimmed, upper-cased, inner spaces removed. */
export function displayPaymentReference(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase()
}

/** `HH:MM` on a 24-hour clock, or '' when the value is not a time. */
export function normalizeTimeOfDay(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) return ''
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * The instant a receipt states, read on Philippine time.
 *
 * GCash and Philippine banks print the sender's local time, which is
 * Asia/Manila (UTC+08:00, no daylight saving). Reading it as UTC would make every
 * receipt look eight hours older than it is — enough to push one sent late
 * tonight outside a short window.
 */
export function receiptInstant(dateIso: string, time24: string): number | null {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : ''
  const time = normalizeTimeOfDay(time24)
  if (!date || !time) return null
  const parsed = Date.parse(`${date}T${time}:00+08:00`)
  return Number.isFinite(parsed) ? parsed : null
}

/** Whole days between the receipt and now, or `null` when it cannot be read. */
export function receiptAgeDays(dateIso: string, time24: string, now: Date = new Date()): number | null {
  const instant = receiptInstant(dateIso, time24)
  if (instant === null) return null
  return Math.floor((now.getTime() - instant) / 86_400_000)
}

/** The values a scan puts on the form — reference, amount, date and time. */
export type ScannedProof = {
  reference: string
  amount: string
  paymentDate: string
  paymentTime: string
  amounts: ReceiptAmount[]
}

/**
 * Every figure the receipt prints, with the one to pre-fill.
 *
 * A GCash Express Send prints `Amount` (what the recipient receives) and
 * `Total Amount Sent` (what left the sender); they disagree when a fee was
 * charged. `amounts[0]` is the most specific figure — the sender's own total —
 * and the form offers all of them, so a Guest can choose the one they sent.
 */
export function scannedProof(extract: OcrExtract | null): ScannedProof | null {
  if (!extract) return null
  return {
    reference: displayPaymentReference(extract.reference),
    amount: extract.amounts[0]?.value ?? '',
    paymentDate: extract.paymentDateIso ?? '',
    paymentTime: normalizeTimeOfDay(extract.paymentTime24 ?? ''),
    amounts: extract.amounts,
  }
}

/** The claim the Guest is about to file. */
export type ProofClaim = {
  reference: string
  amount: string
  paymentDate: string
  paymentTime: string
}

export type ReceiptProblemCode =
  | 'not-scanned'
  | 'unreadable'
  | 'reference-mismatch'
  | 'amount-mismatch'
  | 'date-mismatch'
  | 'time-mismatch'
  | 'too-old'
  | 'in-future'
  | 'duplicate'

export type ReceiptProblem = {
  code: ReceiptProblemCode
  message: string
}

export type ReceiptVerdict =
  | { ok: true; problems: [] }
  | { ok: false; problems: ReceiptProblem[]; message: string }

const peso = (value: string | number): string =>
  `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Why a scanned receipt cannot be filed, or that it can. */
export function checkScannedReceipt(input: {
  extract: OcrExtract | null
  claim: ProofClaim
  now?: Date
  maxAgeDays?: number
  /** The Booking already carrying this reference, when a duplicate was found. */
  duplicateOf?: string | null
}): ReceiptVerdict {
  const problems: ReceiptProblem[] = []
  const { extract, claim } = input
  const now = input.now ?? new Date()
  const maxAgeDays = input.maxAgeDays ?? RECEIPT_MAX_AGE_DAYS_DEFAULT

  if (!extract) {
    return {
      ok: false,
      problems: [
        {
          code: 'not-scanned',
          message:
            'Upload a clear screenshot of your GCash / bank transfer receipt first. The reference number, date and time, and amount have to be readable.',
        },
      ],
      message:
        'Upload a clear screenshot of your GCash / bank transfer receipt first. The reference number, date and time, and amount have to be readable.',
    }
  }

  const scanned = scannedProof(extract)!
  const unread: string[] = []
  if (!scanned.reference) unread.push('the reference number')
  if (!scanned.amount || scanned.amounts.length === 0) unread.push('the amount')
  if (!scanned.paymentDate) unread.push('the payment date')
  if (!scanned.paymentTime) unread.push('the payment time')
  if (unread.length > 0) {
    const list = unread.length === 1 ? unread[0] : `${unread.slice(0, -1).join(', ')} and ${unread[unread.length - 1]}`
    return {
      ok: false,
      problems: [
        {
          code: 'unreadable',
          message:
            `We could not read ${list} from this receipt. Only a receipt whose reference, date and time, and amount are all readable can be accepted — ` +
            'upload a clearer screenshot (the receipt itself, not a photo of another screen).',
        },
      ],
      message:
        `We could not read ${list} from this receipt. Only a receipt whose reference, date and time, and amount are all readable can be accepted — ` +
        'upload a clearer screenshot (the receipt itself, not a photo of another screen).',
    }
  }

  // 2. The claim has to be the scan's own values.
  const claimReference = normalizePaymentReference(claim.reference)
  const scanReference = normalizePaymentReference(scanned.reference)
  if (claimReference !== scanReference) {
    problems.push({
      code: 'reference-mismatch',
      message:
        `The reference on the form (${claim.reference || 'blank'}) does not match the receipt we scanned (${scanned.reference}). ` +
        'The scanned value is the only one that can be filed — upload the receipt again if it was read wrongly.',
    })
  }

  const claimedAmount = Number(claim.amount)
  const amountMatches =
    Number.isFinite(claimedAmount) &&
    scanned.amounts.some((candidate) => Math.abs(Number(candidate.value) - claimedAmount) < 0.005)
  if (!amountMatches) {
    problems.push({
      code: 'amount-mismatch',
      message:
        `The amount on the form (${claim.amount ? peso(claim.amount) : 'blank'}) is not one of the figures this receipt prints ` +
        `(${scanned.amounts.map((a) => `${peso(a.value)} ${a.label}`).join(', ')}). Choose the amount you actually sent.`,
    })
  }

  const claimDate = claim.paymentDate.trim()
  if (claimDate !== scanned.paymentDate) {
    problems.push({
      code: 'date-mismatch',
      message:
        `The payment date on the form (${claimDate || 'blank'}) does not match the receipt (${scanned.paymentDate}).`,
    })
  }

  const claimTime = normalizeTimeOfDay(claim.paymentTime)
  if (claimTime !== scanned.paymentTime) {
    problems.push({
      code: 'time-mismatch',
      message:
        `The payment time on the form (${claim.paymentTime || 'blank'}) does not match the receipt (${scanned.paymentTime}).`,
    })
  }

  // 3. The receipt has to fall inside the Admin's window.
  const instant = receiptInstant(scanned.paymentDate, scanned.paymentTime)
  if (instant !== null) {
    const ageDays = (now.getTime() - instant) / 86_400_000
    if (ageDays > maxAgeDays) {
      const age = Math.floor(ageDays)
      problems.push({
        code: 'too-old',
        message:
          `This receipt is dated ${scanned.paymentDate} ${scanned.paymentTime} — ${age} ${age === 1 ? 'day' : 'days'} ago. ` +
          `Proof of payment is accepted only within ${maxAgeDays} ${maxAgeDays === 1 ? 'day' : 'days'}; upload a recent receipt.`,
      })
    } else if (ageDays < -RECEIPT_FUTURE_TOLERANCE_MINUTES / 1440) {
      problems.push({
        code: 'in-future',
        message:
          `This receipt is dated ${scanned.paymentDate} ${scanned.paymentTime}, which is in the future. Check the date and time printed on it.`,
      })
    }
  }

  // 4. One reference, one payment.
  if (input.duplicateOf) {
    problems.push({
      code: 'duplicate',
      message:
        `Duplicate reference — ${scanned.reference} is already on another payment record (${input.duplicateOf}). ` +
        'A reference number can only be used once; check that you uploaded the right receipt.',
    })
  }

  if (problems.length === 0) return { ok: true, problems: [] }
  return { ok: false, problems, message: problems[0].message }
}

/** The sentence a duplicate reference raises, on its own. */
export function duplicateReferenceMessage(reference: string, otherBookingId: string): string {
  return (
    `Duplicate reference — ${reference} is already on another payment record (${otherBookingId}). ` +
    'A reference number can only be used once; check that you uploaded the right receipt.'
  )
}
