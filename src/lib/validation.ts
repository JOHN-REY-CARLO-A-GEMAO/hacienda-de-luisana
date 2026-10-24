/**
 * Shared field validation. Used by forms and tests.
 *
 * Two families live here and they do different jobs:
 *
 * **Validators** (`validate*`) decide whether a value may be sent. They never
 * silent-truncate and never fix the value up — a refusal says what is wrong in
 * the words a Guest can act on, because the alternative is a form that edits
 * what somebody typed and then blames them for it.
 *
 * **Sanitizers** (`sanitize*`) are input guards, wired to `onChange`, that make
 * a keystroke the field cannot hold (a digit in a name, a letter in a mobile
 * number) never reach the record at all. Every sanitizer's ceiling is the same
 * constant its validator checks, so nothing typed within the limit is lost, and
 * each one is paired with a `maxLength` on the input so the browser stops the
 * Guest at the same line the server would.
 *
 * Both families read the limit from here, never from a copy in the component:
 * the number a Guest sees in a counter, the number that refuses a submit and
 * the number the Cloud Function checks must be one number.
 */
import { bookingBusinessDate, MAX_STAY_NIGHTS, maximumCheckoutDate } from './booking'

export const MIN_GUEST_AGE = 10
export const PH_MOBILE_MAX_DIGITS = 11
/**
 * The longest a phone field holds *as typed*, separators included.
 *
 * `+63 (917) 123 4567` is 19 characters and is a number this system accepts,
 * so the cap is not the digit count — it is room for the separators a Guest
 * pastes in, and no more. `validatePhMobile` is what decides the number is real.
 */
export const PHONE_MAX_INPUT_LENGTH = 20
export const SEARCH_MAX_LENGTH = 80
export const NAME_MIN = 2
export const NAME_MAX = 80
export const EMAIL_MAX = 120
/**
 * An inquiry's subject line.
 *
 * 120 is the figure the Admin's inbox column can show without ellipsis, and 3
 * is the shortest string that is a subject rather than a grunt. The inquiry
 * form's counter prints this constant, so the number on the
 * page and the number in the refusal cannot drift apart.
 */
export const SUBJECT_MIN = 3
export const SUBJECT_MAX_LENGTH = 120
/**
 * A street address, as the Admin records it in a Guest's CRM profile.
 *
 * Deliberately permissive about shape — `#123/B Apt. 4-A, Brgy. San Isidro` is
 * a real Philippine address and no pattern covers it — and deliberately strict
 * about angle brackets, which are never part of an address and are the shape of
 * a tag. The field is a label for a human to read, not markup to render.
 */
export const ADDRESS_MIN = 5
export const ADDRESS_MAX = 200
/**
 * The Guest's free-text notes on a Booking, and the one detail line an event
 * purpose carries with it.
 *
 * 500 and 160 are the sizes of the two boxes on the page, not round numbers: a
 * note that arrives at the Hacienda should be read in one glance on the Admin's
 * phone, and an event detail is a headline (`Golden wedding anniversary`), not a
 * proposal. Both are printed by the counters in `StayRequestsSection`.
 */
export const ADDITIONAL_NOTES_MAX = 500
export const EVENT_DETAIL_MAX = 160
/**
 * The longest a chat message may be, in characters.
 *
 * 1,000 is the storage-conscious figure: a thread is read a page at a time, so
 * every character is paid for on every page read, and a Guest asking about
 * dates has never needed more. The same number is enforced by
 * `firestore.rules` (`conversations/{id}/messages` refuses a longer `text`), so
 * this constant is the courtesy half and the rules are the enforcement.
 */
export const MESSAGE_MAX = 1000
export const REVIEW_MAX = 1000
export const REF_MAX = 40
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
export const ALLOWED_PROOF_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
export const MIN_BOOKING_NIGHTS = 1
/**
 * The same ceiling the calendar picker and the `submitBooking` callable enforce.
 * Read from the booking module rather than restated here: a Guest must not be
 * told 20 by one surface and 30 by another.
 */
export const MAX_BOOKING_NIGHTS = MAX_STAY_NIGHTS

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ' .\-]+$/
/** The same set NAME_RE accepts, inverted, for stripping — see `sanitizeNameInput`. */
const NAME_DISALLOWED_RE = /[^A-Za-zÀ-ÖØ-öø-ÿ' .\-]/g
/** Digits are stripped by `sanitizeNameInput`, so a name can only fail on shape. */
const HAS_DIGIT_RE = /\d/
/** What a phone field may hold while it is being typed: digits and separators. */
const PHONE_DISALLOWED_RE = /[^0-9+\-\s()]/g
/** An address: letters, digits, spaces and the punctuation addresses use. */
const ADDRESS_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,#/&'+\-()]+$/
/** Angle brackets and control characters: never in a subject line, always a tag. */
const MARKUP_RE = /[<>\u0000-\u001f\u007f]/
const DIGITS_RE = /^\d+$/

export type FieldResult = { ok: true; value: string } | { ok: false; message: string }

export function validateRequired(value: string, label: string): FieldResult {
  const v = value.trim()
  if (!v) return { ok: false, message: `${label} is required` }
  return { ok: true, value: v }
}

export function validateEmail(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: false, message: 'Please enter an email' }
  if (v.length > EMAIL_MAX) return { ok: false, message: `Email must be at most ${EMAIL_MAX} characters` }
  if (!EMAIL_RE.test(v)) return { ok: false, message: "That doesn't look like a valid email" }
  return { ok: true, value: v.toLowerCase() }
}

export function validateName(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: false, message: 'Please enter your full name' }
  if (v.length < NAME_MIN) return { ok: false, message: 'Name looks too short' }
  if (v.length > NAME_MAX) return { ok: false, message: `Name must be at most ${NAME_MAX} characters` }
  // Digits get their own message rather than the general "letters only" one:
  // a name with numbers in it is almost always a Guest typing their mobile or
  // a booking reference into the wrong box, and "letters only" sends them
  // looking for a symbol they did not type.
  if (HAS_DIGIT_RE.test(v)) return { ok: false, message: 'Name cannot contain numbers' }
  if (!NAME_RE.test(v)) return { ok: false, message: 'Letters, spaces, hyphens and periods only' }
  return { ok: true, value: v }
}

/**
 * One part of a person's name: first, middle or last.
 *
 * `validateName` says "full name" in its messages, which reads wrongly under a
 * field labelled "First name". This one names the field it is checking, and
 * knows that a middle name is optional (and may be a single initial) while a
 * first and last name are neither.
 */
export function validateNamePart(
  raw: string,
  label: string,
  { required = true, min = NAME_MIN }: { required?: boolean; min?: number } = {},
): FieldResult {
  const v = raw.trim().replace(/\s+/g, ' ')
  if (!v) return required ? { ok: false, message: `${label} is required` } : { ok: true, value: '' }
  if (v.length < min) return { ok: false, message: `${label} looks too short` }
  if (v.length > NAME_MAX) return { ok: false, message: `${label} must be at most ${NAME_MAX} characters` }
  if (HAS_DIGIT_RE.test(v)) return { ok: false, message: `${label} cannot contain numbers` }
  if (!NAME_RE.test(v)) {
    return { ok: false, message: `${label}: letters, spaces, hyphens, apostrophes and periods only` }
  }
  return { ok: true, value: v }
}

/**
 * "First Middle Last": the one way the site writes a person's full name.
 *
 * The sign-up form, the profile page and the booking form all build the name
 * from the same three parts, so a Guest sees the same name everywhere and the
 * Admin reads the same name on the Booking that is on the account.
 */
export function composeFullName(parts: {
  first?: string | null
  middle?: string | null
  last?: string | null
}): string {
  return [parts.first, parts.middle, parts.last]
    .map((part) => (part ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ')
}

/** Philippine mobile: 09XXXXXXXXX (11 digits). Does not truncate. */
export function validatePhMobile(raw: string): FieldResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, message: 'Please enter a mobile number' }
  if (/[A-Za-z]/.test(trimmed)) {
    return { ok: false, message: 'Mobile number cannot contain letters' }
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length !== trimmed.replace(/[\s\-()+]/g, '').replace(/^\+/, '').length && /[^\d\s\-()+]/.test(trimmed)) {
    return { ok: false, message: 'Mobile number may only contain digits and separators' }
  }
  let national = digits
  if (digits.startsWith('63') && digits.length === 12) national = `0${digits.slice(2)}`
  if (national.length > PH_MOBILE_MAX_DIGITS) {
    return { ok: false, message: `Philippine mobile numbers are ${PH_MOBILE_MAX_DIGITS} digits — do not shorten the number yourself; please re-enter it` }
  }
  if (national.length !== PH_MOBILE_MAX_DIGITS) {
    return { ok: false, message: `Use 11 digits starting with 09 (got ${national.length})` }
  }
  if (!/^09\d{9}$/.test(national)) {
    return { ok: false, message: 'Use PH format: 09XX XXX XXXX' }
  }
  return { ok: true, value: national }
}

export function normalizePhMobile(validated: string): string {
  return validated.startsWith('0') ? `+63${validated.slice(1)}` : validated
}

function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt
}

export function ageOn(birthIso: string, todayIso: string): number | null {
  const birth = parseIsoDate(birthIso)
  const today = parseIsoDate(todayIso)
  if (!birth || !today) return null
  let age = today.getUTCFullYear() - birth.getUTCFullYear()
  const md = today.getUTCMonth() - birth.getUTCMonth()
  if (md < 0 || (md === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1
  return age
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function validateBirthdate(raw: string, now = new Date()): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: false, message: 'Please enter your date of birth' }
  const birth = parseIsoDate(v)
  if (!birth) return { ok: false, message: 'Enter a valid calendar date (YYYY-MM-DD)' }
  const today = todayIso(now)
  if (v > today) return { ok: false, message: 'Date of birth cannot be in the future' }
  const age = ageOn(v, today)
  if (age == null) return { ok: false, message: 'Enter a valid calendar date' }
  if (age < MIN_GUEST_AGE) {
    return { ok: false, message: `You must be at least ${MIN_GUEST_AGE} years old to create an account` }
  }
  return { ok: true, value: v }
}

export function validateCalendarDate(raw: string, label = 'Date'): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: false, message: `${label} is required` }
  if (!parseIsoDate(v)) return { ok: false, message: `${label} is not a valid calendar date` }
  return { ok: true, value: v }
}

export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const a = parseIsoDate(checkIn)
  const b = parseIsoDate(checkOut)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function validateStayDates(checkIn: string, checkOut: string, now = new Date()): { ok: true } | { ok: false; field: 'check_in' | 'check_out'; message: string } {
  const inRes = validateCalendarDate(checkIn, 'Check-in')
  if (!inRes.ok) return { ok: false, field: 'check_in', message: inRes.message }
  const outRes = validateCalendarDate(checkOut, 'Check-out')
  if (!outRes.ok) return { ok: false, field: 'check_out', message: outRes.message }
  const today = bookingBusinessDate(now)
  if (checkIn < today) return { ok: false, field: 'check_in', message: 'Check-in cannot be in the past' }
  const nights = nightsBetween(checkIn, checkOut)
  if (nights == null || nights < MIN_BOOKING_NIGHTS) {
    return { ok: false, field: 'check_out', message: 'Check-out must be after check-in' }
  }
  if (nights > MAX_BOOKING_NIGHTS) {
    const lastCheckout = maximumCheckoutDate(checkIn)
    return {
      ok: false,
      field: 'check_out',
      message: `A stay may be at most ${MAX_BOOKING_NIGHTS} nights; this one is ${nights}.`
        + (lastCheckout ? ` Choose a checkout date on or before ${lastCheckout}.` : ''),
    }
  }
  return { ok: true }
}

export function validateAmount(raw: string, { min = 0.01, max = 5_000_000 } = {}): FieldResult {
  const v = raw.trim().replace(/,/g, '')
  if (!v) return { ok: false, message: 'Enter the amount' }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { ok: false, message: 'Amount must be a number with up to 2 decimal places' }
  const n = Number(v)
  if (!Number.isFinite(n)) return { ok: false, message: 'Amount is not a valid number' }
  if (n < min) return { ok: false, message: `Amount must be at least ${min}` }
  if (n > max) return { ok: false, message: `Amount exceeds the allowed maximum` }
  return { ok: true, value: n.toFixed(2) }
}

export function validateReference(raw: string): FieldResult {
  const v = raw.trim().toUpperCase()
  if (!v) return { ok: false, message: 'Enter the payment reference number' }
  if (v.length > REF_MAX) return { ok: false, message: `Reference must be at most ${REF_MAX} characters` }
  if (!/^[A-Z0-9-]+$/.test(v)) return { ok: false, message: 'Reference may only contain letters, numbers and hyphens' }
  return { ok: true, value: v }
}

export function validateSearch(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: true, value: '' }
  if (v.length > SEARCH_MAX_LENGTH) return { ok: false, message: `Search is limited to ${SEARCH_MAX_LENGTH} characters` }
  return { ok: true, value: v }
}

export function validateMessage(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: false, message: 'Message cannot be empty' }
  if (v.length > MESSAGE_MAX) return { ok: false, message: `Message must be at most ${MESSAGE_MAX} characters` }
  return { ok: true, value: v }
}

export function validateProofFile(file: File | null | undefined): FieldResult {
  if (!file) {
    return { ok: false, message: 'Please select a payment proof screenshot or image' }
  }
  const mimeType = file.type?.toLowerCase() || ''
  const name = file.name?.toLowerCase() || ''
  const validExtension = /\.(jpg|jpeg|png|webp)$/i.test(name)
  const validMime = ALLOWED_PROOF_MIME_TYPES.includes(mimeType)

  if (!validMime && !validExtension) {
    return { ok: false, message: 'Please upload an image file (JPG, PNG, or WEBP)' }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, message: 'File size must be 5 MB or less' }
  }
  return { ok: true, value: file.name }
}

export function validateStarRating(n: number): FieldResult {
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return { ok: false, message: 'Choose a star rating from 1 to 5' }
  }
  return { ok: true, value: String(n) }
}

export function guestCountValid(guests: number, absoluteMaximum?: number, propertyName?: string): FieldResult {
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, message: 'At least 1 guest required' }
  if (absoluteMaximum !== undefined && guests > absoluteMaximum) {
    const label = propertyName || 'This accommodation'
    return { ok: false, message: `${label} can accommodate up to ${absoluteMaximum} guests.` }
  }
  return { ok: true, value: String(guests) }
}

export function looksLikeDigits(value: string): boolean {
  return DIGITS_RE.test(value)
}

/**
 * An inquiry or case subject line: long enough to be triaged, short enough to be
 * a headline. Angle brackets are refused outright — a subject is rendered as
 * text, and a Guest who can put a tag in one has tried to.
 */
export function validateSubject(raw: string): FieldResult {
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v) return { ok: false, message: 'Please enter a subject' }
  if (v.length < SUBJECT_MIN) {
    return { ok: false, message: `Subject must be at least ${SUBJECT_MIN} characters — say what it is about` }
  }
  if (v.length > SUBJECT_MAX_LENGTH) {
    return { ok: false, message: `Subject must be at most ${SUBJECT_MAX_LENGTH} characters (that is ${v.length})` }
  }
  if (MARKUP_RE.test(v)) return { ok: false, message: 'Subject cannot contain < or >' }
  return { ok: true, value: v }
}

/** A postal address, kept as written: collapsed spaces, trimmed, never re-cased. */
export function validateAddress(raw: string): FieldResult {
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v) return { ok: false, message: 'Please enter an address' }
  if (v.length < ADDRESS_MIN) {
    return { ok: false, message: `Address must be at least ${ADDRESS_MIN} characters`}
  }
  if (v.length > ADDRESS_MAX) {
    return { ok: false, message: `Address must be at most ${ADDRESS_MAX} characters (that is ${v.length})` }
  }
  if (!ADDRESS_RE.test(v)) {
    return {
      ok: false,
      message: `Address may only contain letters, numbers, spaces and punctuation (, . # / - ' & + ( ))`,
    }
  }
  return { ok: true, value: v }
}

/**
 * The Guest's notes on a Booking. Empty is a complete answer, so an absent note
 * is `ok` with no value — the form only asks this field to stay short.
 */
export function validateAdditionalNotes(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: true, value: '' }
  if (v.length > ADDITIONAL_NOTES_MAX) {
    return {
      ok: false,
      message: `Notes must be at most ${ADDITIONAL_NOTES_MAX} characters (that is ${v.length})`,
    }
  }
  return { ok: true, value: v }
}

/** One line about the occasion. Optional, like the notes, and printed as given. */
export function validateEventDetail(raw: string): FieldResult {
  const v = raw.trim()
  if (!v) return { ok: true, value: '' }
  if (v.length > EVENT_DETAIL_MAX) {
    return {
      ok: false,
      message: `Event details must be at most ${EVENT_DETAIL_MAX} characters (that is ${v.length})`,
    }
  }
  return { ok: true, value: v }
}

/**
 * A name field, while it is being typed: digits and symbols out, letters,
 * spaces, apostrophes, hyphens and periods kept.
 *
 * Stripping rather than refusing is the right trade for this one field because
 * the disallowed characters are never information — `Juan123` is a Guest who
 * started typing a reference in the wrong box, and there is nothing in `123`
 * worth an error message. `validateName` still checks the value on blur and on
 * submit, so a paste of anything un-name-shaped is caught before it is sent.
 */
export function sanitizeNameInput(raw: string): string {
  return raw
    .replace(NAME_DISALLOWED_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
}

/**
 * A mobile field, while it is being typed: letters and stray punctuation out,
 * digits and the separators a Guest uses to group them kept.
 *
 * The separators survive on purpose. Stripping them would fight the Guest's own
 * cursor on every keystroke, and `validatePhMobile` reads the number past them.
 */
export function sanitizePhoneInput(raw: string): string {
  return raw
    .replace(PHONE_DISALLOWED_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PHONE_MAX_INPUT_LENGTH)
}

/**
 * An amount field, while it is being typed: one decimal point, at most two
 * decimals, no letters, no thousands separator.
 *
 * The decimals are truncated, not rounded — a Guest typing a receipt figure
 * must never watch the page invent a centavo. `validateAmount` is what decides
 * the number is a peso amount at all, and it is the one that quotes a minimum.
 */
export function sanitizeAmountInput(raw: string): string {
  const kept = raw.replace(/,/g, '').replace(/[^0-9.]/g, '')
  const dot = kept.indexOf('.')
  if (dot === -1) return kept.slice(0, 12)
  const whole = kept.slice(0, dot).slice(0, 12) || '0'
  const cents = kept.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return `${whole}.${cents}`
}

/**
 * A payment reference field: upper case, letters, digits and hyphens, capped at
 * `REF_MAX`. Uppercasing is the half that matters — a reference is matched
 * against a receipt and against the Admin's catalogue, and `gcash-123` and
 * `GCASH-123` must be the same reference.
 */
export function sanitizeReferenceInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, REF_MAX)
}

/**
 * Digits only, for a count field typed into a text input.
 *
 * `maxDigits` is the width of the box, not the size of the number: the count's
 * real limits are the accommodation's capacity, and `guestCountValid` is what
 * enforces those.
 */
export function sanitizeDigitsOnly(raw: string | number | null | undefined, maxDigits?: number): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return maxDigits && maxDigits > 0 ? digits.slice(0, maxDigits) : digits
}
