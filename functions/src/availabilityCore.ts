/**
 * Privacy-safe Booking availability and the authoritative Guest submit
 * boundary, independent of the hosting runtime.
 *
 * `bookingAvailability` projects private Booking documents into one state per
 * overnight date. `submitBooking` repeats the authoritative checks inside the
 * transaction that creates the Pending Booking and its first Activity entry.
 * Firestore `bookings` remains the sole availability source; the property
 * revision document only serializes concurrent submissions around an empty
 * overlap query.
 */

import { CallableError, describeErrorForLog, type CallableContext } from './callable'
import {
  SERVER_TIMESTAMP,
  type DocumentData,
  type FirestoreLike,
} from './firestoreLike'
import {
  calendarAvailability,
  findDateConflicts,
  type CalendarAvailabilityDay,
  type HoldBearingBooking,
} from './booking/availability'
import {
  deriveQuote,
  MinuteBudget,
  moneyMismatches,
  parseQuoteRequest,
  type QuoteRequest,
} from './pricing'
import { spendCallableQuota } from './rateLimitCore'

const DAY_MS = 86_400_000
const DATE_HOLD_MS = DAY_MS
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CALENDAR_DAYS = 62
const CANONICAL_ACCOMMODATIONS = ['main-house', 'annex', 'house-a-camping'] as const

export interface AvailabilityCoreDependencies {
  db: FirestoreLike
  availabilityLimitPerMinute?: number
  availabilityPersistAfter?: number
  submitLimitPerMinute?: number
}

export interface AvailabilityRequest {
  accommodation: string
  from: string
  to: string
}

export interface AvailabilityReply {
  accommodation: string
  from: string
  to: string
  generated_at: string
  days: CalendarAvailabilityDay[]
}

export interface SubmitBookingReply {
  id: string
  status: 'Pending'
  created_at: string
  hold_expires_at: string
}

export interface AvailabilityCore {
  bookingAvailability(context: CallableContext): Promise<AvailabilityReply>
  submitBooking(context: CallableContext): Promise<SubmitBookingReply>
  resetRateLimits(): void
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : fallback
}

function callableKey(context: CallableContext): string {
  return context.authUid || context.ip || 'unknown-caller'
}

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null
}

/** Strict, bounded input parser; exported as a pure test seam. */
export function parseAvailabilityRequest(raw: unknown): AvailabilityRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CallableError('invalid-argument', 'An Accommodation and calendar range are required.')
  }
  const input = raw as DocumentData
  const accommodation = typeof input.accommodation === 'string' ? input.accommodation : ''
  if (!CANONICAL_ACCOMMODATIONS.includes(accommodation as (typeof CANONICAL_ACCOMMODATIONS)[number])) {
    throw new CallableError('invalid-argument', 'Choose a bookable Accommodation.')
  }
  const from = typeof input.from === 'string' ? input.from : ''
  const to = typeof input.to === 'string' ? input.to : ''
  const start = dateMs(from)
  const end = dateMs(to)
  if (start === null || end === null || end <= start) {
    throw new CallableError('invalid-argument', 'Choose a valid calendar range.')
  }
  const days = Math.round((end - start) / DAY_MS)
  if (days > MAX_CALENDAR_DAYS) {
    throw new CallableError('invalid-argument', `Calendar requests may cover at most ${MAX_CALENDAR_DAYS} days.`)
  }
  return { accommodation, from, to }
}

function dateOnly(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
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
  if (value instanceof Date) return value.toISOString()
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
  const accommodations = rates?.accommodations as DocumentData | undefined
  const node = accommodations?.[accommodation] as DocumentData | undefined
  if (!node || node.active === false) return null
  const published = node.available_units
  return Number.isInteger(published) && Number(published) > 0 ? Number(published) : null
}

function availabilityFailure(message = 'Availability cannot be confirmed right now. Please try again.'): CallableError {
  return new CallableError('unavailable', message, { cause: 'AVAILABILITY_UNKNOWN' })
}

function assertUsableProjectionRecords(bookings: readonly HoldBearingBooking[]): void {
  const corrupt = bookings.some((booking) => {
    const checkIn = dateMs(booking.check_in)
    const checkOut = dateMs(booking.check_out)
    return booking.accommodation === '' || checkIn === null || checkOut === null || checkOut <= checkIn
  })
  if (corrupt) throw availabilityFailure()
}

async function overlappingBookings(db: FirestoreLike, input: AvailabilityRequest): Promise<HoldBearingBooking[]> {
  const snapshot = await db
    .collection('bookings')
    .where('accommodation', '==', input.accommodation)
    .where('check_out', '>', input.from)
    .where('check_in', '<', input.to)
    .get()
  const bookings = snapshot.docs.map((document) => holdBearing(document.id, document.data()))
  assertUsableProjectionRecords(bookings)
  return bookings
}

// ---------------------------------------------------------------------------
// Authoritative Pending Booking creation
// ---------------------------------------------------------------------------

const ALLOWED_BOOKING_KEYS = new Set([
  'guest_name', 'phone', 'email', 'check_in', 'check_out', 'guests', 'accommodation',
  'special_requests', 'pet_count', 'pet_request', 'late_checkout_hours',
  'late_checkout_request', 'bonfire_wood_sets', 'event_purpose', 'event_purpose_detail',
  'uid', 'source', 'payment_proof_url', 'paymentProofUrl', 'payment_plan',
  'payment_status', 'amount_claimed', 'payment_reference', 'extractedRefNumber',
  'ocr_reference', 'ocr_amount', 'ocr_sender_name', 'ocr_payment_date',
  'ocr_proof_url', 'ocr_engine', 'ocr_confidence',
  'nights', 'stay_total', 'amount_due', 'security_deposit', 'balance_due',
  'rate_amount', 'rate_unit', 'rate_classification', 'policy_version',
  'policy_effective_date', 'refund_policy_snapshot', 'quote_id',
  'terms_version', 'terms_accepted_at',
])

function requireString(
  input: DocumentData,
  key: string,
  options: { min?: number; max: number; optional?: boolean },
): string {
  const value = input[key]
  if (options.optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string') throw new CallableError('invalid-argument', `The Booking ${key} is invalid.`)
  const trimmed = value.trim()
  if (trimmed.length < (options.min ?? 0) || trimmed.length > options.max) {
    throw new CallableError('invalid-argument', `The Booking ${key} is invalid.`)
  }
  return value
}

function validPendingRequest(value: unknown, kind: 'pet' | 'late'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as DocumentData
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
 * Validate the non-price shape before a privileged server-side write.
 * Firestore rules do not run for service-account writes, so every
 * client-controlled field needs an explicit boundary here.
 */
export function validateGuestBookingShape(raw: unknown, authUid: string): DocumentData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CallableError('invalid-argument', 'Booking details are required.')
  }
  const input = raw as DocumentData
  if (Object.keys(input).some((key) => !ALLOWED_BOOKING_KEYS.has(key))) {
    throw new CallableError('invalid-argument', 'The Booking contains an unsupported field.')
  }
  if (input.uid !== authUid) throw new CallableError('permission-denied', 'The Booking identity does not match this session.')
  if (input.source !== 'web') throw new CallableError('invalid-argument', 'Only website Bookings use this submit operation.')
  requireString(input, 'guest_name', { min: 2, max: 160 })
  requireString(input, 'phone', { min: 7, max: 40 })
  requireString(input, 'email', { min: 3, max: 254 })
  requireString(input, 'special_requests', { max: 5000 })
  const proof = requireString(input, 'payment_proof_url', { min: 1, max: 1000 })
  const proofAlias = requireString(input, 'paymentProofUrl', { min: 1, max: 1000 })
  if (proof !== proofAlias) throw new CallableError('invalid-argument', 'The Payment proof path is inconsistent.')
  if (input.payment_status !== 'pending' || input.payment_plan !== 'down-payment') {
    throw new CallableError('invalid-argument', 'A new Booking must carry a pending down payment.')
  }
  if (typeof input.amount_claimed !== 'number' || !Number.isFinite(input.amount_claimed) || input.amount_claimed <= 0) {
    throw new CallableError('invalid-argument', 'Enter the amount shown on the Payment proof.')
  }
  if (input.payment_reference !== undefined) requireString(input, 'payment_reference', { max: 200, optional: true })
  if (input.extractedRefNumber !== undefined) requireString(input, 'extractedRefNumber', { max: 40, optional: true })
  if (input.ocr_reference !== undefined) requireString(input, 'ocr_reference', { max: 40, optional: true })
  if (input.ocr_amount !== undefined) {
    const value = requireString(input, 'ocr_amount', { max: 16, optional: true })
    if (value && !/^\d+(\.\d{1,2})?$/.test(value)) {
      throw new CallableError('invalid-argument', 'The Booking ocr_amount is invalid.')
    }
  }
  if (input.ocr_sender_name !== undefined) requireString(input, 'ocr_sender_name', { max: 160, optional: true })
  if (input.ocr_payment_date !== undefined) {
    const value = requireString(input, 'ocr_payment_date', { max: 10, optional: true })
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new CallableError('invalid-argument', 'The Booking ocr_payment_date is invalid.')
    }
  }
  if (input.ocr_proof_url !== undefined) requireString(input, 'ocr_proof_url', { max: 1000, optional: true })
  if (input.ocr_engine !== undefined) requireString(input, 'ocr_engine', { max: 40, optional: true })
  if (input.ocr_confidence !== undefined
      && !['high', 'low', 'none'].includes(typeof input.ocr_confidence === 'string' ? input.ocr_confidence : '')) {
    throw new CallableError('invalid-argument', 'The Booking ocr_confidence is invalid.')
  }
  if (input.event_purpose !== undefined) requireString(input, 'event_purpose', { max: 80, optional: true })
  if (input.event_purpose_detail !== undefined) requireString(input, 'event_purpose_detail', { max: 500, optional: true })
  for (const key of ['pet_count', 'late_checkout_hours', 'bonfire_wood_sets']) {
    const value = input[key]
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 20)) {
      throw new CallableError('invalid-argument', `The Booking ${key} is invalid.`)
    }
  }
  if (input.pet_request !== undefined && !validPendingRequest(input.pet_request, 'pet')) {
    throw new CallableError('invalid-argument', 'The pet request is invalid.')
  }
  if (input.late_checkout_request !== undefined && !validPendingRequest(input.late_checkout_request, 'late')) {
    throw new CallableError('invalid-argument', 'The late-checkout request is invalid.')
  }
  return input
}

function quoteExpiryMs(quote: DocumentData): number {
  if (typeof quote.expires_at_ms === 'number') return quote.expires_at_ms
  const value = quote.expires_at
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    if (typeof timestamp.seconds === 'number') return timestamp.seconds * 1000
  }
  return Date.parse(String(value ?? ''))
}

function quoteDocumentMatches(
  quote: DocumentData | undefined,
  booking: DocumentData,
  request: QuoteRequest,
  authUid: string,
  now: number,
): boolean {
  if (!quote || quote.bound_uid !== authUid) return false
  const expiry = quoteExpiryMs(quote)
  if (!Number.isFinite(expiry) || expiry <= now) return false
  return moneyMismatches(booking, {
    request,
    money: {
      rate_unit: quote.rate_unit as 'standard_stay',
      rate_amount: quote.rate_amount as number,
      rate_classification: quote.rate_classification as never,
      nights: quote.nights as number,
      stay_total: quote.stay_total as number,
      amount_due: quote.amount_due as number,
      balance_due: quote.balance_due as number,
      security_deposit: quote.security_deposit as number,
      payment_plan: quote.payment_plan as 'down-payment',
      policy_version: quote.policy_version as string,
      policy_effective_date: quote.policy_effective_date as string,
      refund_policy_snapshot: (quote.refund_policy_snapshot ?? null) as never,
    },
  }).length === 0
}

export function createAvailabilityCore(deps: AvailabilityCoreDependencies): AvailabilityCore {
  const availabilityLimit = positiveInteger(deps.availabilityLimitPerMinute, 40)
  const availabilityPersistAfter = deps.availabilityPersistAfter ?? 6
  const submitLimit = positiveInteger(deps.submitLimitPerMinute, 8)
  const availabilityBudget = new MinuteBudget(availabilityLimit)
  const submitBudget = new MinuteBudget(submitLimit)

  async function bookingAvailability(context: CallableContext): Promise<AvailabilityReply> {
    const input = parseAvailabilityRequest(context.data)
    await spendCallableQuota({
      firestore: deps.db,
      budget: availabilityBudget,
      scope: 'bookingAvailability',
      key: callableKey(context),
      limit: availabilityLimit,
      persistAfter: availabilityPersistAfter,
      label: 'availability',
    })
    try {
      const [ratesDocument, bookings] = await Promise.all([
        deps.db.doc('site_config/rates').get(),
        overlappingBookings(deps.db, input),
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
      if (error instanceof CallableError) throw error
      console.error('[availability] read failed', describeErrorForLog(error))
      throw availabilityFailure()
    }
  }

  async function submitBooking(context: CallableContext): Promise<SubmitBookingReply> {
    const authUid = context.authUid ?? ''
    if (!authUid) throw new CallableError('unauthenticated', 'Reconnect your Guest session before submitting the Booking.')
    const body = context.data && typeof context.data === 'object' && !Array.isArray(context.data)
      ? context.data as DocumentData
      : {}
    const booking = validateGuestBookingShape(body.booking, authUid)
    const parsed = parseQuoteRequest(booking)
    if (!parsed.ok) {
      throw new CallableError(parsed.status as CallableError['code'], parsed.guestMessage, { cause: parsed.cause })
    }
    await spendCallableQuota({
      firestore: deps.db,
      budget: submitBudget,
      scope: 'submitBooking',
      key: authUid,
      limit: submitLimit,
      label: 'Booking',
    })

    const bookingRef = deps.db.collection('bookings').doc()
    const inventoryLockRef = deps.db.collection('booking_inventory_locks').doc(parsed.value.accommodation)
    try {
      return await deps.db.runTransaction(async (transaction) => {
        const now = Date.now()
        const at = new Date(now).toISOString()
        const holdExpiresAt = new Date(now + DATE_HOLD_MS).toISOString()
        const ratesRef = deps.db.doc('site_config/rates')
        const configRef = deps.db.doc('site_config/booking')

        const ratesSnapshot = await transaction.get(ratesRef)
        const configSnapshot = await transaction.get(configRef)
        const rates = ratesSnapshot.exists ? ratesSnapshot.data() : null
        const config = configSnapshot.exists ? configSnapshot.data() : null
        const derived = deriveQuote(rates, parsed.value, { now, bookingConfig: config })
        if (!derived.ok) {
          throw new CallableError(derived.status as CallableError['code'], derived.guestMessage, { cause: derived.cause })
        }

        const normalizedForMoney = {
          ...booking,
          pet_count: booking.pet_count ?? 0,
          late_checkout_hours: booking.late_checkout_hours ?? 0,
        }
        const mismatches = moneyMismatches(normalizedForMoney, derived.quote)
        if (mismatches.length > 0) {
          throw new CallableError(
            'failed-precondition',
            'The published rate changed while you were booking. Return to Stay details and review the current quote.',
            { cause: 'RATE_SNAPSHOT_STALE' },
          )
        }
        if (Number(booking.amount_claimed) < derived.quote.money.amount_due) {
          throw new CallableError('failed-precondition', 'The Payment proof does not cover the current down payment.', { cause: 'PAYMENT_AMOUNT_TOO_LOW' })
        }

        const quoteRequired = config?.quotes_required === true
        const quoteId = typeof booking.quote_id === 'string' ? booking.quote_id : ''
        if (quoteRequired || quoteId) {
          if (!/^[a-f0-9]{32}$/.test(quoteId)) {
            throw new CallableError('failed-precondition', 'The confirmed price expired. Return to Stay details and try again.', { cause: 'QUOTE_REQUIRED' })
          }
          const quoteSnapshot = await transaction.get(deps.db.doc(`booking_quotes/${quoteId}`))
          if (!quoteDocumentMatches(quoteSnapshot.data(), normalizedForMoney, parsed.value, authUid, now)) {
            throw new CallableError('failed-precondition', 'The confirmed price expired or no longer matches this stay. Return to Stay details and try again.', { cause: 'QUOTE_STALE' })
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
        const rivalsQuery = deps.db.collection('bookings')
          .where('accommodation', '==', parsed.value.accommodation)
          .where('check_out', '>', parsed.value.check_in)
          .where('check_in', '<', parsed.value.check_out)
        const rivalsSnapshot = await transaction.get(rivalsQuery)
        const rivals = rivalsSnapshot.docs.map((document) => holdBearing(document.id, document.data()))
        assertUsableProjectionRecords(rivals)
        const conflicts = findDateConflicts(parsed.value, rivals, { unitsAvailable: units, now })
        if (conflicts.length > 0) {
          throw new CallableError(
            'already-exists',
            'Those dates were just held by another Booking. Choose a different check-in date.',
            { cause: 'DATE_UNAVAILABLE' },
          )
        }

        transaction.set(inventoryLockRef, {
          revision: currentRevision + 1,
          updated_at: SERVER_TIMESTAMP,
        })
        const stored: DocumentData = {
          ...booking,
          uid: authUid,
          source: 'web',
          status: 'Pending',
          payment_status: 'pending',
          hold_expires_at: holdExpiresAt,
          created_at: SERVER_TIMESTAMP,
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
        return { id: bookingRef.id, status: 'Pending' as const, created_at: at, hold_expires_at: holdExpiresAt }
      })
    } catch (error) {
      if (error instanceof CallableError) throw error
      console.error('[availability] submit failed', describeErrorForLog(error))
      throw new CallableError('unavailable', 'The Booking could not be submitted right now. Nothing was saved; please try again.', { cause: 'SUBMIT_UNAVAILABLE' })
    }
  }

  return {
    bookingAvailability,
    submitBooking,
    resetRateLimits() {
      availabilityBudget.reset()
      submitBudget.reset()
    },
  }
}
