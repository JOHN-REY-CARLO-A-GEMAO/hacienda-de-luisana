/**
 * The sliding window the server enforces, without a server.
 *
 * `decide` is pure and every store takes its clock, so these are arithmetic
 * assertions rather than sleeps. The cases are the ones that made the old
 * per-instance `MinuteBudget` insufficient: a boundary that could be stepped
 * over, a window that reset on a cold start, and a refusal that could be turned
 * into a longer lockout by retrying.
 *
 * Run with `npm run test:functions` (from the repository root).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MemorySlidingWindowStore,
  RATE_LIMITS,
  RateLimiter,
  clientIp,
  decide,
  liveHits,
  rateLimitKey,
  rateLimitedMessage,
  retryAfterSeconds,
  type LimitPolicy,
  type SlidingWindowStore,
} from '../src/security/rateLimit'

const policy: LimitPolicy = { name: 'test:window', windowMs: 60_000, max: 2 }

describe('the sliding window', () => {
  it('allows the budget and then refuses with the time until the oldest hit leaves', () => {
    const first = decide(policy, [], 0)
    assert.deepEqual(first.decision, {
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 60_000,
      windowMs: 60_000,
    })

    const second = decide(policy, [0], 30_000)
    assert.equal(second.decision.allowed, true)

    const third = decide(policy, [0, 30_000], 31_000)
    assert.equal(third.decision.allowed, false)
    if (third.decision.allowed) return
    assert.equal(third.decision.retryAfterMs, 29_000)
    assert.equal(third.decision.resetAt, 60_000)
  })

  it('does not record a refused attempt, so retrying cannot extend the lockout', () => {
    const refused = decide(policy, [0, 30_000], 31_000)
    assert.deepEqual(refused.hits, [0, 30_000])
    const again = decide(policy, refused.hits, 32_000)
    assert.equal(again.decision.allowed, false)
    if (again.decision.allowed) return
    assert.ok(again.decision.retryAfterMs <= 29_000)
  })

  it('has no fixed-window boundary to step over', () => {
    // Two hits a second either side of a minute boundary — a fixed window would
    // allow four; the sliding window allows two.
    const atEnd = decide(policy, [], 59_500)
    const atStart = decide(policy, atEnd.hits, 60_100)
    assert.equal(atStart.decision.allowed, true)
  })

  it('drops future, stale and non-numeric entries rather than trusting the document', () => {
    const stored = [0, 30_000, 120_000, 5_000, Number.NaN, -1]
    assert.deepEqual(liveHits(stored, 60_000, 60_000), [5_000, 30_000])
    // A clock that moved backwards must not turn every stored hit into an
    // infinite wait: entries after `now` are ignored.
    assert.deepEqual(liveHits([1_000_000], 0, 60_000), [])
  })

  it('rounds a wait up to whole seconds, never down to zero', () => {
    assert.equal(retryAfterSeconds({ allowed: false, limit: 1, remaining: 0, resetAt: 1, windowMs: 1, retryAfterMs: 200 }), 1)
    assert.equal(retryAfterSeconds({ allowed: false, limit: 1, remaining: 0, resetAt: 1, windowMs: 1, retryAfterMs: 0 }), 1)
    assert.equal(retryAfterSeconds({ allowed: true, limit: 1, remaining: 0, resetAt: 1, windowMs: 1 }), 0)
  })

  it('writes a sentence a Guest can act on', () => {
    const message = rateLimitedMessage('inquiry', {
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: 1,
      windowMs: 1,
      retryAfterMs: 9_400,
    })
    assert.match(message, /Too many inquiry requests/)
    assert.match(message, /10 seconds/)
  })
})

describe('key hashing', () => {
  it('is stable, and separates scopes and salts', () => {
    const first = rateLimitKey('contact:ip', '203.0.113.4', 'salt-a')
    assert.equal(first, rateLimitKey('contact:ip', '203.0.113.4', 'salt-a'))
    assert.notEqual(first, rateLimitKey('contact:email', '203.0.113.4', 'salt-a'))
    assert.notEqual(first, rateLimitKey('contact:ip', '203.0.113.4', 'salt-b'))
    // A document id, and not the address it came from.
    assert.match(first, /^[a-f0-9]{32}$/)
    assert.ok(!first.includes('203.0.113'))
  })
})

describe('client address', () => {
  it('takes the left-most forwarded address, then the Cloudflare header', () => {
    assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }), '203.0.113.4')
    assert.equal(clientIp({ 'cf-connecting-ip': '198.51.100.7' }), '198.51.100.7')
    assert.equal(clientIp({}, '192.0.2.1'), '192.0.2.1')
  })

  it('refuses a header that is not an address, so one caller cannot mint buckets', () => {
    assert.equal(clientIp({ 'x-forwarded-for': 'not-an-ip' }), 'unknown')
    assert.equal(clientIp({ 'x-forwarded-for': 'a'.repeat(4_000) }), 'unknown')
    assert.equal(clientIp({}), 'unknown')
  })
})

describe('the in-memory store', () => {
  it('counts per key and refuses at the limit', async () => {
    const store = new MemorySlidingWindowStore()
    assert.equal((await store.hit('a', policy, 0)).allowed, true)
    assert.equal((await store.hit('a', policy, 1_000)).allowed, true)
    assert.equal((await store.hit('a', policy, 2_000)).allowed, false)
    assert.equal((await store.hit('b', policy, 2_000)).allowed, true)
  })

  it('is bounded, so a flood of keys is not a memory leak', async () => {
    const store = new MemorySlidingWindowStore(8)
    for (let index = 0; index < 100; index += 1) await store.hit(`key-${index}`, policy, 0)
    assert.ok(store.size <= 8, `held ${store.size} keys`)
  })
})

describe('the limiter', () => {
  const failingStore: SlidingWindowStore = {
    kind: 'firestore',
    async hit() {
      throw new Error('firestore unavailable')
    },
  }

  it('falls back to the instance window when the persistent store fails, and says so', async () => {
    const limiter = new RateLimiter({ store: failingStore, now: () => 0 })
    const outcome = await limiter.check('k', policy)
    assert.equal(outcome.allowed, true)
    assert.equal(outcome.degraded, true)
    assert.equal(outcome.store, 'memory')
  })

  it('stops at the first refusal when several budgets apply', async () => {
    const limiter = new RateLimiter({ store: new MemorySlidingWindowStore(), now: () => 0 })
    const tight = { name: 'tight', windowMs: 60_000, max: 1 }
    const loose = { name: 'loose', windowMs: 60_000, max: 10 }
    assert.equal((await limiter.checkAll([{ key: 'x', policy: tight }])).allowed, true)
    const refused = await limiter.checkAll([
      { key: 'x', policy: loose },
      { key: 'x', policy: tight },
      { key: 'x', policy: loose },
    ])
    assert.equal(refused.allowed, false)
    if (refused.allowed) return
    assert.equal(refused.limit, 1)
  })

  it('gives each budget its own window, even for the same identifier', async () => {
    // The bug this guards: two policies on one IP writing the same document and
    // trimming each other's log.
    const limiter = new RateLimiter({ store: new MemorySlidingWindowStore(), now: () => 0 })
    const minute: LimitPolicy = { name: 'contact:ip:1m', windowMs: 60_000, max: 1 }
    const hour: LimitPolicy = { name: 'contact:ip:1h', windowMs: 3_600_000, max: 10 }

    assert.equal((await limiter.check('hashed-ip', minute)).allowed, true)
    // The minute budget is spent; the hour budget has not been touched.
    const hourOutcome = await limiter.check('hashed-ip', hour)
    assert.equal(hourOutcome.allowed, true)
    if (hourOutcome.allowed) assert.equal(hourOutcome.remaining, 9)
    // And the minute budget really is spent.
    assert.equal((await limiter.check('hashed-ip', minute)).allowed, false)
  })

  it('uses one clock for the whole check', async () => {
    let reads = 0
    const limiter = new RateLimiter({ now: () => (reads += 1) })
    const outcome = await limiter.check('k', policy)
    assert.equal(outcome.allowed, true)
    // A limiter that called Date.now() per store would make the two windows
    // disagree about when "now" is.
    assert.equal(reads, 1)
  })
})

describe('the estate’s published budgets', () => {
  it('keeps the contact form tighter than the booking write path', () => {
    assert.equal(RATE_LIMITS.contactPerIpMinute.max, 5)
    assert.ok(RATE_LIMITS.contactPerIpHour.max > RATE_LIMITS.contactPerIpMinute.max)
    assert.ok(RATE_LIMITS.contactPerEmailHour.max <= RATE_LIMITS.contactPerIpHour.max)
    assert.equal(RATE_LIMITS.submitBooking.max, 8)
    assert.ok(RATE_LIMITS.availabilityPerInstance.max >= RATE_LIMITS.submitBooking.max)
  })
})
