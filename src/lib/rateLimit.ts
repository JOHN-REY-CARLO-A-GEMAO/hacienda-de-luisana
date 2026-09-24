/** Client-side cooldowns. Server/Firestore still authorizes. */

type Bucket = { count: number; resetAt: number; lockedUntil?: number }

const buckets = new Map<string, Bucket>()

export type RateLimitConfig = {
  windowMs: number
  max: number
  lockMs?: number
}

export const LIMITS = {
  login: { windowMs: 60_000, max: 5, lockMs: 60_000 },
  reset: { windowMs: 60_000, max: 3, lockMs: 120_000 },
  booking: { windowMs: 60_000, max: 4, lockMs: 30_000 },
  payment: { windowMs: 60_000, max: 5, lockMs: 30_000 },
  ocr: { windowMs: 60_000, max: 8, lockMs: 20_000 },
  chat: { windowMs: 10_000, max: 8, lockMs: 10_000 },
  review: { windowMs: 60_000, max: 3, lockMs: 30_000 },
  lockCommand: { windowMs: 10_000, max: 5, lockMs: 15_000 },
} as const

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number; message: string }

export function checkRateLimit(key: string, cfg: RateLimitConfig, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key)
  if (existing?.lockedUntil && existing.lockedUntil > now) {
    const retryAfterMs = existing.lockedUntil - now
    return { ok: false, retryAfterMs, message: `Please wait ${Math.ceil(retryAfterMs / 1000)}s before trying again.` }
  }
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + cfg.windowMs })
    return { ok: true, remaining: cfg.max - 1 }
  }
  if (existing.count >= cfg.max) {
    const lockedUntil = cfg.lockMs ? now + cfg.lockMs : existing.resetAt
    buckets.set(key, { ...existing, lockedUntil })
    const retryAfterMs = lockedUntil - now
    return { ok: false, retryAfterMs, message: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.` }
  }
  existing.count += 1
  return { ok: true, remaining: cfg.max - existing.count }
}

export function resetRateLimit(key: string) {
  buckets.delete(key)
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
