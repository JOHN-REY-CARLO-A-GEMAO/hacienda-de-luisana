/**
 * Rate limiting that survives an instance — a sliding window, in Firestore.
 * Hacienda de LuisAna
 * ----------------------------------------------------------------------------
 * The limiter that used to be here (`MinuteBudget`, in `pricing.ts`) counted in
 * a `Map` on one Cloud Functions instance. That is a real brake on one warm
 * instance and no brake at all on the estate: Cloud Functions runs several, each
 * starts empty, and an attacker who lands on a fresh one gets the whole allowance
 * again. It also reset every minute — a fixed window lets 2× the limit through
 * across a boundary, which for a login form is exactly the burst that matters.
 *
 * So the budget lives in Firestore, per key, as a *log of timestamps* rather than
 * a counter:
 *
 *   hits = [t1, t2, … ]            (milliseconds, oldest first)
 *   allow if len(hits after dropping t < now - windowMs) < max
 *
 * A sliding window is chosen over a counter for the reason above: at any instant
 * the caller has made at most `max` requests in the last `windowMs`, with no
 * boundary to step over. It costs one document read and (only on an allowed
 * request) one write, which is why it is used for the boundaries where abuse is
 * expensive — a stored document, a minted quote, a Booking — and not for the
 * read-only availability projection, which keeps a per-instance budget.
 *
 * Three properties this file is careful about:
 *
 *   • **Keys are hashed.** An IP address and an email address are personal data.
 *     What is stored is `sha256(salt + scope + identifier)`, so
 *     `rate_limits/{id}` can be read by whoever runs the project without being a
 *     log of who tried to contact the Hacienda. The salt is an env value
 *     (`RATE_LIMIT_SALT`); the default exists so dev and tests need no setup, and
 *     a deployment should set its own.
 *   • **It fails open, loudly.** If Firestore is unavailable, falling back to the
 *     per-instance window is worse than nothing and better than a contact form
 *     that answers 500 for everyone. The fallback is taken, `degraded` is
 *     reported to the handler, and the handler logs it.
 *   • **Nothing grows without bound.** The stored log is trimmed to the window on
 *     every write, `expires_at` is written for a Firestore TTL policy, and the
 *     in-memory fallback evicts stale keys when it is full.
 *
 * No clock of its own: every function takes `now`, so the tests are arithmetic
 * rather than sleep.
 */

import { createHash } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

// ----------------------------------------------------------------------------
// What a limit is
// ----------------------------------------------------------------------------

/** One budget: at most `max` requests per `windowMs`, per key. */
export type LimitPolicy = {
  /** A stable name. It is part of the hashed document id, so two limits on the
   * same IP never share a window. */
  readonly name: string
  readonly windowMs: number
  readonly max: number
}

/**
 * The estate's budgets.
 *
 * The numbers are deliberate, not decorative:
 *
 *   • `contact:*` is the public, unauthenticated form — the only write a
 *     stranger can make — so it is tight per minute and per hour, and tighter
 *     still per address: one person sending three inquiries an hour is a person
 *     with a question; three hundred is a campaign.
 *   • `booking:submit` is 8/minute, unchanged from the budget it replaces: a
 *     Guest submits once, retries twice, gives up and writes an inquiry.
 *   • `booking:quote` is a read-only calculation that the page calls as the
 *     Guest moves through the form, so it is looser than submit and still
 *     bounded.
 *   • `availability` stays on the in-memory budget (see below) because a
 *     calendar that re-renders should not cost a Firestore write.
 *   • `verify:money` is an Admin action; it is here so a leaked Admin session
 *     cannot be used as a free read loop over the rates document.
 */
export const RATE_LIMITS = {
  contactPerIpMinute: { name: 'contact:ip:1m', windowMs: 60_000, max: 5 },
  contactPerIpHour: { name: 'contact:ip:1h', windowMs: 3_600_000, max: 20 },
  contactPerEmailHour: { name: 'contact:email:1h', windowMs: 3_600_000, max: 3 },
  contactPerEmailDay: { name: 'contact:email:24h', windowMs: 86_400_000, max: 10 },
  submitBooking: { name: 'booking:submit:1m', windowMs: 60_000, max: 8 },
  quoteBooking: { name: 'booking:quote:1m', windowMs: 60_000, max: 12 },
  verifyMoney: { name: 'booking:verify:1m', windowMs: 60_000, max: 30 },
  availabilityPerInstance: { name: 'booking:availability:1m', windowMs: 60_000, max: 40 },
} as const satisfies Record<string, LimitPolicy>

/** The outcome of one window, in the shape both an HTTP reply and an
 * `HttpsError` need. */
export type RateLimitDecision =
  | {
      readonly allowed: true
      readonly limit: number
      readonly remaining: number
      readonly resetAt: number
      /** The window the limit is stated over, for `RateLimit-Policy`. */
      readonly windowMs: number
    }
  | {
      readonly allowed: false
      readonly limit: number
      readonly remaining: 0
      readonly resetAt: number
      readonly windowMs: number
      /** Milliseconds until the oldest hit leaves the window. Never negative. */
      readonly retryAfterMs: number
    }

/** A decision plus where it came from, which the caller logs and returns. */
export type RateLimitOutcome = RateLimitDecision & {
  /** True when the persistent store failed and the in-memory window answered. */
  readonly degraded: boolean
  readonly store: 'firestore' | 'memory'
}

// ----------------------------------------------------------------------------
// The arithmetic
// ----------------------------------------------------------------------------

/** Drop everything that has left the window. Never trusts the stored order. */
export function liveHits(hits: readonly number[], now: number, windowMs: number): number[] {
  const floor = now - windowMs
  return hits.filter((at) => Number.isFinite(at) && at > floor && at <= now).sort((a, b) => a - b)
}

/**
 * Decide one request against a window, returning the hits to store.
 *
 * Pure, and the whole of the limiter's behaviour is in this function: the stores
 * below only move arrays in and out of Firestore and memory. A denied request
 * does **not** add a hit — an attacker hammering the endpoint cannot extend their
 * own lockout or pad the document they are already in.
 */
export function decide(
  policy: LimitPolicy,
  storedHits: readonly number[],
  now: number,
): { decision: RateLimitDecision; hits: number[] } {
  const hits = liveHits(storedHits, now, policy.windowMs)
  if (hits.length >= policy.max) {
    const oldest = hits[0] ?? now
    const resetAt = oldest + policy.windowMs
    return {
      decision: {
        allowed: false,
        limit: policy.max,
        remaining: 0,
        resetAt,
        windowMs: policy.windowMs,
        retryAfterMs: Math.max(0, resetAt - now),
      },
      hits,
    }
  }
  hits.push(now)
  return {
    decision: {
      allowed: true,
      limit: policy.max,
      remaining: Math.max(0, policy.max - hits.length),
      resetAt: (hits[0] ?? now) + policy.windowMs,
      windowMs: policy.windowMs,
    },
    hits,
  }
}

/** `Retry-After` is in whole seconds, and a zero would invite an instant retry. */
export function retryAfterSeconds(decision: RateLimitDecision): number {
  if (decision.allowed) return 0
  return Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
}

/** The sentence a Guest reads. It names the wait, because "try later" is not an
 * instruction. */
export function rateLimitedMessage(label: string, decision: RateLimitDecision): string {
  if (decision.allowed) return ''
  const seconds = retryAfterSeconds(decision)
  return `Too many ${label} requests from here. Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`
}

// ----------------------------------------------------------------------------
// Key hashing
// ----------------------------------------------------------------------------

const DEFAULT_SALT = 'hacienda-de-luisana:rate-limit:v1'

/**
 * The document id for one key: a truncated SHA-256 of salt, scope and value.
 *
 * Truncated to 32 hex characters because a document id is a path segment and 128
 * bits of a hash is already far more than enough to make a collision unreachable.
 */
export function rateLimitKey(scope: string, identifier: string, salt = process.env.RATE_LIMIT_SALT || DEFAULT_SALT): string {
  return createHash('sha256').update(`${salt}|${scope}|${identifier}`).digest('hex').slice(0, 32)
}

/**
 * The IP a request came from, as far as this deployment can tell.
 *
 * Cloud Run puts the client address at the left of `X-Forwarded-For`; Cloudflare
 * puts it in `CF-Connecting-IP`. Only a syntactically plausible address is
 * accepted — a header carrying a sentence or a 4 KB string becomes `unknown`
 * rather than a document id of its own, which would otherwise let one caller
 * mint unlimited buckets by sending a different header each time.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback?: string): string {
  const first = (value: string | string[] | undefined): string => {
    const raw = Array.isArray(value) ? value[0] : value
    return (raw ?? '').split(',')[0]?.trim() ?? ''
  }
  const candidate =
    first(headers['cf-connecting-ip']) ||
    first(headers['x-real-ip']) ||
    first(headers['x-forwarded-for']) ||
    (fallback ?? '').trim()
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate.toLowerCase() : 'unknown'
}

// ----------------------------------------------------------------------------
// Stores
// ----------------------------------------------------------------------------

/** Where a window is kept. Two implementations, one interface, one test each. */
export interface SlidingWindowStore {
  readonly kind: 'firestore' | 'memory'
  /** Record one hit (or refuse) and return the window as it stands. */
  hit(key: string, policy: LimitPolicy, now: number): Promise<RateLimitDecision>
}

/**
 * A window in this instance's memory.
 *
 * Used as the fallback when Firestore cannot answer, and as the primary store for
 * the read-only availability projection. Not shared between instances, which is
 * exactly why it is not the primary store for anything that writes.
 */
export class MemorySlidingWindowStore implements SlidingWindowStore {
  readonly kind = 'memory' as const
  private readonly windows = new Map<string, number[]>()

  constructor(private readonly maxKeys = 4096) {}

  async hit(key: string, policy: LimitPolicy, now: number): Promise<RateLimitDecision> {
    // Bound the map before adding: under a flood the keys are the flood, and an
    // unbounded Map is the memory leak the limitation audit found in the old
    // budget.
    if (this.windows.size >= this.maxKeys && !this.windows.has(key)) {
      for (const [candidate, hits] of this.windows) {
        if (liveHits(hits, now, policy.windowMs).length === 0) this.windows.delete(candidate)
      }
      if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value as string)
    }
    const { decision, hits } = decide(policy, this.windows.get(key) ?? [], now)
    // A denied request keeps the window it was denied against: rewriting it would
    // be a write per attack request for no gain.
    if (decision.allowed || !this.windows.has(key)) this.windows.set(key, hits)
    return decision
  }

  /** Test seam: how much state this instance is carrying. */
  get size(): number {
    return this.windows.size
  }
}

/** The collection the windows live in. Admin-only: no client rule grants it. */
export const RATE_LIMIT_COLLECTION = 'rate_limits'

/**
 * A window in Firestore, shared by every instance.
 *
 * A transaction, because two instances answering the same key at once must not
 * both see `max - 1` hits and both allow the last slot. The document is small
 * (at most `max` numbers), the read is by id, and it is written only when the
 * request is allowed.
 */
export class FirestoreSlidingWindowStore implements SlidingWindowStore {
  readonly kind = 'firestore' as const

  constructor(
    private readonly db: () => ReturnType<typeof getFirestore> = () => getFirestore(),
    private readonly collection = RATE_LIMIT_COLLECTION,
  ) {}

  async hit(key: string, policy: LimitPolicy, now: number): Promise<RateLimitDecision> {
    const ref = this.db().collection(this.collection).doc(key)
    return this.db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const stored = snapshot.exists ? snapshot.data()?.hits : []
      const hits = Array.isArray(stored) ? stored.filter((value): value is number => typeof value === 'number') : []
      const { decision, hits: next } = decide(policy, hits, now)
      if (decision.allowed) {
        transaction.set(
          ref,
          {
            hits: next,
            scope: policy.name,
            // A Firestore TTL policy on `expires_at` is what deletes the document
            // afterwards. It is not required for correctness — a stale window is
            // filtered by `liveHits` — it is how the collection stays small.
            expires_at: new Date(now + policy.windowMs + 60_000),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
      return decision
    })
  }
}

// ----------------------------------------------------------------------------
// The limiter the handlers use
// ----------------------------------------------------------------------------

export type LimiterOptions = {
  readonly store?: SlidingWindowStore
  readonly fallback?: SlidingWindowStore
  /** Called when the primary store fails, so the failure is logged once with
   * context rather than being swallowed. */
  readonly onStoreError?: (error: unknown, policy: LimitPolicy) => void
  readonly now?: () => number
}

/**
 * One limiter, two stores: the authoritative window and the one that answers when
 * it cannot be read.
 *
 * `degraded` is part of the reply rather than a console line only: the contact
 * endpoint adds `X-RateLimit-Degraded: true` and the log record carries it, so an
 * operator can see that the Firestore window is not the thing currently
 * protecting the form.
 */
export class RateLimiter {
  private readonly store: SlidingWindowStore
  private readonly fallback: SlidingWindowStore
  private readonly onStoreError?: (error: unknown, policy: LimitPolicy) => void
  private readonly clock: () => number

  constructor(options: LimiterOptions = {}) {
    this.store = options.store ?? new FirestoreSlidingWindowStore()
    this.fallback = options.fallback ?? new MemorySlidingWindowStore()
    this.onStoreError = options.onStoreError
    this.clock = options.now ?? Date.now
  }

  async check(key: string, policy: LimitPolicy): Promise<RateLimitOutcome> {
    const now = this.clock()
    // The window is keyed by identity **and budget**. Without the policy name in
    // the id, "5 a minute from this IP" and "20 an hour from this IP" would write
    // the same `rate_limits/{id}` document, each trimming the other's log to a
    // different window — the minute check would silently enforce the hour budget
    // as well, and the hour check would lose the history it needs. Two budgets on
    // one address are two windows, not one.
    const windowKey = rateLimitKey(policy.name, key)
    try {
      const decision = await this.store.hit(windowKey, policy, now)
      return { ...decision, degraded: false, store: this.store.kind }
    } catch (error) {
      this.onStoreError?.(error, policy)
      const decision = await this.fallback.hit(windowKey, policy, now)
      return { ...decision, degraded: true, store: this.fallback.kind }
    }
  }

  /**
   * Check several budgets at once, stopping at the first refusal.
   *
   * The contact endpoint has four (per-IP minute, per-IP hour, per-email hour,
   * per-email day) and the Guest should be told about the tightest one they hit,
   * not have the reply depend on the order the checks happened to run in. The
   * first refusal wins, which is also the smallest wait in practice.
   */
  async checkAll(entries: readonly { key: string; policy: LimitPolicy }[]): Promise<RateLimitOutcome> {
    let last: RateLimitOutcome | null = null
    for (const entry of entries) {
      const outcome = await this.check(entry.key, entry.policy)
      last = outcome
      if (!outcome.allowed) return outcome
    }
    return last ?? { allowed: true, limit: 0, remaining: 0, resetAt: this.clock(), windowMs: 0, degraded: false, store: this.store.kind }
  }
}

/**
 * The process-wide limiter for callables that write.
 *
 * A module-level singleton on purpose: an instance that re-created its store per
 * request would have no fallback worth the name.
 */
let shared: RateLimiter | null = null

export function sharedRateLimiter(): RateLimiter {
  return (shared ??= new RateLimiter({
    onStoreError: (error, policy) => {
      // No import of the logger here: this module is also compiled into tests
      // that run without the Functions runtime. Console is what the handler's
      // log record repeats with request context.
      console.error(`[rate-limit] ${policy.name}: persistent store unavailable, using the in-memory window`, error instanceof Error ? error.name : 'unknown')
    },
  }))
}

/** The per-instance limiter for the read-only availability projection. */
const memoryLimiter = new RateLimiter({
  store: new MemorySlidingWindowStore(),
  fallback: new MemorySlidingWindowStore(),
})

export function instanceRateLimiter(): RateLimiter {
  return memoryLimiter
}
