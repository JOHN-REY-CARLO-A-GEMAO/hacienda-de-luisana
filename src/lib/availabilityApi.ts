import { httpsCallable } from 'firebase/functions'
import type { CalendarAvailabilityDay } from './booking'
import { functionsClient } from './functionsClient'

export type AvailabilityQuery = {
  accommodation: string
  from: string
  to: string
}

export type AvailabilitySnapshot = AvailabilityQuery & {
  generated_at: string
  days: CalendarAvailabilityDay[]
}

export class AvailabilityUnavailableError extends Error {
  readonly code: string
  readonly cause_code: string

  constructor(code: string, message: string, cause = 'AVAILABILITY_UNKNOWN') {
    super(message)
    this.name = 'AvailabilityUnavailableError'
    this.code = code
    this.cause_code = cause
  }
}

type CallableFailure = { code?: string; message?: string; details?: unknown }
const functionCode = (code: string | undefined) => (code ?? 'unavailable').replace(/^functions\//, '')
const CACHE_MS = 60_000
const MAX_CACHE_ENTRIES = 24
const cache = new Map<string, { at: number; value: AvailabilitySnapshot }>()
const inflight = new Map<string, Promise<AvailabilitySnapshot>>()

function keyOf(input: AvailabilityQuery): string {
  return `${input.accommodation}|${input.from}|${input.to}`
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function validateReply(input: AvailabilityQuery, raw: unknown): AvailabilitySnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AvailabilityUnavailableError('malformed-reply', 'Availability could not be confirmed right now. Please try again.')
  }
  const reply = raw as Partial<AvailabilitySnapshot>
  if (reply.accommodation !== input.accommodation || reply.from !== input.from || reply.to !== input.to
      || typeof reply.generated_at !== 'string' || !Number.isFinite(Date.parse(reply.generated_at))
      || !Array.isArray(reply.days)) {
    throw new AvailabilityUnavailableError('malformed-reply', 'Availability could not be confirmed right now. Please try again.')
  }
  const expected: string[] = []
  for (let cursor = Date.parse(`${input.from}T00:00:00Z`), end = Date.parse(`${input.to}T00:00:00Z`);
       cursor < end; cursor += 86_400_000) {
    expected.push(new Date(cursor).toISOString().slice(0, 10))
  }
  if (reply.days.length !== expected.length) {
    throw new AvailabilityUnavailableError('incomplete-reply', 'Availability could not be confirmed right now. Please try again.')
  }
  const days = reply.days.map((day, index) => {
    if (!day || typeof day !== 'object' || day.date !== expected[index]
        || !['available', 'pending', 'booked'].includes(day.state)) {
      throw new AvailabilityUnavailableError('incomplete-reply', 'Availability could not be confirmed right now. Please try again.')
    }
    return { date: day.date, state: day.state } as CalendarAvailabilityDay
  })
  return { ...input, generated_at: reply.generated_at, days }
}

function friendlyFailure(error: unknown): AvailabilityUnavailableError {
  if (error instanceof AvailabilityUnavailableError) return error
  const failure = error as CallableFailure
  const details = failure.details && typeof failure.details === 'object'
    ? failure.details as { cause?: unknown; message?: unknown }
    : {}
  const code = functionCode(failure.code)
  const serverMessage = typeof details.message === 'string' ? details.message : failure.message
  const message = code === 'resource-exhausted'
    ? (serverMessage || 'Too many availability checks. Wait a moment and try again.')
    : code === 'failed-precondition'
      ? (serverMessage || 'This Accommodation is not accepting online Bookings right now.')
      : 'Availability could not be confirmed right now. Check your connection and try again.'
  return new AvailabilityUnavailableError(
    code,
    message,
    typeof details.cause === 'string' ? details.cause : 'AVAILABILITY_UNKNOWN',
  )
}

/**
 * Fetch a privacy-safe calendar projection. A short cache is shared by repeated
 * renders and focus events; submit checks pass `force: true` and never trust it.
 */
export async function requestBookingAvailability(
  input: AvailabilityQuery,
  options: { force?: boolean } = {},
): Promise<AvailabilitySnapshot> {
  if (!validDate(input.from) || !validDate(input.to)) {
    throw new AvailabilityUnavailableError('invalid-argument', 'Choose a valid calendar range.')
  }
  const key = keyOf(input)
  const saved = cache.get(key)
  if (!options.force && saved && Date.now() - saved.at < CACHE_MS) return saved.value
  // `force` bypasses a saved answer, not an identical request already on the
  // wire. Focus and visibility events can fire together; sharing that read
  // avoids double-counting and inconsistent last-response-wins updates.
  const pending = inflight.get(key)
  if (pending) return pending

  const work = (async () => {
    try {
      const result = await httpsCallable<AvailabilityQuery, unknown>(
        functionsClient(),
        'bookingAvailability',
      )(input)
      const value = validateReply(input, result.data)
      // Month navigation has no reason to retain an unbounded history. Refresh
      // this key's insertion order and evict the oldest projections once the
      // small cross-render cache reaches its cap.
      cache.delete(key)
      cache.set(key, { at: Date.now(), value })
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return value
    } catch (error) {
      throw friendlyFailure(error)
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, work)
  return work
}

export type SubmittedBookingReceipt = {
  id: string
  status: 'Pending'
  created_at: string
  hold_expires_at: string
}

/** Submit through the server transaction that also checks the last unit. */
export async function submitGuestBooking(
  booking: Record<string, unknown>,
): Promise<SubmittedBookingReceipt> {
  try {
    const result = await httpsCallable<
      { booking: Record<string, unknown> },
      SubmittedBookingReceipt
    >(functionsClient(), 'submitBooking')({ booking })
    const reply = result.data
    if (!reply || typeof reply.id !== 'string' || reply.status !== 'Pending'
        || typeof reply.created_at !== 'string' || typeof reply.hold_expires_at !== 'string'
        || !validDate(reply.created_at.slice(0, 10))
        || !Number.isFinite(Date.parse(reply.created_at))
        || !Number.isFinite(Date.parse(reply.hold_expires_at))) {
      throw new AvailabilityUnavailableError('malformed-reply', 'The Booking server returned an incomplete confirmation. Please contact the Hacienda before trying again.')
    }
    clearAvailabilityCache()
    return reply
  } catch (error) {
    if (error instanceof AvailabilityUnavailableError) throw error
    const failure = error as CallableFailure
    const details = failure.details && typeof failure.details === 'object'
      ? failure.details as { cause?: unknown; message?: unknown }
      : {}
    const code = functionCode(failure.code)
    const cause = typeof details.cause === 'string' ? details.cause : code
    const serverMessage = typeof details.message === 'string' ? details.message : failure.message
    const safeServerCauses = new Set([
      'DATE_UNAVAILABLE', 'RATE_SNAPSHOT_STALE', 'PAYMENT_AMOUNT_TOO_LOW', 'QUOTE_REQUIRED',
      'QUOTE_STALE', 'LEAD_TIME', 'ACCOMMODATION_INACTIVE', 'GUEST_COUNT_UNPRICED',
      'NOT_A_STANDARD_STAY', 'REQUEST_SHAPE',
    ])
    const message = safeServerCauses.has(cause) && serverMessage
      ? serverMessage
      : code === 'resource-exhausted' && serverMessage
        ? serverMessage
        : 'The Booking could not be submitted right now. Nothing was saved. Please check your connection and try again.'
    throw new AvailabilityUnavailableError(code, message, cause)
  }
}

export function clearAvailabilityCache(): void {
  cache.clear()
}
