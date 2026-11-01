/**
 * Firebase bindings for the shared money-attestation core.
 *
 * All pricing, authorization, and rate-limit behaviour lives in
 * `quotesCore.ts`, which the Cloudflare Worker also hosts. This file only
 * supplies the Admin SDK transports and translates `CallableError` into
 * Firebase's `HttpsError`.
 */

import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { toFirestoreLike } from './adminFirestore'
import { CallableError } from './callable'
import { createQuotesCore, type QuotesCore } from './quotesCore'

const options = { region: 'asia-southeast1', maxInstances: 5, memory: '512MiB' as const, timeoutSeconds: 60 }

/**
 * Lazily resolved, because `index.ts` — the deployed entry point — calls
 * `initializeApp()` after its imports.
 */
let firestore: ReturnType<typeof getFirestore> | null = null
const db = () => (firestore ??= getFirestore())

let core: QuotesCore | null = null
function quotesCore(): QuotesCore {
  return (core ??= createQuotesCore({
    db: toFirestoreLike(db()),
    authUsers: {
      getUser: (uid) => getAuth().getUser(uid),
    },
    quotesEnabled: process.env.BOOKING_QUOTES_ENABLED === 'true' || process.env.FUNCTIONS_EMULATOR === 'true',
    quoteTtlMinutes: Number(process.env.QUOTE_TTL_MINUTES ?? 30),
    quoteLimitPerMinute: Number(process.env.QUOTE_RATE_LIMIT_PER_MINUTE ?? 12),
    verifyLimitPerMinute: Number(process.env.VERIFY_RATE_LIMIT_PER_MINUTE ?? 30),
  }))
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CallableError) {
      throw new HttpsError(error.code as never, error.message, error.details)
    }
    throw error
  }
}

/** Test seam to clear per-instance in-memory rate-limit counters. */
export function resetQuoteRateLimits(): void {
  // Do not initialize Firestore merely to clear counters that do not exist.
  core?.resetRateLimits()
}

export const quoteBooking = onCall(options, async (request: CallableRequest) => run(() => quotesCore().quoteBooking({
  authUid: request.auth?.uid ?? null,
  data: request.data,
  ip: request.rawRequest?.ip ?? null,
})))

export const verifyBookingMoney = onCall(options, async (request: CallableRequest) => run(() => quotesCore().verifyBookingMoney({
  authUid: request.auth?.uid ?? null,
  data: request.data,
  ip: request.rawRequest?.ip ?? null,
})))
