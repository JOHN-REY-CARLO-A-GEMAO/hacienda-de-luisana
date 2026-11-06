/**
 * Firebase bindings for the shared availability/submit core.
 *
 * The privacy-safe projection, Guest Booking shape boundary, transactional
 * last-unit check, and rate limits live in `availabilityCore.ts`. This file
 * supplies Admin Firestore and translates shared `CallableError`s into
 * Firebase `HttpsError`s.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { toFirestoreLike } from './adminFirestore'
import {
  createAvailabilityCore,
  parseAvailabilityRequest as parseAvailabilityRequestCore,
  validateGuestBookingShape as validateGuestBookingShapeCore,
  type AvailabilityCore,
  type AvailabilityReply,
  type AvailabilityRequest,
  type PaymentReferenceStatusReply,
  type SubmitBookingReply,
} from './availabilityCore'
import { CallableError } from './callable'

export type { AvailabilityReply, AvailabilityRequest, PaymentReferenceStatusReply, SubmitBookingReply }

const options = {
  region: 'asia-southeast1',
  maxInstances: 5,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
}

let firestore: ReturnType<typeof getFirestore> | null = null
const db = () => (firestore ??= getFirestore())

let core: AvailabilityCore | null = null
function availabilityCore(): AvailabilityCore {
  return (core ??= createAvailabilityCore({
    db: toFirestoreLike(db()),
    submitLimitPerMinute: Number(process.env.SUBMIT_RATE_LIMIT_PER_MINUTE ?? 8),
  }))
}

function toHttpsError(error: unknown): unknown {
  return error instanceof CallableError
    ? new HttpsError(error.code as never, error.message, error.details)
    : error
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toHttpsError(error)
  }
}

/** Test seam to clear per-instance in-memory rate-limit counters. */
export function resetAvailabilityRateLimits(): void {
  // Do not initialize Firestore merely to clear counters that do not exist.
  core?.resetRateLimits()
}

export function parseAvailabilityRequest(raw: unknown): AvailabilityRequest {
  try {
    return parseAvailabilityRequestCore(raw)
  } catch (error) {
    throw toHttpsError(error)
  }
}

export function validateGuestBookingShape(raw: unknown, authUid: string): Record<string, unknown> {
  try {
    return validateGuestBookingShapeCore(raw, authUid)
  } catch (error) {
    throw toHttpsError(error)
  }
}

export const bookingAvailability = onCall(options, async (request: CallableRequest): Promise<AvailabilityReply> => run(() => availabilityCore().bookingAvailability({
  authUid: request.auth?.uid ?? null,
  data: request.data,
  ip: request.rawRequest?.ip ?? null,
})))

export const submitBooking = onCall(options, async (request: CallableRequest): Promise<SubmitBookingReply> => run(() => availabilityCore().submitBooking({
  authUid: request.auth?.uid ?? null,
  data: request.data,
  ip: request.rawRequest?.ip ?? null,
})))

/**
 * "Has this payment reference already been used?" — asked by the Guest website
 * before it uploads a proof, so a duplicate is a popup rather than a silent
 * second Booking. Advisory; `submitBooking` is the enforcement.
 */
export const paymentReferenceStatus = onCall(options, async (request: CallableRequest): Promise<PaymentReferenceStatusReply> => run(() => availabilityCore().paymentReferenceStatus({
  authUid: request.auth?.uid ?? null,
  data: request.data,
  ip: request.rawRequest?.ip ?? null,
})))
