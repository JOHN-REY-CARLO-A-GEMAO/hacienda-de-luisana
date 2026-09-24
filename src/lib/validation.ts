/** Shared field validation. Used by forms and tests. Never silent-truncate. */

export const MIN_GUEST_AGE = 10
export const PH_MOBILE_MAX_DIGITS = 11
export const SEARCH_MAX_LENGTH = 80
export const NAME_MIN = 2
export const NAME_MAX = 80
export const EMAIL_MAX = 120
export const MESSAGE_MAX = 2000
export const REVIEW_MAX = 1000
export const REF_MAX = 40
export const MIN_BOOKING_NIGHTS = 1
export const MAX_BOOKING_NIGHTS = 30

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ' .\-]+$/
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
  if (!NAME_RE.test(v)) return { ok: false, message: 'Letters, spaces, hyphens and periods only' }
  return { ok: true, value: v }
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
  const today = todayIso(now)
  if (checkIn < today) return { ok: false, field: 'check_in', message: 'Check-in cannot be in the past' }
  const nights = nightsBetween(checkIn, checkOut)
  if (nights == null || nights < MIN_BOOKING_NIGHTS) {
    return { ok: false, field: 'check_out', message: 'Check-out must be after check-in' }
  }
  if (nights > MAX_BOOKING_NIGHTS) {
    return { ok: false, field: 'check_out', message: `Stays may be at most ${MAX_BOOKING_NIGHTS} nights` }
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

export function validateStarRating(n: number): FieldResult {
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return { ok: false, message: 'Choose a star rating from 1 to 5' }
  }
  return { ok: true, value: String(n) }
}

export function guestCountValid(guests: number, capacity: number): FieldResult {
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, message: 'At least 1 guest required' }
  if (guests > 12) return { ok: false, message: 'Max 12 guests per booking' }
  if (guests > capacity) return { ok: false, message: `This stay accommodates up to ${capacity} guests` }
  return { ok: true, value: String(guests) }
}

export function looksLikeDigits(value: string): boolean {
  return DIGITS_RE.test(value)
}
