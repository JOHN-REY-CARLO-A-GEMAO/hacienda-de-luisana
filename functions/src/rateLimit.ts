/**
 * Two-tier server-side rate limiting for Cloud Functions callables:
 *
 *   1. `MinuteBudget` (in-memory per instance) runs first as a zero-I/O fast
 *      path, rejecting single-instance request floods in RAM.
 *   2. `takePersistentQuota()` runs an Admin-SDK Firestore transaction against
 *      `callable_rate_limits/{bucketId}` so a caller whose requests land across
 *      multiple warm instances (`maxInstances: 5`) cannot multiply the intended
 *      per-minute ceiling by the instance count.
 *
 * Privacy & storage properties:
 *   - Caller keys (UID or IP) are SHA-256 hashed with `scope` into a flat
 *     document ID (`{scope}_{sha256_32}`), never interpolated raw into paths or
 *     stored in cleartext.
 *   - One document per `(scope, caller)` is overwritten in place when `window`
 *     advances, avoiding per-minute document proliferation while still stamping
 *     `expires_at` (`Date`) for optional Firestore TTL cleanup.
 *   - `callable_rate_limits/{bucketId}` has no `match` block in `firestore.rules`,
 *     so the default-deny catch-all refuses every client read and write.
 */

import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import type { MinuteBudget } from './pricing'

export const CALLABLE_RATE_LIMITS_COLLECTION = 'callable_rate_limits'
const DEFAULT_WINDOW_MS = 60_000
const SAFE_SCOPE_RE = /^[A-Za-z0-9_-]{1,40}$/

export interface PersistentQuotaOptions {
  /** Logical callable / operation scope, e.g. `'submitBooking'` or `'quoteBooking'`. */
  scope: string
  /** Caller identifier (UID or client IP); hashed before touching Firestore. */
  key: string
  /** Authoritative global ceiling across all instances within `windowMs`. */
  limit: number
  /** Fixed window duration in milliseconds (default 60_000). */
  windowMs?: number
  /** Units to consume in this transaction (default 1; >1 when flushing buffered hits). */
  cost?: number
  /** Server timestamp in epoch milliseconds (injectable for deterministic tests). */
  now?: number
  /** Firestore collection holding rate-limit buckets (default `'callable_rate_limits'`). */
  collection?: string
}

export interface PersistentQuotaVerdict {
  ok: boolean
  count: number
  limit: number
  window: number
  retryAfterMs: number
}

/** Deterministic, path-safe, PII-free bucket document ID for `(scope, key)`. */
export function rateLimitBucketId(scope: string, key: string): string {
  if (!SAFE_SCOPE_RE.test(scope)) {
    throw new Error(`Invalid rate-limit scope: ${scope}`)
  }
  const normalizedKey = key.trim() || 'unknown-caller'
  const digest = createHash('sha256').update(`${scope}|${normalizedKey}`).digest('hex').slice(0, 32)
  return `${scope}_${digest}`
}

/**
 * Atomically claim quota from the shared Firestore fixed-window bucket for
 * `(scope, key)`. When the bucket is already at or above `limit`, no write is
 * performed inside the transaction.
 */
export async function takePersistentQuota(
  firestore: Firestore,
  options: PersistentQuotaOptions,
): Promise<PersistentQuotaVerdict> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const now = options.now ?? Date.now()
  const limit = options.limit
  const cost = options.cost ?? 1
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid rate-limit ceiling: ${limit}`)
  }
  if (!Number.isInteger(windowMs) || windowMs < 1_000) {
    throw new Error(`Invalid rate-limit windowMs: ${windowMs}`)
  }
  if (!Number.isInteger(cost) || cost < 1) {
    throw new Error(`Invalid rate-limit cost: ${cost}`)
  }

  const window = Math.floor(now / windowMs)
  const retryAfterMs = Math.max(1, (window + 1) * windowMs - now)
  const collectionName = options.collection ?? CALLABLE_RATE_LIMITS_COLLECTION
  const ref = firestore.collection(collectionName).doc(rateLimitBucketId(options.scope, options.key))

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const stored = snapshot.exists ? snapshot.data() : undefined
    const sameWindow = stored !== undefined
      && stored.window === window
      && Number.isSafeInteger(stored.count)
      && Number(stored.count) >= 0
    const currentCount = sameWindow ? Number(stored!.count) : 0

    if (currentCount >= limit) {
      return { ok: false, count: currentCount, limit, window, retryAfterMs }
    }

    const nextCount = currentCount + cost
    if (nextCount > limit) {
      const bufferedServed = Math.min(limit, currentCount + (cost - 1))
      if (bufferedServed > currentCount) {
        transaction.set(ref, {
          scope: options.scope,
          window,
          count: bufferedServed,
          limit,
          expires_at: new Date((window + 2) * windowMs),
          updated_at: FieldValue.serverTimestamp(),
        })
      }
      return {
        ok: false,
        count: Math.max(currentCount, bufferedServed),
        limit,
        window,
        retryAfterMs,
      }
    }

    transaction.set(ref, {
      scope: options.scope,
      window,
      count: nextCount,
      limit,
      expires_at: new Date((window + 2) * windowMs),
      updated_at: FieldValue.serverTimestamp(),
    })
    return { ok: true, count: nextCount, limit, window, retryAfterMs: 0 }
  })
}

export interface SpendCallableQuotaOptions {
  firestore: Firestore
  budget: MinuteBudget
  scope: string
  key: string
  limit: number
  /**
   * Number of initial requests per minute on an instance served purely from
   * `MinuteBudget` before engaging the Firestore transaction bucket.
   *
   * - `0` (default): every allowed request is coordinated in Firestore so
   *   high-cost write callables (`submitBooking`, `quoteBooking`,
   *   `verifyBookingMoney`) enforce an exact global ceiling across all warm
   *   instances while `MinuteBudget` still stops overflow floods in RAM.
   * - `> 0`: light read traffic stays in-memory (`bookingAvailability`) and
   *   only fires the Firestore transaction once the per-instance share nears
   *   exhaustion, flushing the buffered count on `persistAfter + 1`.
   */
  persistAfter?: number
  now?: number
  label?: string
  formatMessage?: (retryAfterSeconds: number) => string
}

/**
 * Enforce the two-tier rate limit for a callable invocation, throwing a
 * Guest-safe `HttpsError('resource-exhausted', ...)` when exceeded.
 */
export async function spendCallableQuota(options: SpendCallableQuotaOptions): Promise<void> {
  const now = options.now ?? Date.now()
  const persistAfter = options.persistAfter ?? 0
  const messageFor = (retryAfterMs: number) => {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    return options.formatMessage
      ? options.formatMessage(seconds)
      : `Too many ${options.label ?? options.scope} requests. Wait ${seconds} seconds and try again.`
  }

  const local = options.budget.take(options.key, now)
  if (!local.ok) {
    throw new HttpsError('resource-exhausted', messageFor(local.retryAfterMs), {
      cause: 'RATE_LIMITED',
      retry_after_ms: local.retryAfterMs,
    })
  }

  if (persistAfter > 0 && local.count <= persistAfter) {
    return
  }

  const cost = persistAfter > 0 && local.count === persistAfter + 1 ? persistAfter + 1 : 1
  let verdict: PersistentQuotaVerdict
  try {
    verdict = await takePersistentQuota(options.firestore, {
      scope: options.scope,
      key: options.key,
      limit: options.limit,
      cost,
      now,
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error(`[rate-limit] ${options.scope} quota check failed`, error instanceof Error ? error.name : 'unknown')
    throw new HttpsError(
      'unavailable',
      'Service is temporarily busy. Please try again shortly.',
      { cause: 'RATE_LIMIT_UNAVAILABLE' },
    )
  }

  options.budget.observe(
    options.key,
    verdict.ok ? verdict.count : Math.max(verdict.count, options.limit),
    now,
  )

  if (!verdict.ok) {
    throw new HttpsError('resource-exhausted', messageFor(verdict.retryAfterMs), {
      cause: 'RATE_LIMITED',
      retry_after_ms: verdict.retryAfterMs,
    })
  }
}
