/**
 * Receipt OCR is extraction only — never the source of truth.
 * Admin verification against known references is required.
 */

import { validateAmount, validateReference } from '../validation'

/**
 * One peso figure a receipt prints, with the label it was printed under.
 *
 * A GCash Express Send receipt can carry two: `Amount 2,500.00` (what the
 * recipient receives) and `Total Amount Sent 1,020.00` (what actually left the
 * sender). They disagree whenever a fee is charged. Taking the first one silently
 * fills the Guest's input with a number the receipt does not say was paid.
 */
export type ReceiptAmount = {
  /** The label as printed, tidied for reading — `Total Amount Sent`, `Amount`. */
  label: string
  /** Two decimal places, validated by `validateAmount`. */
  value: string
}

export type OcrExtract = {
  reference: string
  amount: string
  /** Every distinct figure the receipt prints, in the order it prints them. */
  amounts: ReceiptAmount[]
  /** Sender the receipt names (GCash phone/mybookings name, bank remitter), when OCR can read one. */
  senderName: string
  /** Payment date as printed, e.g. `Aug 26, 2026`. */
  paymentDate: string
  /** Payment date normalized to `YYYY-MM-DD`, or '' when it could not be normalized. */
  paymentDateIso: string
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

/**
 * Labels that introduce the sender on the receipt formats the Hacienda sees.
 * GCash prints the sender as a phone number (`+63 930 485 7798`), bank
 * transfer receipts print a name under `Remitter`, `Account Name`, `Sender` or
 * `From`, and Maya receipts print `From`. The label wins; a bare line that
 * looks like a name is never enough on its own.
 */
const SENDER_LABEL_RE =
  /(?:sender|from|remitter|payer|source\s*account|account\s*name|sender\s*name|sent\s*by)\s*[:#-]*/i

/** Tokens that end a name candidate — money figures, references, dates, labels. */
const NAME_STOP_RE =
  /^(?:ref|reference|txn|transaction|amount|total|paid|date|time|gcash|maya|bank| ₱|php|\d{10,})/i

/** What a sender name may contain: letters, spaces and the punctuation names use. */
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ'.\s-]{2,60}$/

/** A line that carries a number the receipt prints is not a name line. */
const NUMBER_LINE_RE = /\d{4,}/

/**
 * Pull the sender name a receipt prints under a sender label.
 *
 * GCash receipts print the sender as a phone number (`+63 930 485 7798`) right
 * before `Sent via GCash`, so a phone number alone is not enough — a real name
 * label is required. When the label stands alone on its line, the next line is
 * the name; otherwise the rest of the label's own line is. Never guesses: no
 * label and no plausible name returns ''.
 */
export function extractSenderName(text: string): string {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const label = SENDER_LABEL_RE.exec(lines[i])
    if (!label) continue
    let candidate = lines[i].slice(label.index + label[0].length).trim()
    if (!candidate && lines[i + 1]) candidate = lines[i + 1].trim()
    // One label line can carry several fields (`Sender: J. Dela Cruz Ref 123`),
    // so keep words until a label word or a 4+ digit figure shows up, and never
    // more than four words — a receipt name is short.
    const kept: string[] = []
    for (const word of candidate.split(/\s+/)) {
      if (NAME_STOP_RE.test(word) || /^\d{4,}$/.test(word)) break
      kept.push(word)
      if (kept.length >= 4) break
    }
    const cleaned = kept.join(' ').replace(/[.,;:]+$/, '').trim()
    if (NAME_RE.test(cleaned) && !NUMBER_LINE_RE.test(cleaned)) return cleaned
  }
  return ''
}

/** `Aug 26, 2026`, `26/08/2026`, `2026-08-26`, `08/26/2026`, `26-08-2026`. */
const PRINTED_DATE_RE =
  /(?:(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}))|((\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2}))|((\w{3,9})\s+(\d{1,2}),?\s+(\d{4}))/gi

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function monthOf(token: string): number | null {
  const m = MONTH_INDEX[token.toLowerCase().slice(0, 3)]
  return m === undefined ? null : m
}

/**
 * Normalize one printed payment date to `YYYY-MM-DD`.
 *
 * Slash dates are ambiguous (`08/26/2026` is month-first, `26/08/2026` is
 * day-first, and `08/05/2026` could be either). Philippine receipts are read
 * day-first; when both readings fit and disagree, the caller is told the date
 * is ambiguous and should ask rather than file a wrong date.
 */
export function extractPaymentDate(text: string): {
  display: string
  iso: string
  ambiguous: boolean
} | null {
  let best: { display: string; iso: string; ambiguous: boolean } | null = null

  // A fresh global regex each call: `matchAll` leaves `lastIndex` at the end of
  // the string, so reusing one object would return nothing on the second call.
  for (const m of text.matchAll(new RegExp(PRINTED_DATE_RE.source, 'gi'))) {
    const raw = m[0]
    let y: number | null = null
    let mo: number | null = null
    let d: number | null = null
    let ambiguous = false

    if (m[4] !== undefined) {
      // ISO-ish `2026-08-26` — unambiguous.
      y = Number(m[5])
      mo = Number(m[6])
      d = Number(m[7])
    } else if (m[8] !== undefined) {
      // `Aug 26, 2026` — unambiguous. Group 8 is the whole match; 9 is the
      // month name, 10 the day, 11 the year.
      y = Number(m[11])
      mo = monthOf(m[9])
      d = Number(m[10])
      if (mo == null) continue
    } else {
      // `26/08/2026` or `08/26/2026` — both orders fit when each part ≤ 12.
      const a = Number(m[1])
      const b = Number(m[2])
      y = Number(m[3])
      if (a > 12 && b <= 12) {
        d = a
        mo = b
      } else if (b > 12 && a <= 12) {
        d = b
        mo = a
      } else if (a <= 12 && b <= 12) {
        // Ambiguous as printed: read day-first for Philippine receipts, flag it.
        d = a
        mo = b
        ambiguous = true
      } else continue
    }

    if (y == null || mo == null || d == null) continue
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const candidate = { display: raw.trim(), iso, ambiguous }
    if (!best) best = candidate
    // Prefer an unambiguous date over an ambiguous one; otherwise keep the
    // first one printed rather than guessing which matters more.
    else if (!candidate.ambiguous && best.ambiguous) best = candidate
  }

  return best
}

/**
 * Every peso figure a receipt prints, each with its label, deduplicated by value.
 *
 * The labels a real receipt uses, longest first so `Total Amount Sent` is read as
 * itself rather than as a bare `Total` followed by a stray `Amount Sent`:
 * `total amount sent`, `amount sent`, `total amount`, `amount paid`, `total paid`,
 * `total`, `amount`, `paid`, and a bare `₱`/`PHP` for a receipt that prints the
 * figure on its own line.
 *
 * One figure printed under two labels is kept once, under the more specific of the
 * two — `Amount 1,020.00 Total Amount Sent 1,020.00` is one number, not a
 * disagreement, and asking the Guest to choose between them would be noise.
 */
export function extractReceiptAmounts(text: string): ReceiptAmount[] {
  // Line structure is what identifies a label: `Total Amount Sent` is a label
  // because of the words next to its own figure, not because of the words
  // anywhere on the receipt. Collapsing newlines first throws that away and puts
  // the reference number on the same line as an amount label.
  const lines = text.split(/\r?\n/)
  const LABELS: Array<[string, RegExp]> = [
    ['Total Amount Sent', /total\s*amount\s*sent/i],
    ['Amount Sent', /amount\s*sent/i],
    ['Total Amount', /total\s*amount/i],
    ['Amount Paid', /amount\s*paid/i],
    ['Total Paid', /total\s*paid/i],
    ['Total', /total/i],
    ['Amount', /amount/i],
    ['Paid', /paid/i],
  ]

  /** Is this text only what a reference prints between its label and its digits? */
function referenceBetweenIsOneRun(between: string): boolean {
  return between
    .split(/\s+/)
    .filter(Boolean)
    .every(
      (token) =>
        /^[.,:;#\-/]+$/.test(token) || // punctuation between the groups
        /^\d+$/.test(token) || // another group of the reference
        MONTH_RE.test(token) || // the date column a two-column receipt interleaves
        MERIDIEM_RE.test(token) ||
        DATE_TOKEN_RE.test(token),
    )
}

const found: Array<ReceiptAmount & { rank: number }> = []
  // Scanned in receipt order so the figures come back the way a Guest reads them.
  for (const line of lines) {
    // The reference's own digits are not money. A two-column receipt interleaves
    // them with the date (`Ref No. 7044 357 Aug 26, 2026 10:23`), so the figures
    // that belong to the reference are the ones with nothing but a reference's
    // own print between them and its label. A figure behind a *different* word —
    // `Amount: 1500` after `Ref No:` — is a peso figure, and skipping everything
    // after the label threw it away.
    const refMatch = REF_LABEL_RE.exec(line)
    const refLabelEnd = refMatch ? refMatch.index + refMatch[0].length : Infinity

    for (const run of line.matchAll(/(?:₱|\bPHP\b)?\s*([\d][\d,]*(?:\.\d{1,2})?)/gi)) {
      const raw = run[1]
      if (run.index === undefined) continue
      // Only the text before this figure, on this line, can be its label.
      const before = line.slice(0, run.index)
      if (before.length > refLabelEnd && referenceBetweenIsOneRun(before.slice(refLabelEnd))) continue

      let label = ''
      let rank = LABELS.length
      // `LABELS` is ordered most-specific-first, and the patterns overlap —
      // `/total\s*amount/i` also matches `Total Amount Sent`. So the winner is
      // the lowest matching index, which means the loop may not break early.
      for (const [name, re] of LABELS) {
        if (re.test(before)) {
          const r = LABELS.findIndex(([, candidate]) => candidate === re)
          if (r < rank) {
            label = name
            rank = r
          }
        }
      }
      // A bare ₱ or PHP with no word at all is still an amount worth offering.
      if (!label && /₱|\bPHP\b\s*$/i.test(run[0])) {
        label = 'Amount'
        rank = LABELS.length
      }
      // A figure whose line says nothing about money is a reference, a date, a
      // phone number or a card fragment — not an amount the Guest can send.
      if (!label) continue

      const checked = validateAmount(raw)
      if (!checked.ok) continue

      const existing = found.find((f) => f.value === checked.value)
      if (existing) {
        // Same number, more specific label: `Total Amount Sent` beats `Amount`.
        // Lower index is more specific, so the condition is `existing > new`.
        if (existing.rank > rank) {
          existing.label = label
          existing.rank = rank
        }
        continue
      }
      found.push({ label, value: checked.value, rank })
    }
  }

  return found
    .sort((a, b) => a.rank - b.rank)
    .map(({ label, value }) => ({ label, value }))
}

/**
 * The candidate closest to what is owed, which is the one a Guest means in the
 * overwhelming majority of cases.
 *
 * Ties — and a receipt with nothing to compare against — return `null` so the
 * caller asks rather than guesses. Guessing is the failure this whole path
 * exists to remove.
 */
export function suggestedAmount(amounts: ReceiptAmount[], owed: number): ReceiptAmount | null {
  if (owed <= 0 || amounts.length === 0) return null
  let best: ReceiptAmount | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let tied = false
  for (const candidate of amounts) {
    const distance = Math.abs(Number(candidate.value) - owed)
    if (distance < bestDistance - 0.005) {
      best = candidate
      bestDistance = distance
      tied = false
    } else if (Math.abs(distance - bestDistance) <= 0.005) {
      tied = true
    }
  }
  return tied ? null : best
}

export function extractReceiptFields(text: string): OcrExtract {
  const notes: string[] = []
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return {
      reference: '',
      amount: '',
      amounts: [],
      senderName: '',
      paymentDate: '',
      paymentDateIso: '',
      confidence: 'none',
      notes: ['No text found on the receipt. Enter the details yourself.'],
    }
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

  // The original text, not `compact`: amount labels are recognised by the words
  // on their own line, so collapsing newlines first is what put the reference
  // number under an amount label.
  const amounts = extractReceiptAmounts(text)
  // The single best guess stays for callers that only want one number, and it is
  // the most specific figure on the receipt — which is the sender's own total in
  // preference to the receiver's `Amount`.
  const amount = amounts[0]?.value ?? ''

  const sender = extractSenderName(text)
  const paidDate = extractPaymentDate(text)

  if (!reference) notes.push('Could not read a reference number. Please type it from the receipt.')
  if (!amount) notes.push('Could not read an amount. Please type it from the receipt.')
  // Two different figures is a question, not a detail: the receipt is describing
  // two different numbers and the Guest has to say which one they sent.
  if (amounts.length > 1) {
    notes.push(
      `This receipt shows ${amounts.length} different amounts (${amounts
        .map((a) => `${a.label} ${a.value}`)
        .join(', ')}). Choose the one you actually sent.`,
    )
  }
  if (paidDate && paidDate.ambiguous) {
    notes.push(
      `The receipt date reads "${paidDate.display}" and could be more than one calendar date. Confirm it before sending.`,
    )
  }

  const confidence: OcrExtract['confidence'] =
    reference && amount ? 'high' : reference || amount ? 'low' : 'none'

  return {
    reference,
    amount,
    amounts,
    senderName: sender,
    paymentDate: paidDate?.display ?? '',
    paymentDateIso: paidDate?.iso ?? '',
    confidence,
    notes,
  }
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
      amounts: [],
      senderName: '',
      paymentDate: '',
      paymentDateIso: '',
      confidence: 'none',
      notes: ['No text found on the receipt. Enter the details yourself.'],
    }
  } catch (e) {
    console.warn('[OCR] tesseract could not read this image', e)
    return {
      reference: '',
      amount: '',
      amounts: [],
      senderName: '',
      paymentDate: '',
      paymentDateIso: '',
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

/**
 * What a page does with a claim below the due-now figure.
 *
 * The two places a Guest types a claim treat an underpayment differently, so a
 * sentence written for one is a lie on the other:
 *
 * - `blocks_submit` — `/book/pay`. A new Booking is not submitted with less than
 *   the published down payment (`DownpaymentPage.submit`), so no Admin ever sees
 *   the claim and no page may promise that one will.
 * - `reaches_admin` — `/mybookings`, re-sending a proof for a Booking the Admin
 *   already has. There is no gate there (`PaymentStep.submit`), so the claim
 *   does reach a person and the Admin's reading of the receipt is the next step.
 *
 * Overpaying lands in the same place on both: the claim clears the threshold and
 * the Admin checks it against the screenshot.
 */
export type UnderpayHandling = 'blocks_submit' | 'reaches_admin'

const peso2 = (n: number): string =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Is a claim short of the due-now figure by more than half a centavo? */
function underpaid(claimed: number, owed: number): boolean {
  return owed - claimed >= 0.005
}

/**
 * Whether the amount a Guest is claiming is one of the figures their own
 * screenshot prints.
 *
 * The claim is the Guest's statement about their money, and the screenshot is
 * the only evidence for it. When OCR reads a figure the Guest then claims a
 * different one, the two disagree and nothing else in the system can tell which
 * is true — so the page stops and says so, rather than filing a claim the Admin
 * has to disprove by hand.
 *
 * It is a check, never a wall. OCR is a hint engine (`canAutoVerifyFromOcr` is
 * hard-coded off, and ADR-0012 leaves the Admin the decision): a blurry photo, a
 * GCash/Maya/bank template the engine has not seen, or a plain OCR artifact all
 * read figures that are not there. So a screenshot with no readable figure at
 * all validates nothing — there is nothing to compare against — and the caller
 * offers the Guest a way to say, deliberately, that the receipt says something
 * else.
 *
 * `owed` decides the closing sentence only. What the Admin reads off a
 * screenshot is a promise about a path that exists, so it is made when the claim
 * clears the threshold — or when no threshold is published and the claim will
 * therefore be submitted at all — and withheld when an underpayment will stop it
 * before any Admin is involved.
 */
export function claimAgainstReceipt(
  claimed: string,
  amounts: ReceiptAmount[],
  owed?: number,
): { ok: true } | { ok: false; message: string } {
  if (amounts.length === 0) return { ok: true }
  // `validateAmount` owns the shape of this field — an empty, malformed or
  // out-of-range claim is its error to report, and reporting it twice here
  // would only put two complaints about one typo on the page.
  const parsed = validateAmount(claimed)
  if (!parsed.ok) return { ok: true }
  const value = Number(parsed.value)
  if (amounts.some((candidate) => Math.abs(Number(candidate.value) - value) < 0.005)) return { ok: true }
  const shown = amounts.map((a) => `${peso2(Number(a.value))} (${a.label})`).join(', ')
  // An unknown `owed` is a missing quote, not a clearance — but it is also not a
  // gate, so the claim reaches a person either way.
  const reachesAdmin = owed === undefined || !Number.isFinite(owed) || owed <= 0 || !underpaid(value, owed)
  return {
    ok: false,
    message:
      `You entered ${peso2(value)} but your screenshot shows ${shown}. ` +
      (reachesAdmin
        ? 'Use one of those figures, or say so below and the Admin will read it off your screenshot.'
        : 'Use one of those figures, or say so below. This amount is also below the down payment this Booking asks for, so it cannot be submitted until it is corrected.'),
  }
}

/**
 * The sentence a Guest sees when the amount they entered is not the amount this
 * Booking asks for.
 *
 * Under `/mybookings` it is a warning and nothing more: a Guest who genuinely sent
 * a different figure is allowed to say so, the Admin's verification is what
 * moves money, and a blocked form would only push them into contacting the
 * Hacienda by phone to say exactly this.
 *
 * Under `/book/pay` a claim below the due-now figure is refused before anything
 * is uploaded, so the same sentence there would promise an Admin review that
 * cannot happen. `underpay` says which of the two the page is, and the two
 * sentences differ exactly where that difference is visible to the Guest.
 *
 * Either side being unknown reads as `null`: an unknown owed amount is this
 * historical Booking's missing snapshot, not a discrepancy.
 */
export function amountMismatchNote(
  claimed: number,
  owed: number,
  { underpay = 'reaches_admin' }: { underpay?: UnderpayHandling } = {},
): string | null {
  if (!Number.isFinite(claimed) || !Number.isFinite(owed)) return null
  if (claimed <= 0 || owed <= 0) return null
  if (Math.abs(claimed - owed) < 0.005) return null
  if (underpay === 'blocks_submit' && underpaid(claimed, owed)) {
    return (
      `Your claim of ${peso2(claimed)} is below the ${peso2(owed)} down payment this Booking asks for, ` +
      'so the booking cannot be submitted with this amount. Please correct it, or contact the Hacienda ' +
      'if you have already sent the full downpayment.'
    )
  }
  return (
    `You entered ${peso2(claimed)} but this Booking asks for ${peso2(owed)}. ` +
    'If that is what you sent, the Admin will check it against your receipt — otherwise please correct the amount.'
  )
}

/** OCR never verifies. Admin must match catalog + unused reference. */
export function canAutoVerifyFromOcr(): false {
  return false
}
