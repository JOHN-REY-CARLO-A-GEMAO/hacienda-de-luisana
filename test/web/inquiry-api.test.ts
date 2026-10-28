/**
 * Sending an inquiry to the Cloudflare Worker: the URL, the answer, and every
 * failure the browser has to distinguish.
 *
 * The endpoint is a real HTTP boundary, so these cases are about *status codes*:
 * a 429 with `Retry-After`, a 403 from the bot check, a 400 naming fields, a 502
 * from Resend, a connection that drops. None of them may become "Inquiry sent.",
 * and a 429 must become a number the form can count down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEMO_INQUIRY_KEY,
  RATE_LIMITED_MESSAGE,
  contactEndpoint,
  parseInquiryReply,
  submitInquiry,
} from '../../src/lib/inquiryApi'

const payload = () => ({
  name: 'Ana Reyes',
  email: 'ana@example.com',
  subject: 'Wedding shoot',
  phone: '09171234567',
  message: 'We would like to ask about booking the Main House in December.',
  turnstileToken: 'token-abc',
  hdl_extra: '',
})

const headers = (map: Record<string, string> = {}) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the endpoint', () => {
  it('is the worker URL this build was given', () => {
    vi.stubEnv('VITE_CONTACT_WORKER_URL', 'https://contact-inquiry-worker.example.workers.dev')
    expect(contactEndpoint()).toBe('https://contact-inquiry-worker.example.workers.dev')
  })

  it('normalises a trailing slash, so one endpoint is not two origins', () => {
    vi.stubEnv('VITE_CONTACT_WORKER_URL', 'https://worker.example/')
    expect(contactEndpoint()).toBe('https://worker.example')
  })

  it('is nothing when unset or malformed, which is what makes demo mode a decision', () => {
    vi.stubEnv('VITE_CONTACT_WORKER_URL', '')
    expect(contactEndpoint()).toBeNull()
    vi.stubEnv('VITE_CONTACT_WORKER_URL', 'not a url')
    expect(contactEndpoint()).toBeNull()
    vi.stubEnv('VITE_CONTACT_WORKER_URL', 'javascript:alert(1)')
    expect(contactEndpoint()).toBeNull()
  })
})

describe('reading the worker’s answer', () => {
  it('reads a sent inquiry', () => {
    expect(parseInquiryReply(200, { success: true, id: 'email-1' })).toMatchObject({
      ok: true,
      id: 'email-1',
      demo: false,
    })
  })

  it('does not accept a 200 that does not say success', () => {
    const result = parseInquiryReply(200, { ok: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('unavailable')
  })

  it('keeps the field errors the worker named', () => {
    const result = parseInquiryReply(400, {
      success: false,
      error: {
        code: 'invalid_input',
        message: 'Message must be at least 10 characters',
        fields: { message: 'Message must be at least 10 characters', email: '' },
      },
    })
    expect(result).toMatchObject({ ok: false, kind: 'validation' })
    if (result.ok || result.kind !== 'validation') return
    expect(result.fields).toEqual({ message: 'Message must be at least 10 characters' })
    expect(result.message).toContain('at least 10')
  })

  it('reads a 429 from `Retry-After`, and falls back to the window the worker uses', () => {
    const fromHeader = parseInquiryReply(
      429,
      { success: false, error: { code: 'rate_limited' } },
      headers({ 'retry-after': '600' }),
    )
    expect(fromHeader).toMatchObject({ ok: false, kind: 'rate_limited', retryAfterSeconds: 600 })
    if (fromHeader.ok || fromHeader.kind !== 'rate_limited') return
    expect(fromHeader.message).toBe(RATE_LIMITED_MESSAGE)

    const fromBody = parseInquiryReply(429, {
      success: false,
      error: { code: 'rate_limited', message: 'Wait a bit.', retry_after_seconds: 42 },
    })
    expect(fromBody).toMatchObject({ ok: false, kind: 'rate_limited', retryAfterSeconds: 42, message: 'Wait a bit.' })

    // A 429 with nothing to read must still produce a wait, never a zero.
    const bare = parseInquiryReply(429, null)
    if (bare.ok || bare.kind !== 'rate_limited') throw new Error('expected a paced refusal')
    expect(bare.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('separates a failed bot check from a paced one', () => {
    expect(parseInquiryReply(403, { success: false, error: { code: 'bot_check_failed', message: 'Try again.' } })).toEqual({
      ok: false,
      kind: 'bot',
      message: 'Try again.',
    })
  })

  it('treats an upstream send failure as “not sent”, never as success', () => {
    const result = parseInquiryReply(502, { success: false, error: { code: 'send_failed', message: 'Please try again.' } })
    expect(result).toMatchObject({ ok: false, kind: 'unavailable', message: 'Please try again.' })
  })

  it('treats an unmodelled status as a failure', () => {
    expect(parseInquiryReply(500, null).ok).toBe(false)
    expect(parseInquiryReply(418, null).ok).toBe(false)
  })
})

describe('sending', () => {
  it('posts the exact body the worker’s strict schema expects', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, id: 'email-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

    const result = await submitInquiry(payload(), { endpoint: 'https://worker.example', fetchImpl })
    expect(result).toMatchObject({ ok: true, id: 'email-1' })

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toBe('https://worker.example')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(sent).toEqual(payload())
  })

  it('returns the 429 with its wait rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: 'rate_limited', retry_after_seconds: 600 } }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '600' } },
    )) as unknown as typeof fetch

    const result = await submitInquiry(payload(), { endpoint: 'https://worker.example', fetchImpl })
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited', retryAfterSeconds: 600 })
    if (result.ok || result.kind !== 'rate_limited') return
    expect(result.message).toContain('too many times')
  })

  it('says the connection failed when it did', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const result = await submitInquiry(payload(), { endpoint: 'https://worker.example', fetchImpl })
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' })
    if (result.ok) return
    expect(result.message).toContain('connection')
  })

  it('keeps the inquiry in this browser — and says so — when no worker is configured', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const result = await submitInquiry(payload(), { endpoint: null, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, demo: true })

    const stored = JSON.parse(localStorage.getItem(DEMO_INQUIRY_KEY) ?? '[]') as Record<string, unknown>[]
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: 'Ana Reyes', demo: true })
    // The token and the trap are not worth keeping.
    expect(stored[0]).not.toHaveProperty('turnstileToken')
    expect(stored[0]).not.toHaveProperty('hdl_extra')
  })
})
