/**
 * The worker, executed.
 *
 * `fetch` here is the real handler with a fake KV namespace and a stubbed global
 * `fetch` for Turnstile and Resend, so every case below exercises the actual
 * request path — the CORS branch, the trap, the schema, the verification call,
 * the counter, the email payload — rather than a helper that approximates it.
 *
 * The cases are grouped by the question they answer: who may call it, what it
 * accepts, what it refuses to spend money on, and what the Guest is told.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import type { Env, RateLimitKv } from '../src/env'
import { RATE_LIMIT } from '../src/kvRateLimit'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeKV {
  readonly store = new Map<string, string>()
  reads = 0
  writes = 0
  failRead = false
  failWrite = false

  async get(key: string, type?: string): Promise<unknown> {
    this.reads += 1
    if (this.failRead) throw new Error('kv-read-failed')
    const value = this.store.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) : value
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.writes += 1
    this.lastTtl = options?.expirationTtl
    if (this.failWrite) throw new Error('kv-write-failed')
    this.store.set(key, value)
  }

  lastTtl: number | undefined
}

const BASE_ENV = {
  ENVIRONMENT: 'production',
  ALLOWED_ORIGIN: 'http://localhost:3000,https://haciendadeluisana.com',
  NOTIFICATION_EMAIL: 'inbox@haciendadeluisana.com',
  FROM_EMAIL: 'Website Inquiry <onboarding@resend.dev>',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  RESEND_API_KEY: 'resend-key',
} as const

function makeEnv(kv: FakeKV, overrides: Partial<Env> = {}): Env {
  return { RATE_LIMIT_KV: kv as unknown as RateLimitKv, ...BASE_ENV, ...overrides } as Env
}

const VALID_BODY = {
  name: 'Ana Reyes',
  email: 'ana@example.com',
  message: 'We would like to ask about booking the Main House in December.',
  turnstileToken: 'token-abc',
  hdl_extra: '',
}

const ctx = {} as ExecutionContext

type StubOptions = {
  turnstile?: { success: boolean; codes?: string[] } | { httpStatus: number } | 'throw'
  resend?: { status: number; body?: unknown } | 'throw'
  onRequest?: (url: string, init: RequestInit) => void
}

/** Stub the two outbound calls, and record what was sent. */
function stubFetch(options: StubOptions = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const stub = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    calls.push({ url: href, init })
    options.onRequest?.(href, init)

    if (href.includes('challenges.cloudflare.com')) {
      const verdict = options.turnstile ?? { success: true }
      if (verdict === 'throw') throw new TypeError('turnstile-unreachable')
      if ('httpStatus' in verdict) return new Response('nope', { status: verdict.httpStatus })
      return new Response(JSON.stringify({ success: verdict.success, 'error-codes': verdict.codes ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (href.includes('api.resend.com')) {
      const result = options.resend ?? { status: 200, body: { id: 'email-1' } }
      if (result === 'throw') throw new TypeError('resend-unreachable')
      return new Response(JSON.stringify(result.body ?? { id: 'email-1' }), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch: ${href}`)
  })
  vi.stubGlobal('fetch', stub)
  return { calls, stub, toTurnstile: () => calls.filter((c) => c.url.includes('challenges.cloudflare.com')), toResend: () => calls.filter((c) => c.url.includes('api.resend.com')) }
}

function post(body: unknown, overrides: { headers?: Record<string, string>; raw?: string; method?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
    'cf-connecting-ip': '203.0.113.9',
    ...overrides.headers,
  }
  return new Request('https://worker.example/', {
    method: overrides.method ?? 'POST',
    headers,
    ...(overrides.method === 'GET' ? {} : { body: overrides.raw ?? JSON.stringify(body) }),
  })
}

const run = (request: Request, env: Env) => worker.fetch(request, env, ctx)

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

let kv: FakeKV

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Who may call it
// ---------------------------------------------------------------------------

describe('CORS and method', () => {
  it('answers a preflight from an allowed origin', async () => {
    kv = new FakeKV()
    stubFetch()
    const response = await run(post(null, { method: 'OPTIONS' }), makeEnv(kv))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('allows the configured production origin too, and never reflects an unknown one', async () => {
    kv = new FakeKV()
    stubFetch()
    const allowed = await run(post(null, { method: 'OPTIONS', headers: { origin: 'https://haciendadeluisana.com' } }), makeEnv(kv))
    expect(allowed.status).toBe(204)

    const refused = await run(post(null, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), makeEnv(kv))
    expect(refused.status).toBe(403)
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('refuses a POST from an origin that is not on the list', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const response = await run(post(VALID_BODY, { headers: { origin: 'https://evil.example' } }), makeEnv(kv))
    expect(response.status).toBe(403)
    expect((await readJson(response)).error).toMatchObject({ code: 'origin_not_allowed' })
    // Nothing was spent: no Turnstile call, no KV write, no email.
    expect(network.calls).toHaveLength(0)
    expect(kv.writes).toBe(0)
  })

  it('refuses a method that is not POST', async () => {
    kv = new FakeKV()
    stubFetch()
    const response = await run(post(null, { method: 'GET' }), makeEnv(kv))
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS')
  })

  it('allows a request with no Origin (a server, or curl) because CORS is a browser rule', async () => {
    kv = new FakeKV()
    stubFetch()
    const request = new Request('https://worker.example/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify(VALID_BODY),
    })
    const response = await run(request, makeEnv(kv))
    expect(response.status).toBe(200)
  })
})

describe('configuration', () => {
  it('refuses to run half-configured instead of silently dropping inquiries', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const response = await run(post(VALID_BODY), makeEnv(kv, { RESEND_API_KEY: '' }))
    expect(response.status).toBe(500)
    expect((await readJson(response)).error).toMatchObject({ code: 'misconfigured' })
    expect(network.calls).toHaveLength(0)
  })

  it('names a missing Turnstile secret, a missing recipient and a missing KV binding', async () => {
    kv = new FakeKV()
    stubFetch()
    expect((await run(post(VALID_BODY), makeEnv(kv, { TURNSTILE_SECRET_KEY: '' }))).status).toBe(500)
    expect((await run(post(VALID_BODY), makeEnv(kv, { NOTIFICATION_EMAIL: '' }))).status).toBe(500)
    const noKv = { ...makeEnv(kv), RATE_LIMIT_KV: undefined } as unknown as Env
    expect((await run(post(VALID_BODY), noKv)).status).toBe(500)
  })

  it('refuses a body that is not JSON, and one that is too large', async () => {
    kv = new FakeKV()
    stubFetch()
    const notJson = await run(post(null, { headers: { 'content-type': 'text/plain' }, raw: 'hello' }), makeEnv(kv))
    expect(notJson.status).toBe(415)

    const tooBig = await run(post(null, { raw: JSON.stringify({ message: 'x'.repeat(9000) }) }), makeEnv(kv))
    expect(tooBig.status).toBe(413)

    const broken = await run(post(null, { raw: '{not json' }), makeEnv(kv))
    expect(broken.status).toBe(400)
    expect((await readJson(broken)).error).toMatchObject({ code: 'invalid_json' })
  })
})

// ---------------------------------------------------------------------------
// The trap
// ---------------------------------------------------------------------------

describe('the honeypot', () => {
  it('answers a filled trap with a fake success and spends nothing', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const response = await run(post({ ...VALID_BODY, hdl_extra: 'https://spam.example' }), makeEnv(kv))

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ success: true })
    // No Turnstile call, no KV read or write, no email: the bot pays nothing and
    // learns nothing.
    expect(network.calls).toHaveLength(0)
    expect(kv.reads).toBe(0)
    expect(kv.writes).toBe(0)
  })

  it('treats any non-empty value as a trip, whatever its type', async () => {
    kv = new FakeKV()
    stubFetch()
    for (const value of [['x'], { a: 1 }, 7, true]) {
      const response = await run(post({ ...VALID_BODY, hdl_extra: value }), makeEnv(kv))
      expect(response.status, JSON.stringify(value)).toBe(200)
    }
    // Whitespace-only is an empty field, not a trip.
    const blank = await run(post({ ...VALID_BODY, hdl_extra: '   ' }), makeEnv(kv))
    expect(blank.status).toBe(400) // the schema's max(0) still refuses a non-empty string
  })
})

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('the schema', () => {
  it('refuses an empty body field by field', async () => {
    kv = new FakeKV()
    stubFetch()
    const response = await run(post({}), makeEnv(kv))
    expect(response.status).toBe(400)
    const body = await readJson(response)
    expect(body.success).toBe(false)
    expect(body.error).toMatchObject({ code: 'invalid_input' })
    const fields = (body.error as { fields: Record<string, string> }).fields
    // A *missing* key gets the required sentence; a present-but-short value gets
    // the length one. Both are sentences the form can print under the field.
    expect(fields.name).toBe('Name is required')
    expect(fields.email).toBe('Email is required')
    expect(fields.message).toBe('Message is required')
    expect(fields.turnstileToken).toBe('The bot check has not been completed')

    const present = await run(post({ ...VALID_BODY, name: 'A', message: 'too short' }), makeEnv(kv))
    const shortFields = ((await readJson(present)).error as { fields: Record<string, string> }).fields
    expect(shortFields.name).toContain('at least 2')
    expect(shortFields.message).toContain('at least 10')
  })

  it('trims before measuring, and enforces the brief’s ceilings', async () => {
    kv = new FakeKV()
    stubFetch()
    // 2 characters after trimming is enough; the same value with padding is not
    // a longer name.
    expect((await run(post({ ...VALID_BODY, name: '  Ana  ' }), makeEnv(kv))).status).toBe(200)
    expect((await run(post({ ...VALID_BODY, name: ' A ' }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, name: 'x'.repeat(81) }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, email: `${'a'.repeat(95)}@x.com` }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, email: 'not-an-email' }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, message: 'x'.repeat(2001) }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, message: '   short   ' }), makeEnv(kv))).status).toBe(400)
    expect((await run(post({ ...VALID_BODY, message: '   ten chars ' }), makeEnv(kv))).status).toBe(400)
    // Exactly at the floor and the ceiling are both accepted.
    expect((await run(post({ ...VALID_BODY, message: 'x'.repeat(2000) }), makeEnv(kv))).status).toBe(200)
  })

  it('requires a Turnstile token', async () => {
    kv = new FakeKV()
    stubFetch()
    const response = await run(post({ ...VALID_BODY, turnstileToken: '' }), makeEnv(kv))
    expect(response.status).toBe(400)
    expect(((await readJson(response)).error as { fields: Record<string, string> }).fields.turnstileToken).toBeTruthy()
  })

  it('refuses unknown keys rather than ignoring them', async () => {
    kv = new FakeKV()
    stubFetch()
    // The keys that would let a caller choose where the email goes.
    for (const extra of [{ to: 'attacker@example.com' }, { from: 'ceo@example.com' }, { reply_to: 'x@y.z' }]) {
      const response = await run(post({ ...VALID_BODY, ...extra }), makeEnv(kv))
      expect(response.status, JSON.stringify(extra)).toBe(400)
    }
  })

  it('accepts the two optional fields the site sends, and omits them when absent', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const withExtras = await run(post({ ...VALID_BODY, subject: 'Wedding shoot', phone: '09171234567' }), makeEnv(kv))
    expect(withExtras.status).toBe(200)
    const payload = JSON.parse(String(network.toResend()[0]?.init.body)) as { text: string }
    expect(payload.text).toContain('Phone:    09171234567')
    expect(payload.text).toContain('Subject:  Wedding shoot')

    const without = await run(post(VALID_BODY), makeEnv(new FakeKV()))
    expect(without.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

describe('Turnstile', () => {
  it('verifies the token with the secret, the response and the client IP', async () => {
    kv = new FakeKV()
    const network = stubFetch({ turnstile: { success: true } })
    const response = await run(post(VALID_BODY), makeEnv(kv))
    expect(response.status).toBe(200)

    const [call] = network.toTurnstile()
    expect(call?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(call?.init.method).toBe('POST')
    const params = call?.init.body as URLSearchParams
    expect(params.get('secret')).toBe('turnstile-secret')
    expect(params.get('response')).toBe('token-abc')
    expect(params.get('remoteip')).toBe('203.0.113.9')
  })

  it('refuses a failed token with 403 and spends no KV or email quota', async () => {
    kv = new FakeKV()
    const network = stubFetch({ turnstile: { success: false, codes: ['invalid-input-response'] } })
    const response = await run(post(VALID_BODY), makeEnv(kv))
    expect(response.status).toBe(403)
    expect((await readJson(response)).error).toMatchObject({ code: 'bot_check_failed' })
    // The brief's ordering, verified: verification runs before the counter, so a
    // bot with a bad token cannot exhaust the daily KV writes.
    expect(kv.reads).toBe(0)
    expect(kv.writes).toBe(0)
    expect(network.toResend()).toHaveLength(0)
  })

  it('refuses an already-used token', async () => {
    kv = new FakeKV()
    stubFetch({ turnstile: { success: false, codes: ['timeout-or-duplicate'] } })
    expect((await run(post(VALID_BODY), makeEnv(kv))).status).toBe(403)
  })

  it('does not accept a 500 from the challenge service as a pass', async () => {
    kv = new FakeKV()
    stubFetch({ turnstile: { httpStatus: 500 } })
    // Unavailable is not a failure: the inquiry is sent and the log records the
    // degradation.
    expect((await run(post(VALID_BODY), makeEnv(kv))).status).toBe(200)
  })

  it('is not bypassable by an environment variable in production', async () => {
    kv = new FakeKV()
    const network = stubFetch({ turnstile: { success: false, codes: ['invalid-input-response'] } })
    const response = await run(post(VALID_BODY), makeEnv(kv, { TURNSTILE_SKIP_VERIFY: 'true', ENVIRONMENT: 'production' }))
    expect(response.status).toBe(403)
    expect(network.toTurnstile()).toHaveLength(1)
  })

  it('can be skipped locally, and only locally', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const response = await run(post(VALID_BODY), makeEnv(kv, { TURNSTILE_SKIP_VERIFY: 'true', ENVIRONMENT: 'development' }))
    expect(response.status).toBe(200)
    expect(network.toTurnstile()).toHaveLength(0)
  })

  it('fails closed on a missing secret instead of skipping the check', async () => {
    kv = new FakeKV()
    stubFetch()
    // The configuration guard refuses first — a missing secret is a misconfigured
    // worker, not an unverified inquiry.
    const response = await run(post(VALID_BODY), makeEnv(kv, { TURNSTILE_SECRET_KEY: '', ENVIRONMENT: 'production' }))
    expect(response.status).toBe(500)
  })

  it('fails closed when the deployment asks it to', async () => {
    kv = new FakeKV()
    stubFetch({ turnstile: 'throw' })
    const response = await run(post(VALID_BODY), makeEnv(kv, { TURNSTILE_FAIL_CLOSED: 'true' }))
    expect(response.status).toBe(503)
    expect((await readJson(response)).error).toMatchObject({ code: 'bot_check_unavailable' })
    expect(kv.writes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------

describe('the KV rate limit', () => {
  it(`allows ${RATE_LIMIT.max} and then refuses with 429 and Retry-After: ${RATE_LIMIT.windowSeconds}`, async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const env = makeEnv(kv)

    for (let index = 0; index < RATE_LIMIT.max; index += 1) {
      const response = await run(post(VALID_BODY), env)
      expect(response.status, `request ${index + 1}`).toBe(200)
    }
    expect(network.toResend()).toHaveLength(RATE_LIMIT.max)

    const refused = await run(post(VALID_BODY), env)
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe(String(RATE_LIMIT.windowSeconds))
    expect(refused.headers.get('RateLimit-Limit')).toBe(String(RATE_LIMIT.max))
    expect(refused.headers.get('RateLimit-Remaining')).toBe('0')
    const body = await readJson(refused)
    expect(body.success).toBe(false)
    expect(body.error).toMatchObject({ code: 'rate_limited', retry_after_seconds: RATE_LIMIT.windowSeconds })
    expect(String((body.error as { message: string }).message)).toContain('too many times')
    // The sixth request never reached Resend.
    expect(network.toResend()).toHaveLength(RATE_LIMIT.max)
  })

  it('keys by IP, and does not let one address spend another’s allowance', async () => {
    kv = new FakeKV()
    stubFetch()
    const env = makeEnv(kv)
    for (let index = 0; index < RATE_LIMIT.max; index += 1) await run(post(VALID_BODY), env)

    const other = await run(post(VALID_BODY, { headers: { 'cf-connecting-ip': '198.51.100.4' } }), env)
    expect(other.status).toBe(200)
    expect(kv.store.has('rate:198.51.100.4')).toBe(true)
    expect(kv.store.has('rate:203.0.113.9')).toBe(true)
  })

  it('writes the counter with a TTL, and never increments past the ceiling', async () => {
    kv = new FakeKV()
    stubFetch()
    const env = makeEnv(kv)
    for (let index = 0; index < RATE_LIMIT.max; index += 1) await run(post(VALID_BODY), env)

    const writesBefore = kv.writes
    await run(post(VALID_BODY), env)
    // A refused request is not a write: retrying must not pad the counter or
    // extend the lockout.
    expect(kv.writes).toBe(writesBefore)
    expect(kv.lastTtl).toBeGreaterThanOrEqual(60)
    expect(kv.lastTtl).toBeLessThanOrEqual(RATE_LIMIT.windowSeconds)
    expect(JSON.parse(kv.store.get('rate:203.0.113.9') ?? '{}')).toMatchObject({ count: RATE_LIMIT.max })
  })

  it('ignores a spoofed X-Forwarded-For and an address-shaped lie', async () => {
    kv = new FakeKV()
    stubFetch()
    const env = makeEnv(kv)
    const spoofed = await run(
      post(VALID_BODY, { headers: { 'cf-connecting-ip': '', 'x-forwarded-for': '1.2.3.4' } }),
      env,
    )
    expect(spoofed.status).toBe(200)
    // `cf-connecting-ip` is set by Cloudflare's edge; the header the caller can
    // choose is not consulted, so this landed in the "unknown" bucket.
    expect(kv.store.has('rate:unknown')).toBe(true)
    expect(kv.store.has('rate:1.2.3.4')).toBe(false)
  })

  it('fails open, and says so, when KV cannot be read or written', async () => {
    const readFailure = new FakeKV()
    readFailure.failRead = true
    stubFetch()
    const response = await run(post(VALID_BODY), makeEnv(readFailure))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Degraded')).toBe('true')

    const writeFailure = new FakeKV()
    writeFailure.failWrite = true
    const second = await run(post(VALID_BODY), makeEnv(writeFailure))
    expect(second.status).toBe(200)
    expect(second.headers.get('X-RateLimit-Degraded')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

describe('Resend', () => {
  it('sends one email with the brief’s payload', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    const response = await run(post(VALID_BODY), makeEnv(kv))
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ success: true, id: 'email-1' })

    const [call] = network.toResend()
    expect(call?.url).toBe('https://api.resend.com/emails')
    expect(call?.init.method).toBe('POST')
    const headers = call?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer resend-key')
    expect(headers['Content-Type']).toBe('application/json')

    const payload = JSON.parse(String(call?.init.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      from: 'Website Inquiry <onboarding@resend.dev>',
      to: ['inbox@haciendadeluisana.com'],
      reply_to: 'ana@example.com',
      subject: 'New Inquiry from Ana Reyes',
    })
    const text = String(payload.text)
    expect(text).toContain('Ana Reyes')
    expect(text).toContain('ana@example.com')
    expect(text).toContain('203.0.113.9')
    expect(text).toContain('booking the Main House in December')
  })

  it('uses the configured sender when there is one', async () => {
    kv = new FakeKV()
    const network = stubFetch()
    await run(post(VALID_BODY), makeEnv(kv, { FROM_EMAIL: 'Website Inquiry <inquiries@haciendadeluisana.com>' }))
    const payload = JSON.parse(String(network.toResend()[0]?.init.body)) as { from: string }
    expect(payload.from).toBe('Website Inquiry <inquiries@haciendadeluisana.com>')
  })

  it('tells the Guest the truth when Resend refuses or is unreachable', async () => {
    kv = new FakeKV()
    stubFetch({ resend: { status: 422, body: { message: 'invalid to address' } } })
    const rejected = await run(post(VALID_BODY), makeEnv(kv))
    expect(rejected.status).toBe(502)
    const body = await readJson(rejected)
    expect(body.success).toBe(false)
    // Never Resend's own body: it can echo the recipient address.
    expect(JSON.stringify(body)).not.toContain('invalid to address')

    kv = new FakeKV()
    stubFetch({ resend: 'throw' })
    expect((await run(post(VALID_BODY), makeEnv(kv))).status).toBe(502)
  })

  it('does not treat a 200 with no email id as sent', async () => {
    kv = new FakeKV()
    stubFetch({ resend: { status: 200, body: { message: 'queued' } } })
    expect((await run(post(VALID_BODY), makeEnv(kv))).status).toBe(502)
  })

  it('never logs the Guest’s words or address', async () => {
    kv = new FakeKV()
    stubFetch()
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    await run(post(VALID_BODY), makeEnv(kv))
    const joined = logs.join('\n')
    expect(joined).toContain('inquiry_sent')
    expect(joined).not.toContain('ana@example.com')
    expect(joined).not.toContain('Main House')
  })
})

// ---------------------------------------------------------------------------
// The deployment's own defaults
// ---------------------------------------------------------------------------

/**
 * `wrangler.toml` is code: the allowlist in it decides whether the live site can
 * send an inquiry at all. A default that lists only localhost is a worker that
 * refuses every Guest the moment it is deployed — and the failure looks like a
 * CORS error in a console nobody is reading. Both sides are read from the repo,
 * so this fails if either the site's origin or the worker's allowlist moves.
 */
describe('the committed configuration', () => {
  // Paths relative to this package, because the worker's `lib` has no DOM and
  // `@cloudflare/workers-types` declares its own `URL` — `new URL(…, import.meta.url)`
  // is a different type from `node:url`'s. `vitest` runs with the package as cwd.
  const toml = readFileSync('wrangler.toml', 'utf8')
  const site = readFileSync('../../src/config/site.ts', 'utf8')

  it('allows the site the website is actually served from', () => {
    const allowlist = /^ALLOWED_ORIGIN\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? ''
    const origins = allowlist.split(',').map((origin) => origin.trim()).filter(Boolean)
    const siteOrigin = /SITE_ORIGIN\s*=\s*'([^']+)'/.exec(site)?.[1] ?? ''

    expect(siteOrigin, 'src/config/site.ts no longer declares SITE_ORIGIN').not.toBe('')
    expect(origins, 'the deployed site is not in ALLOWED_ORIGIN').toContain(siteOrigin)
    // The dev server, so `npm run dev` can talk to a deployed worker.
    expect(origins).toContain('http://localhost:3000')
  })

  it('cannot leave the development escape hatch on by default', () => {
    expect(/^ENVIRONMENT\s*=\s*"production"/m.test(toml)).toBe(true)
    expect(/TURNSTILE_SKIP_VERIFY\s*=/.test(toml), 'the skip toggle must not be committed').toBe(false)
  })

  it('ships no secret in a committed file', () => {
    // Secrets belong in `wrangler secret put` or `.dev.vars` (gitignored). A key
    // pasted into `[vars]` is a key pasted into Git.
    expect(toml).not.toMatch(/TURNSTILE_SECRET_KEY|RESEND_API_KEY/)
  })
})
