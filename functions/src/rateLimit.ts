/**
 * Firebase-facing wrapper around the platform-neutral rate limiter in
 * `rateLimitCore.ts`.
 *
 * Notification callables still use Admin Firestore and Firebase
 * `HttpsError`s. This wrapper preserves that surface while the booking/quote
 * core (shared with Cloudflare Workers) consumes `FirestoreLike` and
 * `CallableError` directly.
 */

import type { Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { toFirestoreLike } from './adminFirestore'
import { CallableError } from './callable'
import {
  spendCallableQuota as spendCallableQuotaCore,
  takePersistentQuota as takePersistentQuotaCore,
  type PersistentQuotaOptions,
  type PersistentQuotaVerdict,
  type SpendCallableQuotaOptions as CoreSpendCallableQuotaOptions,
} from './rateLimitCore'

export {
  CALLABLE_RATE_LIMITS_COLLECTION,
  rateLimitBucketId,
} from './rateLimitCore'
export type {
  PersistentQuotaOptions,
  PersistentQuotaVerdict,
} from './rateLimitCore'

export interface SpendCallableQuotaOptions
  extends Omit<CoreSpendCallableQuotaOptions, 'firestore'> {
  firestore: Firestore
}

function toHttpsError(error: unknown): unknown {
  return error instanceof CallableError
    ? new HttpsError(error.code as never, error.message, error.details)
    : error
}

export async function takePersistentQuota(
  firestore: Firestore,
  options: PersistentQuotaOptions,
): Promise<PersistentQuotaVerdict> {
  try {
    return await takePersistentQuotaCore(toFirestoreLike(firestore), options)
  } catch (error) {
    throw toHttpsError(error)
  }
}

export async function spendCallableQuota(options: SpendCallableQuotaOptions): Promise<void> {
  try {
    await spendCallableQuotaCore({
      ...options,
      firestore: toFirestoreLike(options.firestore),
    })
  } catch (error) {
    throw toHttpsError(error)
  }
}
