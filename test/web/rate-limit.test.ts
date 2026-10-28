/**
 * The browser's cooldowns.
 *
 * These are UX, not security — the endpoint and `firestore.rules` are the
 * enforcement — so what is asserted is the arithmetic a Guest feels: a sliding
 * window with no minute boundary to step over, a refusal that does not extend
 * itself, and a message that names a wait.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LIMITS,
  checkRateLimit,
  formatCountdown,
  rateLimitKeyCount,
  resetRateLimit,
} from '../../src/lib/rateLimit'
import { guestFacingErrorMessage, rateLimitNotice } from '../../src/lib/firebaseFailure'

const config = { windowMs: 60_000, max: 2, lockMs: 60_000 }

beforeEach(() => resetRateLimit())

describe('sliding window', () => {
  it('allows the budget, refuses the next, and says when the oldest leaves', () => {
    expect(checkRateLimit('k', config, 0)).toMatchObject({ ok: true, remaining: 1 })
    expect(checkRateLimit('k', config, 30_000)).toMatchObject({ ok: true, remaining: 0 })
    const refused = checkRateLimit('k', config, 31_000)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    // The first attempt was at 0, so it leaves at 60,000 — 29 s from 31,000.
    expect(refused.retryAfterMs).toBe(29_000)
    expect(refused.message).toContain('29 seconds')
  })

  it('has no fixed-window boundary to step over', () => {
    expect(checkRateLimit('b', config, 59_500).ok).toBe(true)
    expect(checkRateLimit('b', config, 59_600).ok).toBe(true)
    // A fixed window would reset here and allow a third; a sliding one does not.
    expect(checkRateLimit('b', config, 60_100).ok).toBe(false)
    expect(checkRateLimit('b', config, 119_600).ok).toBe(true)
  })

  it('does not extend its own lockout on every refused retry', () => {
    checkRateLimit('c', config, 0)
    checkRateLimit('c', config, 10)
    const first = checkRateLimit('c', config, 20)
    const second = checkRateLimit('c', config, 21)
    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    if (first.ok || second.ok) return
    expect(second.retryAfterMs).toBeLessThanOrEqual(first.retryAfterMs)
  })

  it('keeps keys apart and forgets one on request', () => {
    checkRateLimit('one', config, 0)
    checkRateLimit('one', config, 0)
    expect(checkRateLimit('one', config, 1).ok).toBe(false)
    expect(checkRateLimit('two', config, 1).ok).toBe(true)

    resetRateLimit('one')
    expect(checkRateLimit('one', config, 2).ok).toBe(true)
  })

  it('bounds the number of keys one tab remembers', () => {
    for (let index = 0; index < 900; index += 1) checkRateLimit(`key-${index}`, { windowMs: 1_000, max: 1 }, 0)
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(512)
  })

  it('has the contact budget the endpoint is described with', () => {
    expect(LIMITS.contact).toMatchObject({ max: 5, windowMs: 60_000 })
  })
})

describe('countdown', () => {
  it('prints seconds under a minute and minutes:seconds above it', () => {
    expect(formatCountdown(0)).toBe('0s')
    expect(formatCountdown(1_500)).toBe('2s')
    expect(formatCountdown(90_000)).toBe('1:30')
    expect(formatCountdown(60_000)).toBe('1:00')
  })
})

describe('reading a paced refusal off a Firebase error', () => {
  const paced = Object.assign(new Error('Too many Booking requests. Wait 45 seconds and try again.'), {
    code: 'functions/resource-exhausted',
    details: { cause: 'RATE_LIMITED', retryAfterSeconds: 45 },
  })

  it('returns the wait and the server’s own sentence', () => {
    expect(rateLimitNotice(paced)).toEqual({
      retryAfterSeconds: 45,
      message: 'Too many Booking requests. Wait 45 seconds and try again.',
    })
  })

  it('is null for everything else, so callers can use it as a first branch', () => {
    expect(rateLimitNotice(new Error('nope'))).toBeNull()
    expect(rateLimitNotice({ code: 'permission-denied', message: 'no' })).toBeNull()
  })

  it('supplies a sentence when the server supplied none', () => {
    const notice = rateLimitNotice({ code: 'resource-exhausted' })
    expect(notice?.retryAfterSeconds).toBe(60)
    expect(notice?.message).toContain('wait 60 seconds')
  })

  it('makes guestFacingErrorMessage repeat the server’s sentence', () => {
    expect(guestFacingErrorMessage(paced)).toBe('Too many Booking requests. Wait 45 seconds and try again.')
  })
})
