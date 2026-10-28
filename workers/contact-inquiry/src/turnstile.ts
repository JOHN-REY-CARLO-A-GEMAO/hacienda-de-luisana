/**
 * Cloudflare Turnstile, verified server-side — the only bot check here that is
 * worth anything.
 * ----------------------------------------------------------------------------
 * A token the browser minted proves nothing on its own: a script skips the
 * widget and posts whatever it likes. What makes the token meaningful is this
 * call — Cloudflare's `siteverify` endpoint, with the *secret*, which never
 * leaves the worker. The token is single-use, so a replay fails too.
 *
 * Three rules:
 *
 *   • **Fail closed on a bad token**, which is the point of the check.
 *   • **Fail open on an unreachable Cloudflare**, because a Cloudflare outage is
 *     not evidence that the person in front of the form is a bot, and losing a
 *     real inquiry is the worse failure. The degradation is logged. Flip
 *     `failClosed` if a deployment would rather lose the inquiry.
 *   • **The dev bypass cannot reach production.** `TURNSTILE_SKIP_VERIFY` is
 *     honoured only when `ENVIRONMENT === "development"`, and the response says
 *     so in the log, so a local run does not need a real token while a deploy
 *     has no way to switch the check off.
 */
import { isDevelopment, type Env } from './env'

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const VERIFY_TIMEOUT_MS = 5_000

export type TurnstileResult =
  | { status: 'passed' }
  /** Configured, and the token is not good. The sender is refused. */
  | { status: 'failed'; codes: string[] }
  /** Cloudflare could not be asked. `failClosed` decides what that means. */
  | { status: 'unavailable'; detail: string }
  /** Cloudflare reported the token expired or was already used. */
  | { status: 'duplicate'; codes: string[] }
  /** Local development only. Never reachable in production. */
  | { status: 'skipped' }

export type VerifyOptions = {
  token: string
  remoteIp: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Ask Cloudflare whether a token is real.
 *
 * The reply is read defensively — an intercepting proxy can return anything, so
 * a non-200 status, a body that is not JSON and a body with no `success` are
 * three separate "could not ask" answers rather than an implicit pass. That is
 * the difference between a check and a decoration.
 */
export async function verifyTurnstile(env: Env, options: VerifyOptions): Promise<TurnstileResult> {
  const secret = (env.TURNSTILE_SECRET_KEY ?? '').trim()
  if (secret === '') return { status: 'unavailable', detail: 'secret-not-configured' }

  const body = new URLSearchParams({ secret, response: options.token })
  if (options.remoteIp && options.remoteIp !== 'unknown') body.set('remoteip', options.remoteIp)

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    return { status: 'unavailable', detail: error instanceof Error ? error.name : 'network-error' }
  }

  if (!response.ok) return { status: 'unavailable', detail: `http-${response.status}` }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { status: 'unavailable', detail: 'unreadable-reply' }
  }

  const record = (payload && typeof payload === 'object' ? payload : {}) as {
    success?: unknown
    'error-codes'?: unknown
  }
  if (record.success === true) return { status: 'passed' }
  const codes = Array.isArray(record['error-codes'])
    ? record['error-codes'].filter((code): code is string => typeof code === 'string').slice(0, 5)
    : []
  // A single-use token that has already been spent is a failure like any other;
  // naming it separately keeps the log honest about why a Guest was refused.
  if (codes.includes('timeout-or-duplicate') || codes.includes('invalid-input-response')) {
    return codes.includes('timeout-or-duplicate') ? { status: 'duplicate', codes } : { status: 'failed', codes }
  }
  return { status: 'failed', codes }
}

/** Whether the local-development bypass is in force. Two conditions, and both
 * have to hold: the flag is set *and* this is not a deployment. */
export function skipVerifyInDevelopment(env: Env): boolean {
  return isDevelopment(env) && (env.TURNSTILE_SKIP_VERIFY ?? '').trim().toLowerCase() === 'true'
}
