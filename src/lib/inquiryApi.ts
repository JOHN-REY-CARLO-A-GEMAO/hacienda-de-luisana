/**
 * Sending the contact inquiry — one request to the Cloudflare Worker.
 * Hacienda de LuisAna
 * ----------------------------------------------------------------------------
 * The endpoint is not Firebase. The project runs on the Spark plan, which cannot
 * deploy Cloud Functions, so the public form posts to a Worker on Cloudflare's
 * free tier (`workers/contact-inquiry/`). That worker validates the body again,
 * verifies the Turnstile token, counts the request against the caller's IP and
 * emails the Hacienda through Resend.
 *
 * This module is the browser's half of that contract: build the body, POST it,
 * and turn the answer into something the form can render. Two details matter:
 *
 *   • **A 429 is a normal outcome, not an error to swallow.** Its `Retry-After`
 *     is read (header first, then the JSON) and the form counts down from it.
 *     Anything else invites the Guest to retry into the same wall.
 *   • **Demo mode is labelled, never silent.** With `VITE_CONTACT_WORKER_URL`
 *     unset there is no endpoint; the inquiry is kept in this browser and the
 *     reply says so, because a thank-you for something that was never sent is the
 *     exact failure this form used to have.
 */
import type { ContactInquiry } from './security/contactInquiry'

/** Where an inquiry is kept in demo mode. Browser only, and it says so. */
export const DEMO_INQUIRY_KEY = 'hdl:inquiries'

/** What the form is told. Each variant is a different thing to show. */
export type InquiryResult =
  | { ok: true; id: string; receivedAt: string; demo: boolean }
  | { ok: false; kind: 'validation'; message: string; fields: Record<string, string> }
  | { ok: false; kind: 'rate_limited'; message: string; retryAfterSeconds: number }
  | { ok: false; kind: 'bot'; message: string }
  | { ok: false; kind: 'unavailable'; message: string; retryAfterSeconds?: number }

/** The message the brief specifies for a paced submission. Used when the worker
 * sends none, which should not happen but must not produce an empty alert. */
export const RATE_LIMITED_MESSAGE =
  "You've submitted too many times. Please wait a few minutes before trying again."

/**
 * The worker URL, or `null` when this build was given none.
 *
 * Read through Vite's env so it is inlined at build time. A URL with a trailing
 * slash is normalised: `…/` and `…` must not become two different origins in a
 * log.
 */
export function contactEndpoint(): string | null {
  const raw = String(import.meta.env.VITE_CONTACT_WORKER_URL ?? '').trim()
  if (raw === '') return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString().replace(/\/$/, '')
  } catch {
    // A malformed variable is a build mistake, not a Guest's problem: behave like
    // demo mode rather than throwing on every keystroke.
    return null
  }
}

// ----------------------------------------------------------------------------
// Reading the worker's answer
// ----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** `Retry-After` is whole seconds, or an HTTP date. Both appear in the wild. */
function retryAfterFromHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) || undefined
  const at = Date.parse(trimmed)
  if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - now) / 1000))
  return undefined
}

/**
 * Turn one HTTP answer into the form's vocabulary.
 *
 * Never throws, and never trusts the shape: a body that is not JSON, a 200 with
 * no `success`, and an unmodelled status are three separate "the Hacienda did not
 * take this" answers rather than an implicit pass.
 */
export function parseInquiryReply(
  status: number,
  payload: unknown,
  headers: { get(name: string): string | null } = new Headers(),
  now = Date.now(),
): InquiryResult {
  const body = asRecord(payload)
  const error = asRecord(body.error)
  const code = asString(error.code)
  const message = asString(error.message)

  if (status >= 200 && status < 300 && body.success === true) {
    return {
      ok: true,
      id: asString(body.id),
      receivedAt: new Date(now).toISOString(),
      demo: false,
    }
  }

  if (status === 429 || code === 'rate_limited') {
    // The worker sends the whole window (600 s). Header first, because a proxy
    // may rewrite the body and not the header; the JSON as the fallback.
    const retryAfterSeconds =
      retryAfterFromHeader(headers.get('retry-after'), now)
      ?? asNumber(error.retry_after_seconds)
      ?? 600
    return {
      ok: false,
      kind: 'rate_limited',
      message: message || RATE_LIMITED_MESSAGE,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    }
  }

  if (status === 403 || code === 'bot_check_failed') {
    return {
      ok: false,
      kind: 'bot',
      message: message || 'The bot check could not be completed. Please refresh the page and try again.',
    }
  }

  if (status === 400 || status === 413 || status === 415 || code === 'invalid_input') {
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(asRecord(error.fields))) {
      if (typeof value === 'string' && value !== '') fields[key] = value
    }
    return {
      ok: false,
      kind: 'validation',
      message: message || 'Please check the form and try again.',
      fields,
    }
  }

  return {
    ok: false,
    kind: 'unavailable',
    message: message || 'Your inquiry could not be sent right now. Please try again in a moment.',
    retryAfterSeconds: status === 503 ? (retryAfterFromHeader(headers.get('retry-after'), now) ?? 30) : undefined,
  }
}

// ----------------------------------------------------------------------------
// Sending it
// ----------------------------------------------------------------------------

/**
 * POST one inquiry to the worker.
 *
 * `fetchImpl` and `endpoint` are parameters rather than globals so the tests can
 * exercise a 429, a 403 and a dropped connection with no network. In the app they
 * are omitted.
 */
export async function submitInquiry(
  payload: ContactInquiry,
  options: { endpoint?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<InquiryResult> {
  const endpoint = options.endpoint === undefined ? contactEndpoint() : options.endpoint

  if (!endpoint) {
    // Demo mode: kept here, sent nowhere, and the caller is told which.
    try {
      const stored = JSON.parse(localStorage.getItem(DEMO_INQUIRY_KEY) ?? '[]') as unknown
      const rows = Array.isArray(stored) ? stored.slice(-49) : []
      rows.push({
        name: payload.name,
        email: payload.email,
        subject: payload.subject,
        phone: payload.phone,
        message: payload.message,
        demo: true,
        kept_at: new Date().toISOString(),
      })
      localStorage.setItem(DEMO_INQUIRY_KEY, JSON.stringify(rows))
    } catch {
      // A browser with storage disabled still gets the honest sentence below.
    }
    return { ok: true, id: `demo-${Date.now()}`, receivedAt: new Date().toISOString(), demo: true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No cookie is needed, and sending one would make this a credentialed
      // cross-origin request for nothing.
      credentials: 'omit',
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch {
    return {
      ok: false,
      kind: 'unavailable',
      message: "We couldn't reach the Hacienda. Check your connection and try again.",
    }
  } finally {
    clearTimeout(timeout)
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }
  return parseInquiryReply(response.status, parsed, { get: (name) => response.headers.get(name) })
}
