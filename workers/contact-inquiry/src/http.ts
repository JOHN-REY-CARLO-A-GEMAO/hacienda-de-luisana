/**
 * JSON replies and CORS — the two things every branch of the handler needs.
 * ----------------------------------------------------------------------------
 * One response envelope for every failure, so the form has one thing to read:
 *
 *   { "success": false, "error": { "code": "…", "message": "…", "fields": {…} } }
 *
 * and one for success, which the brief fixes: `{ "success": true }`.
 *
 * CORS is an allowlist, never a reflection. `ALLOWED_ORIGIN` may be a
 * comma-separated list; an origin that is not on it gets no
 * `Access-Control-Allow-Origin` and an explicit 403, because a response a browser
 * is not allowed to read is a failure a Guest should be told about rather than a
 * request that mysteriously does nothing. `Origin` is not authorisation —
 * anything outside a browser can send whatever it likes — but CORS is exactly
 * about what a *browser* may do.
 */
import type { Env } from './env'

/** The origins a browser may call this worker from, normalised. */
export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

/** The request's `Origin`, normalised, or '' when the header is absent (curl,
 * a server, a same-origin GET). */
export function originOf(request: Request): string {
  return (request.headers.get('Origin') ?? '').trim().replace(/\/+$/, '')
}

/** CORS headers for one origin. `Vary` is not decoration: without it a shared
 * cache can hand one origin's allow header to another. */
export function corsHeaders(origin: string, allowed: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset',
  }
  if (allowed && origin !== '') headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export type JsonInit = {
  status: number
  headers?: Record<string, string>
}

/** One JSON reply. `no-store` because nothing here is cacheable, and
 * `nosniff` because a 400 body should never be sniffed as something else. */
export function json(body: unknown, init: JsonInit): Response {
  const headers = new Headers(init.headers ?? {})
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(body), { status: init.status, headers })
}

export function success(headers: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  return json({ success: true, ...extra }, { status: 200, headers })
}

/** A named refusal. `code` is for the client to branch on; `message` is the
 * sentence a Guest reads and is never a stack trace or an upstream body. */
export function failure(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Response {
  return json({ success: false, error: { code, message, ...extra } }, { status, headers })
}

/** The 429 the form counts down from.
 *
 * `Retry-After` is the whole window, as the brief specifies, and the same number
 * is in the JSON so a client that cannot read headers still gets it. */
export function tooManyRequests(
  headers: Record<string, string>,
  retryAfterSeconds: number,
  limit: number,
): Response {
  return failure(
    429,
    'rate_limited',
    "You've submitted too many times. Please wait a few minutes before trying again.",
    { ...headers, 'Retry-After': String(retryAfterSeconds) },
    { retry_after_seconds: retryAfterSeconds, limit },
  )
}
