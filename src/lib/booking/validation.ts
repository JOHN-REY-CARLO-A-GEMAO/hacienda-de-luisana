// ----------------------------------------------------------------------------
// Guest booking rule validation — the explainable preflight
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Firestore Security Rules are the authoritative create boundary, but a rules
// denial only reaches the browser as `permission-denied`; it cannot say which
// conjunct failed. This module is the shared, pure courtesy copy of the rules'
// guest-facing selection and pricing checks. It is used before /book advances to
// /book/pay and again before a payment proof is uploaded.
//
// It deliberately does not replace firestore.rules. A direct Firestore request
// still has to pass the rules. The value here is that a normal Guest gets a useful
// reason before spending time on payment, and a stale quote is named instead of
// being flattened into the generic "booking rules refused it" sentence.
// ----------------------------------------------------------------------------

import { assertSubmittable, type SubmissionProof } from './submit'
import {
  BOOKING_TIME_ZONE,
  minimumBookingLeadTimeMessage,
  minimumCheckInDate,
  validateMinimumBookingLeadTime,
  type BookingDateValidation,
} from './leadTime'
import {
  classifyRateDate,
  quoteAccommodation,
  type AccommodationRates,
  type PropertyQuote,
  type PublishedRates,
} from './rates'

export type BookingRuleFailureCode =
  | 'INVALID_CHECK_IN_DATE'
  | 'INVALID_CHECK_OUT_DATE'
  | 'CHECK_OUT_BEFORE_CHECK_IN'
  | 'MINIMUM_BOOKING_LEAD_TIME'
  | 'STAY_LENGTH_NOT_SUPPORTED'
  | 'PROPERTY_NOT_BOOKABLE'
  | 'RATE_NOT_PUBLISHED'
  | 'GUEST_COUNT_NOT_SUPPORTED'
  | 'RATE_CONFIGURATION_INVALID'
  | 'DATE_UNAVAILABLE'
  | 'RATE_SNAPSHOT_STALE'
  | 'PAYMENT_PROOF_REQUIRED'
  | 'PAYMENT_AMOUNT_REQUIRED'
  | 'PAYMENT_AMOUNT_TOO_LOW'
  | 'GUEST_IDENTITY_REQUIRED'
  | 'RULES_REFUSED'

export type BookingRuleField = 'check_in' | 'check_out' | 'guests' | 'accommodation' | 'payment'

export type BookingRuleFailure = {
  code: BookingRuleFailureCode
  message: string
  field?: BookingRuleField
}

export type BookingSelection = {
  accommodation: string
  check_in: string
  check_out: string
  guests: number
}

export type BookingSelectionOptions = {
  /** Current Admin-published figures. `null` means there is no usable document. */
  published: PublishedRates | null | undefined
  /** The Admin setting, already read by the caller when it has a fresh value. */
  minimumBookingLeadTimeDays?: number
  /** Pin the business instant in tests; defaults to now. */
  now?: Date
  /** Set false after the caller has completed a fresh server policy check. */
  checkLeadTime?: boolean
}

export type BookingSelectionValidation =
  | { ok: true; quote: PropertyQuote; nights: 1 }
  | { ok: false; failure: BookingRuleFailure }

/** The fields the create rules derive from the published quote. */
export type BookingPayloadForValidation = BookingSelection & SubmissionProof & {
  uid?: string | null
  nights?: unknown
  rate_amount?: unknown
  rate_unit?: unknown
  rate_classification?: unknown
  stay_total?: unknown
  amount_due?: unknown
  security_deposit?: unknown
  balance_due?: unknown
  payment_plan?: unknown
  payment_status?: unknown
  policy_version?: unknown
  policy_effective_date?: unknown
  refund_policy_snapshot?: unknown
}

export type BookingPayloadValidation =
  | { ok: true; quote: PropertyQuote; nights: 1 }
  | { ok: false; failure: BookingRuleFailure }

function failure(
  code: BookingRuleFailureCode,
  message: string,
  field?: BookingRuleField,
): { ok: false; failure: BookingRuleFailure } {
  return { ok: false, failure: { code, message, ...(field ? { field } : {}) } }
}

function parseCalendarDate(value: unknown): { ok: true; value: string; time: number } | { ok: false } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false }
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return { ok: false }
  return { ok: true, value, time }
}

function displayProperty(id: string, figures?: AccommodationRates): string {
  return figures?.property_name?.trim() || (id === 'main-house' ? 'The Main House' : id)
}

function dateValidationFailure(result: BookingDateValidation): { ok: false; failure: BookingRuleFailure } | null {
  if (result.ok) return null
  if (result.code === 'MINIMUM_BOOKING_LEAD_TIME') {
    return failure('MINIMUM_BOOKING_LEAD_TIME', result.reason, 'check_in')
  }
  return failure('INVALID_CHECK_IN_DATE', result.reason, 'check_in')
}

function guestRuleMessage(
  property: string,
  classification: 'weekday' | 'weekend_holiday',
  schedule: NonNullable<NonNullable<PublishedRates['accommodations'][string]['guest_pricing']>['weekday']>,
  guests: number,
): string {
  const period = classification === 'weekend_holiday' ? 'weekend or holiday' : 'weekday'
  const maximum = schedule.max_guests ?? schedule.base_max_guests
  if (schedule.max_guests !== undefined || schedule.base_max_guests === maximum) {
    return `${property}'s published ${period} rate accepts ${schedule.min_guests}–${maximum} guests; ${guests} guests is outside that range.`
  }
  return `${property}'s published ${period} rate starts at ${schedule.min_guests} guests; ${guests} guests is not supported.`
}

/**
 * Validate the stay selection before the Guest is allowed to see the payment
 * step. This is intentionally the same one-night quote path used by the page.
 */
export function validateBookingSelection(
  selection: BookingSelection,
  options: BookingSelectionOptions,
): BookingSelectionValidation {
  const published = options.published
  const figures = published?.accommodations?.[selection.accommodation]
  const property = displayProperty(selection.accommodation, figures)

  const checkIn = parseCalendarDate(selection.check_in)
  if (!checkIn.ok) {
    return failure('INVALID_CHECK_IN_DATE', 'Check-in is not a valid calendar date.', 'check_in')
  }
  const checkOut = parseCalendarDate(selection.check_out)
  if (!checkOut.ok) {
    return failure('INVALID_CHECK_OUT_DATE', 'Check-out is not a valid calendar date.', 'check_out')
  }
  if (checkOut.time <= checkIn.time) {
    return failure('CHECK_OUT_BEFORE_CHECK_IN', 'Check-out must be after check-in.', 'check_out')
  }

  if (options.checkLeadTime !== false) {
    const lead = validateMinimumBookingLeadTime(
      selection.check_in,
      options.now ?? new Date(),
      options.minimumBookingLeadTimeDays,
    )
    const leadFailure = dateValidationFailure(lead)
    if (leadFailure) return leadFailure
  }

  const nights = Math.round((checkOut.time - checkIn.time) / 86_400_000)
  if (nights !== 1) {
    return failure(
      'STAY_LENGTH_NOT_SUPPORTED',
      `Online booking for ${property} currently supports one 22-hour standard stay. This selection is ${nights} nights; please choose one night or contact the Hacienda for a longer stay.`,
      'check_out',
    )
  }

  if (!published) {
    return failure(
      'RATE_NOT_PUBLISHED',
      `Online booking cannot quote ${property} because the Hacienda has not published a current rate for it. Please contact the Hacienda before sending a payment.`,
      'accommodation',
    )
  }
  if (!figures) {
    return failure(
      'RATE_NOT_PUBLISHED',
      `${property} has no published guest-count rate for these dates. Please choose another property or contact the Hacienda.`,
      'accommodation',
    )
  }
  if (figures.active === false) {
    return failure('PROPERTY_NOT_BOOKABLE', `${property} is not accepting new bookings right now.`, 'accommodation')
  }

  const classification = classifyRateDate(selection.check_in, published.holiday_dates)
  const schedule = classification ? figures.guest_pricing?.[classification] : undefined
  if (!classification || !schedule) {
    return failure(
      'RATE_NOT_PUBLISHED',
      `${property} has no valid published rate for this check-in date. Please contact the Hacienda before sending a payment.`,
      'accommodation',
    )
  }
  if (!Number.isInteger(selection.guests) || selection.guests < schedule.min_guests
      || (schedule.max_guests !== undefined && selection.guests > schedule.max_guests)) {
    return failure(
      'GUEST_COUNT_NOT_SUPPORTED',
      guestRuleMessage(property, classification, schedule, selection.guests),
      'guests',
    )
  }

  const quote = quoteAccommodation(published, selection.accommodation, selection)
  if (!quote) {
    return failure(
      'RATE_CONFIGURATION_INVALID',
      `The published rate for ${property} could not quote this stay. Nothing was submitted; please try again later or contact the Hacienda.`,
      'accommodation',
    )
  }
  return { ok: true, quote, nights: 1 }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function snapshotFailure(property: string, label: string, expected: unknown, received: unknown): { ok: false; failure: BookingRuleFailure } {
  const expectedText = typeof expected === 'number' ? expected.toLocaleString('en-PH') : String(expected)
  const receivedText = received === undefined || received === null ? 'missing' : String(received)
  return failure(
    'RATE_SNAPSHOT_STALE',
    `The published ${label} for ${property} changed while you were booking (expected ${expectedText}, received ${receivedText}). Please go back to Stay details and review the current quote.`,
    'accommodation',
  )
}

/**
 * Validate the complete document that the web adapter is about to create. This
 * catches the useful subset of a Firestore create denial without pretending the
 * browser can replace server authorization.
 */
export function validateBookingPayload(
  input: BookingPayloadForValidation,
  options: BookingSelectionOptions,
): BookingPayloadValidation {
  const selection = validateBookingSelection(input, options)
  if (!selection.ok) return selection
  const { quote } = selection
  const property = displayProperty(input.accommodation, options.published?.accommodations?.[input.accommodation])
  const due = Math.floor((quote.stayTotal * 50 + Number.EPSILON)) / 100

  const proof = assertSubmittable(input)
  if (!proof.ok) {
    return failure(
      proof.reason.includes('screenshot') ? 'PAYMENT_PROOF_REQUIRED' : 'PAYMENT_AMOUNT_REQUIRED',
      proof.reason,
      'payment',
    )
  }
  if (!input.uid?.trim()) {
    return failure(
      'GUEST_IDENTITY_REQUIRED',
      'We could not attach this booking to a Guest identity, so nothing was saved. Please enable sign-in or try again in a moment.',
      'payment',
    )
  }
  if (input.nights !== 1) return snapshotFailure(property, 'number of nights', 1, input.nights)
  if (input.rate_amount !== quote.rateCard.nightlyRate) return snapshotFailure(property, 'rate', quote.rateCard.nightlyRate, input.rate_amount)
  if (input.rate_unit !== 'standard_stay') return snapshotFailure(property, 'rate unit', 'standard_stay', input.rate_unit)
  if (input.rate_classification !== quote.classification) return snapshotFailure(property, 'rate classification', quote.classification, input.rate_classification)
  if (input.stay_total !== quote.stayTotal) return snapshotFailure(property, 'stay total', quote.stayTotal, input.stay_total)
  if (input.payment_plan !== 'down-payment') return snapshotFailure(property, 'payment plan', 'down-payment', input.payment_plan)
  if (input.amount_due !== due) return snapshotFailure(property, 'downpayment due now', due, input.amount_due)
  if (input.security_deposit !== quote.rateCard.securityDeposit) return snapshotFailure(property, 'security deposit', quote.rateCard.securityDeposit, input.security_deposit)
  if (input.balance_due !== quote.stayTotal - due) return snapshotFailure(property, 'balance due', quote.stayTotal - due, input.balance_due)
  if (input.policy_version !== quote.snapshot.version) return snapshotFailure(property, 'rate version', quote.snapshot.version, input.policy_version)
  if (input.policy_effective_date !== quote.snapshot.effectiveDate) return snapshotFailure(property, 'rate effective date', quote.snapshot.effectiveDate, input.policy_effective_date)
  if (!sameValue(input.refund_policy_snapshot, options.published?.refund ?? null)) {
    return snapshotFailure(property, 'cancellation policy snapshot', 'the current policy', input.refund_policy_snapshot)
  }
  if (typeof input.amount_claimed !== 'number' || input.amount_claimed < due) {
    return failure(
      'PAYMENT_AMOUNT_TOO_LOW',
      `The downpayment due now for ${property} is ₱${due.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. The screenshot has to cover at least that amount.`,
      'payment',
    )
  }
  return { ok: true, quote, nights: 1 }
}

/** A compact description for logs and tests, without leaking rule internals. */
export function genericRulesRefusal(property = 'this stay'): BookingRuleFailure {
  return {
    code: 'RULES_REFUSED',
    message: `The Hacienda's server rules refused the booking for ${property}. The selected dates and quote may have changed, or the site's booking configuration needs attention. Nothing was saved; please return to Stay details and try again, or contact the Hacienda with your reference.`,
  }
}

/** The business timezone is exported here for callers rendering audit copy. */
export { BOOKING_TIME_ZONE, minimumBookingLeadTimeMessage, minimumCheckInDate }
