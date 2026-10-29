/**
 * Privacy-safe Booking availability and the authoritative Guest submit boundary.
 *
 * The browser may not read everybody's `bookings` documents: they contain names,
 * contact details and Payment proof paths. `bookingAvailability` reads those
 * documents with the Admin SDK and returns only one state per overnight date.
 * `submitBooking` performs the same availability calculation inside the
 * transaction that creates the Pending Booking, so two Guests cannot claim the
 * last unit between a calendar refresh and submit.
 *
 * `bookings` remains the sole availability source. There is no shadow
 * calendar/hold collection to reconcile; a date-free property revision only
 * serializes concurrent submissions around an initially empty overlap query.
 */

import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  calendarAvailability,
  findDateConflicts,
  type CalendarAvailabilityDay,
  type HoldBearingBooking,
} from './booking/availability'
import { deriveQuote, MinuteBudget, moneyMismatches, parseQuoteRequest, type QuoteRequest } from './pricing'
import { spendCallableQuota } from './rateLimit'

const options = {
  region: 'asia-southeast1',
  maxInstances: 5,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
}

let firestore: ReturnType<typeof getFirestore> | null = null
const db = () => (firestore ??= getFirestore())

const DAY_MS = 86_400_000
const DATE_HOLD_MS = DAY_MS
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CALENDAR_DAYS = 62
const CANONICAL_ACCOMMODATIONS = ['main-house', 'annex', 'house-a-camping'] as const

const AVAILABILITY_LIMIT_PER_MINUTE = 40
const AVAILABILITY_PERSIST_AFTER = 6
const rawSubmitLimit = Number(process.env.SUBMIT_RATE_LIMIT_PER_MINUTE ?? 8)
const SUBMIT_LIMIT_PER_MINUTE = Number.isInteger(rawSubmitLimit) && rawSubmitLimit >= 1 ? rawSubmitLimit : 8

/** Public availability is intentionally callable, but not an unbounded Firestore scraper. */
const availabilityBudget = new MinuteBudget(AVAILABILITY_LIMIT_PER_MINUTE)
/** A signed-in Guest should not be able to create an unbounded number of Pending rows. */
const submitBudget = new MinuteBudget(SUBMIT_LIMIT_PER_MINUTE)

/** Test seam to clear per-instance in-memory rate-limit counters between test cases. */
export function resetAvailabilityRateLimits(): void {
  availabilityBudget.reset()
  submitBudget.reset()
}

function callableKey(request: CallableRequest): string {
  return request.auth?.uid || request.rawRequest?.ip || 'unknown-caller'
}

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null
}

export type AvailabilityRequest = {
  accommodation: string
  from: string
  to: string
}

/** Strict, bounded input parser; exported as a pure test seam. */
export function parseAvailabilityRequest(raw: unknown): AvailabilityRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'An Accommodation and calendar range are required.')
  }
  const input = raw as Record<string, unknown>
  const accommodation = typeof input.accommodation === 'string' ? input.accommodation : ''
  if (!CANONICAL_ACCOMMODATIONS.includes(accommodation as (typeof CANONICAL_ACCOMMODATIONS)[number])) {
    throw new HttpsError('invalid-argument', 'Choose a bookable Accommodation.')
  }
  const from = typeof input.from === 'string' ? input.from : ''
  const to = typeof input.to === 'string' ? input.to : ''
  const start = dateMs(from)
  const end = dateMs(to)
  if (start === null || end === null || end <= start) {
    throw new HttpsError('invalid-argument', 'Choose a valid calendar range.')
  }
  const days = Math.round((end - start) / DAY_MS)
  if (days > MAX_CALENDAR_DAYS) {
    throw new HttpsError('invalid-argument', `Calendar requests may cover at most ${MAX_CALENDAR_DAYS} days.`)
  }
  return { accommodation, from, to }
}

function dateOnly(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10)
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString().slice(0, 10)
    if (typeof timestamp.seconds === 'number') return new Date(timestamp.seconds * 1000).toISOString().slice(0, 10)
  }
  return ''
}

function instant(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString()
    if (typeof timestamp.seconds === 'number') return new Date(timestamp.seconds * 1000).toISOString()
  }
  return null
}

function holdBearing(id: string, data: DocumentData): HoldBearingBooking {
  return {
    id,
    accommodation: typeof data.accommodation === 'string' ? data.accommodation : '',
    check_in: dateOnly(data.check_in),
    check_out: dateOnly(data.check_out),
    status: typeof data.status === 'string' ? data.status : '',
    hold_expires_at: instant(data.hold_expires_at),
  }
}

function unitsFor(rates: DocumentData | undefined, accommodation: string): number | null {
  const node = rates?.accommodations?.[accommodation]
  if (!node || node.active === false) return null
  const published = node.available_units
  // Cloud availability never guesses inventory from the build-time catalogue.
  // An older/malformed rate card without a positive unit count is unknown, not
  // green. Demo mode may still use its labelled local catalogue fallback.
  return Number.isInteger(published) && published > 0 ? published : null
}

function availabilityFailure(message = 'Availability cannot be confirmed right now. Please try again.'): HttpsError {
  return new HttpsError('unavailable', message, { cause: 'AVAILABILITY_UNKNOWN' })
}

function assertUsableProjectionRecords(bookings: readonly HoldBearingBooking[]): void {
  const corrupt = bookings.some((booking) => {
    const checkIn = dateMs(booking.check_in)
    const checkOut = dateMs(booking.check_out)
    return booking.accommodation === '' || checkIn === null || checkOut === null || checkOut <= checkIn
  })
  if (corrupt) throw availabilityFailure()
}

/** Read only records that can overlap the bounded request. */
async function overlappingBookings(input: AvailabilityRequest): Promise<HoldBearingBooking[]> {
  const snapshot = await db()
    .collection('bookings')
    .where('accommodation', '==', input.accommodation)
    .where('check_out', '>', input.from)
    .where('check_in', '<', input.to)
    .get()
  const bookings = snapshot.docs.map((document) => holdBearing(document.id, document.data()))
  assertUsableProjectionRecords(bookings)
  return bookings
}

export type AvailabilityReply = {
  accommodation: string
  from: string
  to: string
  generated_at: string
  days: CalendarAvailabilityDay[]
}

export const bookingAvailability = onCall(options, async (request: CallableRequest): Promise<AvailabilityReply> => {
  const input = parseAvailabilityRequest(request.data)
  await spendCallableQuota({
    firestore: db(),
    budget: availabilityBudget,
    scope: 'bookingAvailability',
    key: callableKey(request),
    limit: AVAILABILITY_LIMIT_PER_MINUTE,
    persistAfter: AVAILABILITY_PERSIST_AFTER,
    label: 'availability',
  })
  try {
    const [ratesDocument, bookings] = await Promise.all([
      db().doc('site_config/rates').get(),
      overlappingBookings(input),
    ])
    if (!ratesDocument.exists) throw availabilityFailure()
    const units = unitsFor(ratesDocument.data(), input.accommodation)
    if (!units) throw availabilityFailure('This Accommodation is not accepting online Bookings right now.')
    const now = Date.now()
    const days = calendarAvailability(input, bookings, { unitsAvailable: units, now })
    const expected = Math.round((dateMs(input.to)! - dateMs(input.from)!) / DAY_MS)
    if (days.length !== expected || days.some((day) => day.state === 'unknown')) throw availabilityFailure()
    return {
      ...input,
      generated_at: new Date(now).toISOString(),
      days,
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error('[availability] read failed', error instanceof Error ? error.name : 'unknown')
    throw availabilityFailure()
  }
})

// ---------------------------------------------------------------------------
// Authoritative Pending Booking creation
// ---------------------------------------------------------------------------

const ALLOWED_BOOKING_KEYS = new Set([
  'guest_name', 'phone', 'email', 'check_in', 'check_out', 'guests', 'accommodation',
  'special_requests', 'pet_count', 'pet_request', 'late_checkout_hours',
  'late_checkout_request', 'bonfire_wood_sets', 'event_purpose', 'event_purpose_detail',
  'uid', 'source', 'payment_proof_url', 'paymentProofUrl', 'payment_plan',
  'payment_status', 'amount_claimed', 'payment_reference', 'ocr_reference', 'ocr_amount',
  'nights', 'stay_total', 'amount_due', 'security_deposit', 'balance_due',
  'rate_amount', 'rate_unit', 'rate_classification', 'policy_version',
  'policy_effective_date', 'refund_policy_snapshot', 'quote_id',
  'terms_version', 'terms_accepted_at',
])

function requireString(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max: number; optional?: boolean },
): string {
  const value = input[key]
  if (options.optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `The Booking ${key} is invalid.`)
  const trimmed = value.trim()
  if (trimmed.length < (options.min ?? 0) || trimmed.length > options.max) {
    throw new HttpsError('invalid-argument', `The Booking ${key} is invalid.`)
  }
  return value
}

function validPendingRequest(value: unknown, kind: 'pet' | 'late'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  const keys = Object.keys(node)
  const allowed = kind === 'pet'
    ? ['count', 'estimated_fee', 'status', 'requested_at']
    : ['hours', 'fee', 'status', 'requested_at', 'reason']
  if (keys.some((key) => !allowed.includes(key)) || node.status !== 'pending') return false
  const count = kind === 'pet' ? node.count : node.hours
  const fee = kind === 'pet' ? node.estimated_fee : node.fee
  return Number.isInteger(count) && Number(count) > 0 && Number(count) <= 20
    && typeof fee === 'number' && Number.isFinite(fee) && fee >= 0
    && typeof node.requested_at === 'string' && Number.isFinite(Date.parse(node.requested_at))
    && (node.reason === undefined || (typeof node.reason === 'string' && node.reason.length <= 500))
}

/**
 * Validate the non-price shape before an Admin-SDK write. Firestore rules do not
 * run for this function, so every client-controlled field needs an explicit
 * boundary here rather than an assumption that the old create rule will catch it.
 */
export function validateGuestBookingShape(raw: unknown, authUid: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'Booking details are required.')
  }
  const input = raw as Record<string, unknown>
  if (Object.keys(input).some((key) => !ALLOWED_BOOKING_KEYS.has(key))) {
    throw new HttpsError('invalid-argument', 'The Booking contains an unsupported field.')
  }
  if (input.uid !== authUid) throw new HttpsError('permission-denied', 'The Booking identity does not match this session.')
  if (input.source !== 'web') throw new HttpsError('invalid-argument', 'Only website Bookings use this submit operation.')
  requireString(input, 'guest_name', { min: 2, max: 160 })
  requireString(input, 'phone', { min: 7, max: 40 })
  requireString(input, 'email', { min: 3, max: 254 })
  requireString(input, 'special_requests', { max: 5000 })
  const proof = requireString(input, 'payment_proof_url', { min: 1, max: 1000 })
  const proofAlias = requireString(input, 'paymentProofUrl', { min: 1, max: 1000 })
  if (proof !== proofAlias) throw new HttpsError('invalid-argument', 'The Payment proof path is inconsistent.')
  if (input.payment_status !== 'pending' || input.payment_plan !== 'down-payment') {
    throw new HttpsError('invalid-argument', 'A new Booking must carry a pending down payment.')
  }
  if (typeof input.amount_claimed !== 'number' || !Number.isFinite(input.amount_claimed) || input.amount_claimed <= 0) {
    throw new HttpsError('invalid-argument', 'Enter the amount shown on the Payment proof.')
  }
  if (input.payment_reference !== undefined) requireString(input, 'payment_reference', { max: 200, optional: true })
  if (input.event_purpose !== undefined) requireString(input, 'event_purpose', { max: 80, optional: true })
  if (input.event_purpose_detail !== undefined) requireString(input, 'event_purpose_detail', { max: 500, optional: true })
  for (const key of ['pet_count', 'late_checkout_hours', 'bonfire_wood_sets']) {
    const value = input[key]
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 20)) {
      throw new HttpsError('invalid-argument', `The Booking ${key} is invalid.`)
    }
  }
  if (input.pet_request !== undefined && !validPendingRequest(input.pet_request, 'pet')) {
    throw new HttpsError('invalid-argument', 'The pet request is invalid.')
  }
  if (input.late_checkout_request !== undefined && !validPendingRequest(input.late_checkout_request, 'late')) {
    throw new HttpsError('invalid-argument', 'The late-checkout request is invalid.')
  }
  return input
}

function quoteDocumentMatches(
  quote: DocumentData | undefined,
  booking: Record<string, unknown>,
  request: QuoteRequest,
  authUid: string,
  now: number,
): boolean {
  if (!quote || quote.bound_uid !== authUid) return false
  const expiry = typeof quote.expires_at_ms === 'number'
    ? quote.expires_at_ms
    : quote.expires_at?.toMillis?.() ?? Date.parse(String(quote.expires_at ?? ''))
  if (!Number.isFinite(expiry) || expiry <= now) return false
  return moneyMismatches(booking, { request, money: {
    rate_unit: quote.rate_unit,
    rate_amount: quote.rate_amount,
    rate_classification: quote.rate_classification,
    nights: quote.nights,
    stay_total: quote.stay_total,
    amount_due: quote.amount_due,
    balance_due: quote.balance_due,
    security_deposit: quote.security_deposit,
    payment_plan: quote.payment_plan,
    policy_version: quote.policy_version,
    policy_effective_date: quote.policy_effective_date,
    refund_policy_snapshot: quote.refund_policy_snapshot ?? null,
  } }).length === 0
}

export type SubmitBookingReply = {
  id: string
  status: 'Pending'
  created_at: string
  hold_expires_at: string
}

export const submitBooking = onCall(options, async (request: CallableRequest): Promise<SubmitBookingReply> => {
  const authUid = request.auth?.uid
  if (!authUid) throw new HttpsError('unauthenticated', 'Reconnect your Guest session before submitting the Booking.')
  const body = request.data && typeof request.data === 'object' && !Array.isArray(request.data)
    ? request.data as Record<string, unknown>
    : {}
  const booking = validateGuestBookingShape(body.booking, authUid)
  const parsed = parseQuoteRequest(booking)
  if (!parsed.ok) {
    throw new HttpsError(parsed.status as never, parsed.guestMessage, { cause: parsed.cause })
  }
  await spendCallableQuota({
    firestore: db(),
    budget: submitBudget,
    scope: 'submitBooking',
    key: authUid,
    limit: SUBMIT_LIMIT_PER_MINUTE,
    label: 'Booking',
  })

  const bookingRef = db().collection('bookings').doc()
  // This is a transaction coordinator, not an availability store: it contains
  // no dates, capacity, status, or Guest data. Touching one revision per
  // Accommodation makes simultaneous submissions contend even when their
  // overlap queries initially return no documents (the empty-query phantom
  // case). The Booking collection remains the only availability authority.
  const inventoryLockRef = db().collection('booking_inventory_locks').doc(parsed.value.accommodation)
  try {
    return await db().runTransaction(async (transaction) => {
      const now = Date.now()
      const at = new Date(now).toISOString()
      const holdExpiresAt = new Date(now + DATE_HOLD_MS).toISOString()
      const ratesRef = db().doc('site_config/rates')
      const configRef = db().doc('site_config/booking')

      // Every read precedes every write. The overlap query and the property
      // revision read are part of this same transaction; updating that shared
      // revision serializes last-unit claims, including an initially empty query.
      const ratesSnapshot = await transaction.get(ratesRef)
      const configSnapshot = await transaction.get(configRef)
      const rates = ratesSnapshot.exists ? ratesSnapshot.data() : null
      const config = configSnapshot.exists ? configSnapshot.data() : null
      const derived = deriveQuote(rates, parsed.value, { now, bookingConfig: config })
      if (!derived.ok) {
        throw new HttpsError(derived.status as never, derived.guestMessage, { cause: derived.cause })
      }

      const normalizedForMoney = {
        ...booking,
        pet_count: booking.pet_count ?? 0,
        late_checkout_hours: booking.late_checkout_hours ?? 0,
      }
      const mismatches = moneyMismatches(normalizedForMoney, derived.quote)
      if (mismatches.length > 0) {
        throw new HttpsError(
          'failed-precondition',
          'The published rate changed while you were booking. Return to Stay details and review the current quote.',
          { cause: 'RATE_SNAPSHOT_STALE' },
        )
      }
      if (Number(booking.amount_claimed) < derived.quote.money.amount_due) {
        throw new HttpsError('failed-precondition', 'The Payment proof does not cover the current down payment.', { cause: 'PAYMENT_AMOUNT_TOO_LOW' })
      }

      const quoteRequired = config?.quotes_required === true
      const quoteId = typeof booking.quote_id === 'string' ? booking.quote_id : ''
      if (quoteRequired || quoteId) {
        if (!/^[a-f0-9]{32}$/.test(quoteId)) {
          throw new HttpsError('failed-precondition', 'The confirmed price expired. Return to Stay details and try again.', { cause: 'QUOTE_REQUIRED' })
        }
        const quoteSnapshot = await transaction.get(db().doc(`booking_quotes/${quoteId}`))
        if (!quoteDocumentMatches(quoteSnapshot.data(), normalizedForMoney, parsed.value, authUid, now)) {
          throw new HttpsError('failed-precondition', 'The confirmed price expired or no longer matches this stay. Return to Stay details and try again.', { cause: 'QUOTE_STALE' })
        }
      }

      const units = unitsFor(rates ?? undefined, parsed.value.accommodation)
      if (!units) throw availabilityFailure('This Accommodation is not accepting online Bookings right now.')
      const inventoryLockSnapshot = await transaction.get(inventoryLockRef)
      const currentRevision = inventoryLockSnapshot.exists
        ? Number(inventoryLockSnapshot.data()?.revision)
        : 0
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw availabilityFailure('Online Booking coordination is unavailable right now.')
      }
      const rivalsQuery = db().collection('bookings')
        .where('accommodation', '==', parsed.value.accommodation)
        .where('check_out', '>', parsed.value.check_in)
        .where('check_in', '<', parsed.value.check_out)
      const rivalsSnapshot = await transaction.get(rivalsQuery)
      const rivals = rivalsSnapshot.docs.map((document) => holdBearing(document.id, document.data()))
      assertUsableProjectionRecords(rivals)
      const conflicts = findDateConflicts(parsed.value, rivals, { unitsAvailable: units, now })
      if (conflicts.length > 0) {
        throw new HttpsError(
          'already-exists',
          'Those dates were just held by another Booking. Choose a different check-in date.',
          { cause: 'DATE_UNAVAILABLE' },
        )
      }

      transaction.set(inventoryLockRef, {
        revision: currentRevision + 1,
        updated_at: FieldValue.serverTimestamp(),
      })
      const stored = {
        ...booking,
        uid: authUid,
        source: 'web',
        status: 'Pending',
        payment_status: 'pending',
        hold_expires_at: holdExpiresAt,
        created_at: FieldValue.serverTimestamp(),
      }
      transaction.create(bookingRef, stored)
      transaction.create(bookingRef.collection('activity').doc('0'), {
        booking_id: bookingRef.id,
        action: 'Submit',
        from_status: 'Pending',
        to_status: 'Pending',
        actor: 'guest',
        actor_id: authUid,
        actor_name: String(booking.guest_name),
        at,
        seq: 0,
      })
      return { id: bookingRef.id, status: 'Pending', created_at: at, hold_expires_at: holdExpiresAt }
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error('[availability] submit failed', error instanceof Error ? error.name : 'unknown')
    throw new HttpsError('unavailable', 'The Booking could not be submitted right now. Nothing was saved; please try again.', { cause: 'SUBMIT_UNAVAILABLE' })
  }
})
