/**
 * Client-side cooldowns — for the Guest's sake, not the estate's.
 * ----------------------------------------------------------------------------
 * Everything in this file runs in the browser, so everything in it is
 * *advisory*: a person with the console open can delete the Map and call again,
 * and no server anywhere should believe it happened. It exists so that the
 * ordinary mistakes — double-tapping a submit, retrying a password three times
 * with a typo — are answered instantly with a countdown instead of spending a
 * request to be refused later.
 *
 * The window is sliding, not fixed. A fixed window is easier to write and lets a
 * caller spend the whole budget at 12:00:59 and the whole budget again at
 * 12:01:00 — twice the limit in one second, which is exactly the burst the limit
 * was meant to stop. Here the timestamps of the last `max` attempts are kept and
 * an attempt is allowed only if the oldest of them has left the window.
 *
 * The real limits are elsewhere, and they are not bug-for-bug identical to these
 * on purpose — the server sets its own ceilings (see
 * `functions/src/security/rateLimit.ts`) and enforces the ones that matter:
 * `firestore.rules` for what may be written, Cloud Functions for how often, and
 * Firebase Auth's own brute-force protection for sign-in. This module must never
 * be described as the thing protecting the estate.
 */

type Window = {
  /** Timestamps of the attempts still inside the window, oldest first. */
  hits: number[]
  /** Set when a refusal earned a lockout; the window is not consulted until then. */
  lockedUntil: number
}

/** How many keys one tab remembers. A Map that grows per booking is a leak. */
const MAX_KEYS = 512

const windows = new Map<string, Window>()

export type RateLimitConfig = {
  windowMs: number
  max: number
  /** An extra hold-off after the budget is spent. A slow-down, not a ban. */
  lockMs?: number
}

/**
 * The website's budgets.
 *
 * These are the same shapes the server uses, and the numbers are chosen so the
 * server is never asking for fewer attempts than the page allows — a page that
 * refuses before the server would is a page hiding a working feature.
 */
export const LIMITS = {
  login: { windowMs: 60_000, max: 5, lockMs: 60_000 },
  reset: { windowMs: 60_000, max: 3, lockMs: 120_000 },
  /** The public inquiry form: the server allows 5 a minute per IP. */
  contact: { windowMs: 60_000, max: 5, lockMs: 60_000 },
  booking: { windowMs: 60_000, max: 4, lockMs: 30_000 },
  payment: { windowMs: 60_000, max: 5, lockMs: 30_000 },
  ocr: { windowMs: 60_000, max: 8, lockMs: 20_000 },
  chat: { windowMs: 10_000, max: 8, lockMs: 10_000 },
  review: { windowMs: 60_000, max: 3, lockMs: 30_000 },
  lockCommand: { windowMs: 10_000, max: 5, lockMs: 15_000 },
} as const satisfies Record<string, RateLimitConfig>

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number; message: string }

/** Drop the attempts that have left the window. */
function live(window: Window, cfg: RateLimitConfig, now: number): number[] {
  const floor = now - cfg.windowMs
  return window.hits.filter((at) => at > floor && at <= now).sort((a, b) => a - b)
}

/** The first attempt in this window, in a sentence a Guest can act on. */
function refusal(retryAfterMs: number, locked: boolean): RateLimitResult {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  return {
    ok: false,
    retryAfterMs,
    message: locked
      ? `Too many attempts. Please wait ${seconds} second${seconds === 1 ? '' : 's'} before trying again.`
      : `Please wait ${seconds} second${seconds === 1 ? '' : 's'} before trying again.`,
  }
}

/**
 * Record one attempt and say whether it may go ahead.
 *
 * A refused attempt is *not* recorded: an endless retry loop must not extend its
 * own countdown, which is what makes the countdown predictable enough to show.
 */
export function checkRateLimit(key: string, cfg: RateLimitConfig, now = Date.now()): RateLimitResult {
  const existing = windows.get(key)
  if (existing?.lockedUntil && existing.lockedUntil > now) {
    return refusal(existing.lockedUntil - now, true)
  }

  if (windows.size >= MAX_KEYS && !windows.has(key)) {
    // Evict whatever is finished; if nothing is, drop the oldest insertion. The
    // worst case is that one cooldown is forgotten, in this tab, once.
    for (const [candidate, window] of windows) {
      if (window.lockedUntil <= now && live(window, cfg, now).length === 0) windows.delete(candidate)
    }
    if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value as string)
  }

  const window: Window = existing ?? { hits: [], lockedUntil: 0 }
  const hits = live(window, cfg, now)

  if (hits.length >= cfg.max) {
    const retryAfterMs = (hits[0] ?? now) + cfg.windowMs - now
    const lock = cfg.lockMs ? Math.min(cfg.lockMs, Math.max(retryAfterMs, 1_000)) : 0
    windows.set(key, { hits, lockedUntil: lock > 0 ? now + lock : 0 })
    return refusal(Math.max(retryAfterMs, lock), true)
  }

  hits.push(now)
  windows.set(key, { hits, lockedUntil: 0 })
  return { ok: true, remaining: Math.max(0, cfg.max - hits.length) }
}

/** Forget one key — or every key, when a test needs a clean tab. */
export function resetRateLimit(key?: string) {
  if (key === undefined) windows.clear()
  else windows.delete(key)
}

/** How many keys this tab is holding. Test seam. */
export function rateLimitKeyCount(): number {
  return windows.size
}

/** `90` → `1:30`, `45` → `45s`. Used by countdowns in the forms. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
