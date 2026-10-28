/**
 * The contact inquiry endpoint — Cloudflare Worker edition.
 * ----------------------------------------------------------------------------
 * Why this exists at all: the Firebase project runs on the **Spark (free) plan**,
 * which cannot deploy Cloud Functions. The website's public contact form is the
 * one feature that genuinely needs a server — validating, pacing and emailing an
 * unauthenticated request — so it lives here, on a plan that costs nothing and
 * still gives a real HTTP endpoint, real IPs and a KV store.
 *
 * The order below is the design, and it is not arbitrary:
 *
 *   CORS → method → configuration → body size → JSON → **honeypot** → schema →
 *   **Turnstile** → **rate limit** → Resend
 *
 *   • The honeypot comes before everything expensive so a form-filler costs
 *     nothing and learns nothing (it gets a fake success).
 *   • Turnstile comes before the rate limit, as the brief requires: a bot with an
 *     invalid token must not be able to burn the 1,000 free KV writes a day. The
 *     trade is that each *unauthenticated* request still costs one Cloudflare
 *     verification call, which is Cloudflare's own quota and the cheaper of the
 *     two to lose.
 *   • The rate limit comes before Resend, because Resend's free tier is 100
 *     emails a day and the inbox is a human's.
 *
 * Everything the worker says is in one envelope — `{ success, error? }` — so the
 * React form has a single shape to read, and every refusal carries a sentence a
 * Guest can act on plus a `code` the client can branch on.
 */
import type { Env } from './env'
import { allowedOrigins, corsHeaders, failure, originOf, success, tooManyRequests } from './http'
import { checkRateLimit, clientIp, RATE_LIMIT } from './kvRateLimit'
import { sendInquiry } from './resend'
import { fieldErrors, firstError, honeypotTripped, inquirySchema, MAX_BODY_BYTES } from './schema'
import { skipVerifyInDevelopment, verifyTurnstile } from './turnstile'

/** The messages the client shows, in one place. */
const MESSAGES = {
  origin: 'This website is not allowed to send inquiries from that address.',
  method: 'Send the inquiry with POST.',
  misconfigured: 'The inquiry form is not configured yet, so it cannot send anything. Please contact the Hacienda directly.',
  tooLarge: 'That inquiry is too large to send. Keep the message under 2,000 characters.',
  invalidJson: 'The inquiry could not be read. Please try again.',
  botCheck: 'The bot check could not be completed. Please refresh the page and try again.',
  sendFailed: 'Your inquiry could not be sent right now. Please try again in a moment.',
  unavailable: 'The inquiry could not be sent right now. Please try again in a moment.',
} as const

/** Structured logs without the Guest's words: an address and a message are
 * personal data, and Cloudflare's logs are not the place for them. */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }))
}

/**
 * Refuse to run half-configured.
 *
 * A worker missing its Resend key would otherwise accept inquiries and drop them,
 * which is the exact failure this project keeps designing against. Naming the
 * missing binding here means a bad deploy is a loud 500, not a silent hole.
 */
function missingConfiguration(env: Env): string | null {
  if (!env.RATE_LIMIT_KV) return 'RATE_LIMIT_KV'
  if ((env.RESEND_API_KEY ?? '').trim() === '') return 'RESEND_API_KEY'
  if ((env.NOTIFICATION_EMAIL ?? '').trim() === '') return 'NOTIFICATION_EMAIL'
  if (!skipVerifyInDevelopment(env) && (env.TURNSTILE_SECRET_KEY ?? '').trim() === '') return 'TURNSTILE_SECRET_KEY'
  return null
}

/** Read the body, with the size ceiling applied before parsing. */
async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: string; message: string }> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    return { ok: false, status: 415, code: 'unsupported_media_type', message: 'Send the inquiry as JSON.' }
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: MESSAGES.tooLarge }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, status: 400, code: 'unreadable_body', message: MESSAGES.invalidJson }
  }
  // `Content-Length` can lie, and a chunked body has none: the bytes actually
  // received are what matters.
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: MESSAGES.tooLarge }
  }
  if (text.trim() === '') {
    return { ok: false, status: 400, code: 'empty_body', message: 'Please fill in the form and try again.' }
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: MESSAGES.invalidJson }
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = originOf(request)
    const allowed = origin === '' || allowedOrigins(env).includes(origin)
    const cors = corsHeaders(origin, allowed)

    // --- CORS -----------------------------------------------------------------
    // A browser sends this before a JSON POST. Answering it is the only way a
    // cross-origin form works at all.
    if (request.method === 'OPTIONS') {
      if (!allowed) return failure(403, 'origin_not_allowed', MESSAGES.origin, cors)
      return new Response(null, { status: 204, headers: cors })
    }
    if (!allowed) return failure(403, 'origin_not_allowed', MESSAGES.origin, cors)

    // --- Method ---------------------------------------------------------------
    if (request.method !== 'POST') {
      return failure(405, 'method_not_allowed', MESSAGES.method, { ...cors, Allow: 'POST, OPTIONS' })
    }

    // --- Configuration --------------------------------------------------------
    const missing = missingConfiguration(env)
    if (missing) {
      log('misconfigured', { missing, environment: env.ENVIRONMENT ?? 'production' })
      return failure(500, 'misconfigured', MESSAGES.misconfigured, cors)
    }

    // --- Body -----------------------------------------------------------------
    const body = await readJson(request)
    if (!body.ok) return failure(body.status, body.code, body.message, cors)

    // --- Honeypot -------------------------------------------------------------
    // Answered exactly like a real send, and nothing is done: no Turnstile call,
    // no KV write, no email. A 400 naming the field would be a tutorial.
    if (honeypotTripped(body.value)) {
      log('honeypot_tripped', { ip: clientIp(request) })
      return success(cors)
    }

    // --- Schema ---------------------------------------------------------------
    const parsed = inquirySchema.safeParse(body.value)
    if (!parsed.success) {
      return failure(400, 'invalid_input', firstError(parsed.error), cors, { fields: fieldErrors(parsed.error) })
    }
    const inquiry = parsed.data

    // --- Turnstile ------------------------------------------------------------
    const ip = clientIp(request)
    if (skipVerifyInDevelopment(env)) {
      // Printed on every run so a stray skip is impossible to miss in a log.
      log('turnstile_skipped', { environment: env.ENVIRONMENT })
    } else {
      const verdict = await verifyTurnstile(env, { token: inquiry.turnstileToken, remoteIp: ip })
      if (verdict.status === 'failed' || verdict.status === 'duplicate') {
        log('turnstile_refused', { ip, status: verdict.status, codes: 'codes' in verdict ? verdict.codes : undefined })
        return failure(403, 'bot_check_failed', MESSAGES.botCheck, cors)
      }
      if (verdict.status === 'unavailable') {
        // A Cloudflare outage is not evidence of a bot. Losing a real inquiry is
        // the worse failure, so it proceeds — unless the deployment says
        // otherwise with TURNSTILE_FAIL_CLOSED=true.
        const failClosed = (env.TURNSTILE_FAIL_CLOSED ?? '').trim().toLowerCase() === 'true'
        log('turnstile_unavailable', { ip, detail: verdict.detail, failClosed })
        if (failClosed) return failure(503, 'bot_check_unavailable', MESSAGES.botCheck, { ...cors, 'Retry-After': '60' })
      }
    }

    // --- Rate limit -----------------------------------------------------------
    const decision = await checkRateLimit(env, ip)
    const rateHeaders: Record<string, string> = {
      'RateLimit-Limit': String(RATE_LIMIT.max),
      'RateLimit-Remaining': String(decision.allowed ? decision.remaining : 0),
      'RateLimit-Reset': String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1_000))),
      ...(decision.degraded ? { 'X-RateLimit-Degraded': 'true' } : {}),
    }
    if (!decision.allowed) {
      log('rate_limited', { ip, retryAfter: decision.retryAfterSeconds })
      return tooManyRequests({ ...cors, ...rateHeaders }, decision.retryAfterSeconds, RATE_LIMIT.max)
    }

    // --- Resend ---------------------------------------------------------------
    const receivedAt = new Date().toISOString()
    const sent = await sendInquiry(env, inquiry, { ip, receivedAt })
    if (!sent.ok) {
      // The Guest is told the truth — nothing was sent — and the log carries the
      // class of failure, never Resend's response body (it can echo the address).
      log('send_failed', { ip, reason: sent.reason, status: sent.status, detail: sent.detail })
      const status = sent.reason === 'not-configured' ? 503 : 502
      return failure(status, 'send_failed', sent.reason === 'not-configured' ? MESSAGES.unavailable : MESSAGES.sendFailed, {
        ...cors,
        ...rateHeaders,
        ...(status === 503 ? { 'Retry-After': '60' } : {}),
      })
    }

    log('inquiry_sent', { ip, resend_id: sent.id, remaining: decision.remaining, degraded: decision.degraded })
    return success({ ...cors, ...rateHeaders }, { id: sent.id })
  },
} satisfies ExportedHandler<Env>
