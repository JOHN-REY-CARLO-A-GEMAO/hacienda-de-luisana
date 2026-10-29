/**
 * What OCR read, said in terms of **where it goes**.
 *
 * `ocr.ts` answers "what is on this receipt?" — a reference, the figures it
 * prints, a sender, a date. That answer is not yet an answer to the Guest's
 * real question, which is "did the app pick these up, and where will they
 * land?". This module is the second half: it names the Booking field each value
 * is written to, the untouched copy kept beside it as evidence, and the Admin
 * screen that reads it back.
 *
 * Two rules it exists to keep:
 *
 * - **Nothing here writes anything.** The rows are a description of the
 *   submission that `PaymentStep` / `DownpaymentPage` performs; a page can
 *   render them for a Guest before a Booking exists at all.
 * - **The evidence copy is never the confirmed value.** A Guest may correct
 *   what OCR misread (`payment_reference`), and the Admin still has to be able
 *   to see what the receipt actually said (`ocr_reference`). A single field
 *   cannot hold both, so the mapping always names the pair.
 */

import type { OcrExtract } from './ocr'

export type ScanFieldKey = 'reference' | 'amount' | 'sender' | 'date'

export type ScanField = {
  key: ScanFieldKey
  /** The field's name as the Guest sees it on the payment form. */
  label: string
  /** What was read off the receipt, printed for reading. */
  value: string
  /** The Booking field the Guest's confirmed value is written to. */
  bookingField: string
  /** The untouched copy of what the receipt said, kept for the Admin. */
  evidenceField: string
  /** The Admin surface that reads it back. */
  adminSurface: string
  /** Something the Guest has to decide about this value, when there is one. */
  note?: string
}

const ADMIN_SURFACE = 'Payment verification queue (Flutter app)'

const peso = (value: string): string =>
  `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The rows a scanner page shows: one per value that was actually read.
 *
 * A field OCR could not read is absent rather than blank — an empty row says
 * "the app found nothing here", which reads as a bug, while a row in the
 * "could not read" list says "type this one yourself", which is the truth.
 */
export function scanFields(extract: OcrExtract): ScanField[] {
  const fields: ScanField[] = []

  if (extract.reference) {
    fields.push({
      key: 'reference',
      label: 'Reference number',
      value: extract.reference,
      bookingField: 'payment_reference',
      evidenceField: 'ocr_reference',
      adminSurface: 'Payment references (payment_references/{reference}_{booking id})',
    })
  }

  if (extract.amounts.length > 0) {
    // Every distinct figure the receipt prints, label first: on a GCash Express
    // Send `Amount` and `Total Amount Sent` disagree whenever a fee was charged,
    // and this page must not flatten that into one number the Guest never chose.
    const value =
      extract.amounts.length === 1
        ? extract.amounts[0].value
        : extract.amounts.map((a) => `${a.value} (${a.label})`).join(' · ')
    fields.push({
      key: 'amount',
      label: 'Amount you sent (₱)',
      value: extract.amounts.length === 1 ? peso(extract.amounts[0].value) : value,
      bookingField: 'amount_claimed',
      evidenceField: 'ocr_amount',
      adminSurface: ADMIN_SURFACE,
      note:
        extract.amounts.length > 1
          ? `This receipt prints ${extract.amounts.length} figures. Pick the one you actually sent — the app will not choose for you.`
          : undefined,
    })
  }

  if (extract.senderName) {
    fields.push({
      key: 'sender',
      label: 'Sender on the receipt',
      value: extract.senderName,
      bookingField: 'payment_sender_name',
      evidenceField: 'ocr_sender_name',
      adminSurface: ADMIN_SURFACE,
    })
  }

  if (extract.paymentDateIso || extract.paymentDate) {
    const iso = extract.paymentDateIso
    fields.push({
      key: 'date',
      label: 'Date on the receipt',
      value: iso ? (iso === extract.paymentDate ? iso : `${iso} (reads "${extract.paymentDate}")`) : extract.paymentDate,
      bookingField: 'payment_date',
      evidenceField: 'ocr_payment_date',
      adminSurface: ADMIN_SURFACE,
      note: iso ? undefined : 'The printed date could not be turned into a calendar date — type it as YYYY-MM-DD.',
    })
  }

  return fields
}

/** The fields this receipt did not give up, named for the Guest to type. */
export function unreadFields(extract: OcrExtract): string[] {
  const missing: string[] = []
  if (!extract.reference) missing.push('Reference number')
  if (extract.amounts.length === 0) missing.push('Amount you sent')
  if (!extract.senderName) missing.push('Sender on the receipt')
  if (!extract.paymentDateIso && !extract.paymentDate) missing.push('Date on the receipt')
  return missing
}

export type ScanVerdict = {
  tone: 'success' | 'warning' | 'info'
  headline: string
  detail: string
}

/**
 * One sentence for the top of the result, honest about what was and was not
 * read. `confidence` from `ocr.ts` drives the tone; nothing here can promote an
 * extraction into a verification, and the detail says so on every tone.
 */
export function scanVerdict(extract: OcrExtract): ScanVerdict {
  const base = 'Nothing here is verified — the Admin still checks the reference and amount against your proof.'
  if (extract.confidence === 'high') {
    return {
      tone: 'success',
      headline: 'Reference and amount read',
      detail: `Check the values below against your receipt, then pay through the booking flow. ${base}`,
    }
  }
  if (extract.confidence === 'low') {
    return {
      tone: 'warning',
      headline: 'Only part of the receipt was read',
      detail: `Some values are missing. Type those from the receipt when you submit your proof. ${base}`,
    }
  }
  return {
    tone: 'info',
    headline: 'Nothing was read off this image',
    detail: 'That is normal for a blurry photo or a template the engine has not seen. Type the values from your receipt when you submit. ' + base,
  }
}

/**
 * The Firestore document id an Admin's verification writes for this reference.
 *
 * Mirrors `_recordPaymentReference` in
 * `lib/views/bookings/payment_verification_queue_screen.dart`: the reference
 * with `/` and whitespace folded to `_`, then the Booking id. Deterministic so
 * two verifications of the same reference can never file a second row, and
 * spelled here so the website can *show* a Guest which row their reference will
 * become without writing it.
 */
export function paymentReferenceDocId(reference: string, bookingId: string): string {
  const safeRef = reference.trim().replace(/[/\s]+/g, '_')
  const safeBooking = bookingId.trim().replace(/[/\s]+/g, '_')
  return `${safeRef}_${safeBooking}`
}
