/**
 * Five inquiries per IP address per ten minutes, counted in KV.
 * ----------------------------------------------------------------------------
 * What this is: a cheap, free-tier brake on the one endpoint a stranger can
 * reach. A person with a question sends one inquiry; five in ten minutes is
 * already more than a conversation.
 *
 * What this is **not**, and it matters enough to write down:
 *
 *   • **Not atomic.** KV has no compare-and-set. Two requests from one IP that
 *     race — a double-tap, or two colos on opposite sides of the world — can both
 *     read `count = 4` and both write `5`. The overshoot is bounded by how many
 *     requests can actually be in flight at once, and Cloudflare also limits KV
 *     writes to ~1/second per key, which quietly absorbs most bursts. So the
 *     limit is enforced *approximately*, which is enough to stop a form-filler
 *     and not enough to stop a determined attacker. The only exact primitive on
 *     this plan is a Durable Object keyed by IP — one instance, so increments
 *     serialise — and that is the upgrade path if this is ever not enough.
 *   • **A fixed window, not a sliding one.** The window starts at the first
 *     request and is stored with the counter, so its reset is exact (the TTL is
 *     only housekeeping). A caller can therefore send five at 09:59 and five
 *     more at 10:00; with a ten-minute window that burst is ten, not five.
 *     Sliding would need a stored timestamp per hit, which KV's 1-write/second
 *     limit makes unreliable for the same reason.
 *   • **Degradable.** If KV cannot be read, the request is **allowed** and the
 *     reply is marked `X-RateLimit-Degraded: true`. Losing every real inquiry
 *     because a binding broke is worse than being unrated for a minute.
 *
 * None of this makes the form safe on its own — Turnstile and the schema are the
 * boundary, and this is the throttle in front of the inbox.
 */
import type { Env } from './env'

/** The brief's numbers, in one place, so the test and the header agree. */
export const RATE_LIMIT = {
  /** Requests allowed per IP inside one window. */
  max: 5,
  /** The window, in seconds. `Retry-After` reports the whole of it. */
  windowSeconds: 600,
} as const

export type RateDecision =
  | { allowed: true; remaining: number; resetAt: number; degraded: boolean }
  | { allowed: false; retryAfterSeconds: number; resetAt: number; degraded: boolean }

/** What is stored at `rate:<ip>`. `resetAt` is what makes the window exact;
 * the KV TTL is only there to delete the key afterwards. */
type Counter = { count: number; resetAt: number }

/**
 * The client address, as Cloudflare reports it.
 *
 * `cf-connecting-ip` is set by Cloudflare's edge and cannot be spoofed by the
 * caller. `x-forwarded-for` is deliberately **not** read: it is caller-controlled,
 * and trusting it would let one attacker mint a new bucket per request — a rate
 * limiter that reads a header the client chooses is not a rate limiter.
 */
export function clientIp(request: Request): string {
  const raw = (request.headers.get('cf-connecting-ip') ?? '').trim().toLowerCase()
  // A header that is not an address is not a bucket of its own.
  return /^[0-9a-f:.]{3,45}$/.test(raw) ? raw : 'unknown'
}

export function rateKey(ip: string): string {
  return `rate:${ip}`
}

function isCounter(value: unknown): value is Counter {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.count === 'number' && Number.isFinite(record.count)
    && typeof record.resetAt === 'number' && Number.isFinite(record.resetAt)
}

/**
 * Count one request against the window.
 *
 * Pure arithmetic where it can be: `now` is an argument, so the tests are not
 * sleeps. On a refusal the counter is **not** incremented — retrying must not
 * extend a lockout, and an attacker hammering the endpoint should not be able to
 * keep themselves out.
 */
export async function checkRateLimit(
  env: Env,
  ip: string,
  options: { now?: number } = {},
): Promise<RateDecision> {
  const now = options.now ?? Date.now()
  const windowMs = RATE_LIMIT.windowSeconds * 1_000
  const key = rateKey(ip)

  let stored: unknown = null
  try {
    stored = await env.RATE_LIMIT_KV.get(key, 'json')
  } catch (error) {
    // Fail open, loudly. The caller logs this and adds the degraded header.
    console.warn('[rate-limit] KV read failed', error instanceof Error ? error.name : 'unknown')
    return { allowed: true, remaining: RATE_LIMIT.max, resetAt: now + windowMs, degraded: true }
  }

  const current = isCounter(stored) && stored.resetAt > now ? stored : { count: 0, resetAt: now + windowMs }

  if (current.count >= RATE_LIMIT.max) {
    return {
      allowed: false,
      // The brief fixes `Retry-After` at the whole window, and a Guest told "ten
      // minutes" is better served than one told "34 seconds" who then fails again.
      retryAfterSeconds: RATE_LIMIT.windowSeconds,
      resetAt: current.resetAt,
      degraded: false,
    }
  }

  const next: Counter = { count: current.count + 1, resetAt: current.resetAt }
  const ttl = Math.max(60, Math.ceil((current.resetAt - now) / 1_000))
  try {
    await env.RATE_LIMIT_KV.put(key, JSON.stringify(next), { expirationTtl: ttl })
  } catch (error) {
    // The request is still allowed: the counter is a throttle, not a gate, and
    // refusing a real inquiry because a write failed would be the wrong trade.
    console.warn('[rate-limit] KV write failed', error instanceof Error ? error.name : 'unknown')
    return { allowed: true, remaining: Math.max(0, RATE_LIMIT.max - next.count), resetAt: next.resetAt, degraded: true }
  }

  return { allowed: true, remaining: Math.max(0, RATE_LIMIT.max - next.count), resetAt: next.resetAt, degraded: false }
}
