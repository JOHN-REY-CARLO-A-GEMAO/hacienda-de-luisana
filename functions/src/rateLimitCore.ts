/**
 * Platform-neutral two-tier rate limiting for the booking callables.
 *
 * `MinuteBudget` runs first in memory; a Firestore transaction then enforces
 * the same fixed-window ceiling across every Cloud Functions instance or
 * Cloudflare isolate. Caller keys are hashed into PII-free bucket IDs, and
 * `callable_rate_limits` remains closed to clients by Firestore's catch-all
 * deny.
 */

import { createHash } from 'node:crypto'
import { CallableError, describeErrorForLog } from './callable'
import { SERVER_TIMESTAMP, type FirestoreLike } from './firestoreLike'
import type { MinuteBudget } from './pricing'

export const CALLABLE_RATE_LIMITS_COLLECTION = 'callable_rate_limits'
const DEFAULT_WINDOW_MS = 60_000
const SAFE_SCOPE_RE = /^[A-Za-z0-9_-]{1,40}$/

export interface PersistentQuotaOptions {
  scope: string
  key: string
  limit: number
  windowMs?: number
  cost?: number
  now?: number
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

export async function takePersistentQuota(
  firestore: FirestoreLike,
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
          updated_at: SERVER_TIMESTAMP,
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
      updated_at: SERVER_TIMESTAMP,
    })
    return { ok: true, count: nextCount, limit, window, retryAfterMs: 0 }
  })
}

export interface SpendCallableQuotaOptions {
  firestore: FirestoreLike
  budget: MinuteBudget
  scope: string
  key: string
  limit: number
  persistAfter?: number
  now?: number
  label?: string
  formatMessage?: (retryAfterSeconds: number) => string
}

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
    throw new CallableError('resource-exhausted', messageFor(local.retryAfterMs), {
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
    if (error instanceof CallableError) throw error
    console.error(`[rate-limit] ${options.scope} quota check failed`, describeErrorForLog(error))
    throw new CallableError(
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
    throw new CallableError('resource-exhausted', messageFor(verdict.retryAfterMs), {
      cause: 'RATE_LIMITED',
      retry_after_ms: verdict.retryAfterMs,
    })
  }
}
