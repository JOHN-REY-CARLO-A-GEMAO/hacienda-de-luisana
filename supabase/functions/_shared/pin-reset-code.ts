/**
 * The one-time code behind a forgotten Security PIN (ADR-0027).
 *
 * Pure, dependency-free, and web-crypto only: this module is what both the
 * Edge Function and its tests import, so the rules about a code live in one
 * place rather than being restated at the call site.
 *
 * What a code is and is not:
 *
 *   - it is six digits, generated with `crypto.getRandomValues` — the platform
 *     CSPRNG, never `Math.random`, which is seeded predictably enough to make a
 *     six-digit space no space at all;
 *   - it is **never stored**. Firestore keeps a salted SHA-256 of the digits and
 *     nothing else, so a leaked database dump is not a bag of live reset codes.
 *     Six digits are not a password, so the salt here is not defending against
 *     pre-computation — it stops one dump from being reusable across the
 *     hacienda's own past codes, and it costs nothing;
 *   - it is short-lived and single-use. [PIN_RESET_CODE_TTL_MS] is the life, and
 *     `consumed_at` is what makes a second use a refusal rather than a shrug;
 *   - it is guessable in principle (a million values), which is why the attempts
 *     ladder [PIN_RESET_MAX_ATTEMPTS] is not optional and why a new code is
 *     always cheaper for the attacker to ask for than to guess;
 *   - and it is delivered only to the Admin's own verified Firebase address,
 *     never to one the phone names.
 *
 * The Admin app never hashes anything: it collects six digits and posts them.
 * Its copy of the limits (`kPinResetCodeTtl`, `kPinResetMaxAttempts` in
 * `lib/services/pin_reset_service.dart`) is for the sentence it prints, and
 * `test/web/pin-reset.test.ts` pins the values here so the two cannot drift
 * without a suite saying so.
 */

/** How many digits a reset code has. Six, the same as the PIN itself. */
export const PIN_RESET_CODE_LENGTH = 6

/** How long a code stays usable. Long enough for a slow inbox, short enough to matter. */
export const PIN_RESET_CODE_TTL_MS = 15 * 60 * 1000

/** After this many wrong entries the code is spent, and a new one must be asked for. */
export const PIN_RESET_MAX_ATTEMPTS = 5

/** Requests one Admin may make in an hour. The first is the one that matters. */
export const PIN_RESET_REQUESTS_PER_HOUR = 3

/** The minimum gap between two requests, so a held button cannot spam an inbox. */
export const PIN_RESET_REQUEST_COOLDOWN_MS = 60 * 1000

/**
 * The one-hour window the request ceiling is counted in, anchored on the first
 * request rather than on the clock: a fixed window would let two requests land
 * either side of the hour and deliver four in two minutes.
 */
export const PIN_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000

/** What the digest is computed over. Versioned so a future change is a new prefix, not a silent one. */
const DIGEST_PREFIX = 'hdls-pin-reset-v1'

/** A fresh 16-byte salt, hex — the same size the PIN record's salt is. */
export function newCodeSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Six random digits, uniformly distributed.
 *
 * Rejection sampling, not `% 1000000`: taking a 32-bit value modulo a million
 * biases the low end by a hair, and this is short enough to do exactly.
 */
export function newResetCode(): string {
  const limit = Math.floor(0x100000000 / 10 ** PIN_RESET_CODE_LENGTH) * 10 ** PIN_RESET_CODE_LENGTH
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return String(value % 10 ** PIN_RESET_CODE_LENGTH).padStart(PIN_RESET_CODE_LENGTH, '0')
}

/**
 * Salted SHA-256 of one code, lowercase hex.
 *
 * The message shape is the version prefix, the salt and the digits, newline
 * separated. It is spelled out rather than concatenated blindly so a salt that
 * happens to end in digits cannot be re-cut into a different (salt, code) pair.
 */
export async function hashResetCode(code: string, salt: string): Promise<string> {
  const message = `${DIGEST_PREFIX}\n${salt}\n${code}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Does [code] hash to [expected]?
 *
 * Compared without an early exit: a string `===` returns on the first differing
 * character, and while the timing signal here is small it is also free to
 * remove. Anything not six digits is refused before hashing, so a caller cannot
 * spend the digest budget on arbitrary text.
 */
export async function verifyResetCode(
  code: string,
  salt: string,
  expected: string,
): Promise<boolean> {
  if (!isResetCodeShape(code)) return false
  const actual = await hashResetCode(code, salt)
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

/** Exactly six ASCII digits — the only shape a code is allowed to arrive in. */
export function isResetCodeShape(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9]{${PIN_RESET_CODE_LENGTH}}$`).test(value)
}

/**
 * Enough of an address to recognise, not enough to leak it to a shoulder.
 *
 * `gemaojohnreyarguilles@gmail.com` becomes `g***s@gmail.com`: the first
 * character, the last character before the `@`, and the domain. The Admin knows
 * their own address; anyone else holding the phone learns almost nothing.
 */
// ---------------------------------------------------------------------------
// Request pacing
// ---------------------------------------------------------------------------

export interface RequestPacingState {
  /** When the window started, epoch ms. Absent on a fresh record. */
  windowStartedAt?: number
  /** Requests in the current window. */
  sent?: number
  /** When a code was last mailed, epoch ms — the gap the cooldown is measured from. */
  lastSentAt?: number
}

export type RequestPacingVerdict =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'hourly'; retryAfterMs: number }

/**
 * Two brakes on the send button: [PIN_RESET_REQUEST_COOLDOWN_MS] between sends,
 * and [PIN_RESET_REQUESTS_PER_HOUR] sends in a sliding hour.
 *
 * Both are measured against server-authored numbers on the Admin's own record
 * (`admin_security_resets/{uid}`), which the client cannot write, so clearing
 * the app's data — or reinstalling — does not refill the budget. The record is
 * removed by the reset it authorises, which starts the hour over: a completed
 * reset is the one thing that legitimately earns a fresh budget.
 */
export function checkRequestPacing(
  state: RequestPacingState | undefined,
  now: number,
  cooldownMs: number,
  perHour: number,
): RequestPacingVerdict {
  if (!state || typeof state.lastSentAt !== 'number') return { ok: true }

  const sinceLast = now - state.lastSentAt
  if (sinceLast >= 0 && sinceLast < cooldownMs) {
    return { ok: false, reason: 'cooldown', retryAfterMs: cooldownMs - sinceLast }
  }

  const windowStartedAt = state.windowStartedAt
  const sent = state.sent ?? 0
  const windowOpen =
    typeof windowStartedAt === 'number' && now - windowStartedAt < PIN_RESET_REQUEST_WINDOW_MS
  if (windowOpen && sent >= perHour) {
    return {
      ok: false,
      reason: 'hourly',
      retryAfterMs: PIN_RESET_REQUEST_WINDOW_MS - (now - (windowStartedAt as number)),
    }
  }
  return { ok: true }
}

/**
 * The counters after one accepted request: the same window keeps counting, and
 * a window older than an hour starts again.
 */
export function nextRequestPacingState(
  state: RequestPacingState | undefined,
  now: number,
): Required<Pick<RequestPacingState, 'windowStartedAt' | 'sent' | 'lastSentAt'>> {
  const windowStartedAt =
    typeof state?.windowStartedAt === 'number'
    && now - state.windowStartedAt < PIN_RESET_REQUEST_WINDOW_MS
      ? state.windowStartedAt
      : now
  const sent =
    windowStartedAt === state?.windowStartedAt ? (state?.sent ?? 0) + 1 : 1
  return { windowStartedAt, sent, lastSentAt: now }
}
