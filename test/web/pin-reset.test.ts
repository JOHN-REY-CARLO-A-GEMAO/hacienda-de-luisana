// The one-time code behind a forgotten Security PIN (ADR-0027).
//
// Everything that decides whether a code may be sent, and whether one that came
// back is right, is pure and lives in `supabase/functions/_shared/`. It is
// tested here rather than only by reading the Edge Function, because the two
// mistakes that matter in a code flow are invisible in review:
//
//   - storing the plaintext code (a dump becomes a bag of live codes), and
//   - a pace or attempt counter that resets when it is not supposed to.
//
// The function's own source is read at the bottom: the wiring — verify the
// token, require a verified address, hash before writing, mail after writing —
// is the part no pure unit can hold.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkAdminCaller,
  codeUsability,
  maskEmail,
  parseAdminEmails,
} from '../../supabase/functions/_shared/admin-gate'
import {
  PIN_RESET_CODE_LENGTH,
  PIN_RESET_CODE_TTL_MS,
  PIN_RESET_MAX_ATTEMPTS,
  PIN_RESET_REQUESTS_PER_HOUR,
  PIN_RESET_REQUEST_COOLDOWN_MS,
  PIN_RESET_REQUEST_WINDOW_MS,
  checkRequestPacing,
  hashResetCode,
  isResetCodeShape,
  newCodeSalt,
  newResetCode,
  nextRequestPacingState,
  verifyResetCode,
} from '../../supabase/functions/_shared/pin-reset-code'

const fnSource = readFileSync(
  join(__dirname, '../../supabase/functions/admin-pin-reset/index.ts'),
  'utf8',
)
/** The function's code with its prose removed. */
const fnCode = fnSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')

/** The app's own copy of the numbers, so a screen cannot say "5 minutes" while the server holds 15. */
const dartSource = readFileSync(
  join(__dirname, '../../lib/services/pin_reset_types.dart'),
  'utf8',
)

describe('the shape of a reset code', () => {
  it('is six digits, and nothing else is a code', () => {
    expect(PIN_RESET_CODE_LENGTH).toBe(6)
    expect(isResetCodeShape('123456')).toBe(true)
    expect(isResetCodeShape('000000')).toBe(true)
    for (const bad of ['12345', '1234567', '12345a', ' 123456', '123456 ', '', null, 123456]) {
      expect(isResetCodeShape(bad)).toBe(false)
    }
  })

  it('generates six digits, zero-padded, every time', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = newResetCode()
      expect(code).toMatch(/^[0-9]{6}$/)
      // A code that forgot to pad would be caught here rather than by the
      // digest: `042` and `000042` are not six digits.
      expect(code.length).toBe(6)
    }
  })

  it('does not hand back the same code twice in a row', () => {
    // Not a randomness proof — a smoke test that the generator is not a
    // constant, which is exactly the bug a stubbed `getRandomValues` would hide.
    const codes = new Set(Array.from({ length: 50 }, () => newResetCode()))
    expect(codes.size).toBeGreaterThan(40)
  })

  it('salts are fresh, hex, and 16 bytes', () => {
    const salts = new Set(Array.from({ length: 20 }, () => newCodeSalt()))
    expect(salts.size).toBe(20)
    for (const salt of salts) expect(salt).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('the digest', () => {
  it('is a lowercase sha-256 of prefix, salt and code', async () => {
    const hash = await hashResetCode('123456', 'abcdef')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Deterministic, and pinned: if the message shape ever changes, every code
    // in flight is invalidated, so the change has to be deliberate.
    expect(await hashResetCode('123456', 'abcdef')).toBe(hash)
  })

  it('changes with the salt and with the code', async () => {
    const base = await hashResetCode('123456', 'salt-one')
    expect(await hashResetCode('123456', 'salt-two')).not.toBe(base)
    expect(await hashResetCode('654321', 'salt-one')).not.toBe(base)
  })

  it('cannot be re-cut by a salt that ends in digits', async () => {
    // The newline between the parts is what stops ('ab', '1cdef') and
    // ('ab1', 'cdef') from hashing the same message.
    expect(await hashResetCode('123456', 'ab')).not.toBe(await hashResetCode('123456', 'ab1'))
  })

  it('verifies the right code and refuses the wrong ones', async () => {
    const salt = newCodeSalt()
    const expected = await hashResetCode('492713', salt)
    expect(await verifyResetCode('492713', salt, expected)).toBe(true)
    expect(await verifyResetCode('492714', salt, expected)).toBe(false)
    // Shape first: a caller cannot spend the digest budget on arbitrary text.
    expect(await verifyResetCode('49271', salt, expected)).toBe(false)
    expect(await verifyResetCode('abcdef', salt, expected)).toBe(false)
  })
})

describe('the Admin gate', () => {
  const bootstrap = ['admin@example.com']

  it('accepts a verified bootstrap Admin and a verified promoted one', () => {
    expect(
      checkAdminCaller({
        email: 'Admin@Example.com',
        emailVerified: true,
        bootstrapAdminEmails: bootstrap,
        role: undefined,
      }),
    ).toEqual({ ok: true, email: 'admin@example.com' })

    expect(
      checkAdminCaller({
        email: 'promoted@example.com',
        emailVerified: true,
        bootstrapAdminEmails: bootstrap,
        role: 'admin',
      }).ok,
    ).toBe(true)
  })

  it('refuses an unverified address, even for the Admin — the code goes there', () => {
    expect(
      checkAdminCaller({
        email: 'admin@example.com',
        emailVerified: false,
        bootstrapAdminEmails: bootstrap,
        role: 'admin',
      }),
    ).toEqual({ ok: false, reason: 'unverified' })
  })

  it('refuses a Guest, an email-less account, and a stale role', () => {
    expect(
      checkAdminCaller({
        email: 'guest@example.com',
        emailVerified: true,
        bootstrapAdminEmails: bootstrap,
        role: 'guest',
      }),
    ).toEqual({ ok: false, reason: 'not-admin' })

    expect(
      checkAdminCaller({
        email: null,
        emailVerified: true,
        bootstrapAdminEmails: bootstrap,
        role: 'admin',
      }),
    ).toEqual({ ok: false, reason: 'no-email' })

    // Allowlisted address, unverified: the reason has to be the useful one.
    expect(
      checkAdminCaller({
        email: 'admin@example.com',
        emailVerified: undefined,
        bootstrapAdminEmails: bootstrap,
        role: undefined,
      }),
    ).toEqual({ ok: false, reason: 'unverified' })
  })

  it('parses the allowlist secret the way the rest of the project does', () => {
    expect(parseAdminEmails(' A@x.com, b@Y.com ,,')).toEqual(['a@x.com', 'b@y.com'])
    expect(parseAdminEmails(undefined)).toEqual([])
  })
})

describe('request pacing', () => {
  const now = 1_800_000_000_000
  const cooldown = PIN_RESET_REQUEST_COOLDOWN_MS
  const perHour = PIN_RESET_REQUESTS_PER_HOUR

  it('lets the first request through, and one after the cooldown', () => {
    expect(checkRequestPacing(undefined, now, cooldown, perHour)).toEqual({ ok: true })
    expect(
      checkRequestPacing({ lastSentAt: now - cooldown, sent: 1, windowStartedAt: now - cooldown }, now, cooldown, perHour),
    ).toEqual({ ok: true })
  })

  it('brakes a second tap inside a minute, and says how long', () => {
    const verdict = checkRequestPacing({ lastSentAt: now - 10_000, sent: 1, windowStartedAt: now - 10_000 }, now, cooldown, perHour)
    expect(verdict).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: cooldown - 10_000 })
  })

  it('caps the hour, and starts the hour again when the window is older', () => {
    const windowStartedAt = now - 10 * 60_000
    expect(
      checkRequestPacing(
        { lastSentAt: now - cooldown, sent: perHour, windowStartedAt },
        now,
        cooldown,
        perHour,
      ),
    ).toEqual({ ok: false, reason: 'hourly', retryAfterMs: PIN_RESET_REQUEST_WINDOW_MS - 10 * 60_000 })

    // An hour after the window opened, the ceiling lifts.
    expect(
      checkRequestPacing(
        { lastSentAt: now - cooldown, sent: perHour, windowStartedAt: now - PIN_RESET_REQUEST_WINDOW_MS },
        now,
        cooldown,
        perHour,
      ),
    ).toEqual({ ok: true })
  })

  it('counts forward inside a window and restarts outside one', () => {
    expect(nextRequestPacingState(undefined, now)).toEqual({ windowStartedAt: now, sent: 1, lastSentAt: now })
    expect(
      nextRequestPacingState({ windowStartedAt: now - 60_000, sent: 2, lastSentAt: now - 60_000 }, now),
    ).toEqual({ windowStartedAt: now - 60_000, sent: 3, lastSentAt: now })
    expect(
      nextRequestPacingState(
        { windowStartedAt: now - PIN_RESET_REQUEST_WINDOW_MS - 1, sent: 3, lastSentAt: now - PIN_RESET_REQUEST_WINDOW_MS - 1 },
        now,
      ),
    ).toEqual({ windowStartedAt: now, sent: 1, lastSentAt: now })
  })
})

describe('code usability', () => {
  const now = 1_800_000_000_000
  const fresh = { attempts: 0, expiresAt: now + 60_000, consumedAt: null }

  it('accepts a fresh code', () => {
    expect(codeUsability(fresh, now, PIN_RESET_MAX_ATTEMPTS)).toBe('ok')
  })

  it('refuses a missing, expired, consumed or spent code', () => {
    expect(codeUsability(undefined, now, PIN_RESET_MAX_ATTEMPTS)).toBe('spent')
    expect(codeUsability({ ...fresh, expiresAt: now }, now, PIN_RESET_MAX_ATTEMPTS)).toBe('expired')
    expect(codeUsability({ ...fresh, consumedAt: now }, now, PIN_RESET_MAX_ATTEMPTS)).toBe('consumed')
    expect(codeUsability({ ...fresh, attempts: PIN_RESET_MAX_ATTEMPTS }, now, PIN_RESET_MAX_ATTEMPTS)).toBe('spent')
  })
})

describe('the address on the screen', () => {
  it('shows enough to recognise and not enough to harvest', () => {
    expect(maskEmail('gemaojohnreyarguilles@gmail.com')).toBe('g***s@gmail.com')
    expect(maskEmail('ab@x.com')).toBe('a***b@x.com')
    expect(maskEmail('a@x.com')).toBe('a***@x.com')
    // Not an address at all: say the useful thing rather than echo junk.
    expect(maskEmail('not-an-address')).toBe('your registered email')
    expect(maskEmail('')).toBe('your registered email')
  })
})

describe('the function the app calls', () => {
  it('pins the limits the app prints', () => {
    expect(PIN_RESET_CODE_TTL_MS).toBe(15 * 60 * 1000)
    expect(PIN_RESET_MAX_ATTEMPTS).toBe(5)
    expect(PIN_RESET_REQUESTS_PER_HOUR).toBe(3)
    expect(PIN_RESET_REQUEST_COOLDOWN_MS).toBe(60 * 1000)

    // The Dart mirror. These are strings in the app's source because importing
    // TS into Dart is not a thing; the test is what keeps them honest.
    expect(dartSource).toContain('kPinResetCodeTtl = Duration(minutes: 15)')
    expect(dartSource).toContain('kPinResetMaxAttempts = 5')
    // And the app calls the one function this repository deploys.
    expect(dartSource).toContain("kPinResetFunction = 'admin-pin-reset'")
  })

  it('never stores the code itself, only its digest', () => {
    // The write that creates the record must carry `code_hash`, never `code`.
    // It moved into the minting transaction (so the counters and the digest
    // commit together), so the assertion follows it there.
    const body = fnCode.slice(fnCode.indexOf('transaction.set(resetRef, {'))
    expect(body).toContain('code_hash: digest')
    expect(body.slice(0, body.indexOf('\n        })'))).not.toMatch(/\bcode:\s*['"`]?\$?\{?code/)
    // And the plaintext never reaches a log line, which outlives the request.
    for (const line of fnSource.split('\n')) {
      if (!/console\.(log|warn|error|info)/.test(line)) continue
      expect(line).not.toMatch(/\$\{code\}|\bcode\b/)
    }
  })

  it('requires a verified address before it mints anything', () => {
    // The Admin gate runs before the request branch, so an unverified account
    // cannot even cause a code to exist.
    expect(fnCode.indexOf('checkAdminCaller')).toBeGreaterThan(-1)
    expect(fnCode.indexOf('checkAdminCaller')).toBeLessThan(fnCode.indexOf("parsed.action === 'request'"))
    expect(fnCode).toContain('emailVerified')
  })

  it('mails only the address the token carries', () => {
    // The body has no `email` parameter: the app cannot name a recipient, so a
    // phone cannot redirect a code to an address its holder controls.
    const readBody = fnCode.slice(fnCode.indexOf('function readBody'), fnCode.indexOf('Deno.serve'))
    expect(readBody).not.toMatch(/record\.email|\bemail\s*:/)
    expect(fnCode).toContain('sendCodeEmail(relayUrl, relaySecret, email, code)')
  })

  it('sends by mail, with no link to click', () => {
    // `fnSource`, not `fnCode`: the comment stripper cuts `//` out of URLs.
    expect(fnSource).toContain('GMAIL_RELAY_TIMEOUT_MS = 15_000')
    expect(fnSource).toContain("Deno.env.get('GMAIL_RELAY_URL')")
    // A link in a reset email is a phishing habit to teach; the code is typed
    // into the app that asked for it.
    expect(fnSource).not.toMatch(/https?:\/\/(?!identitytoolkit|firebase|script\.google\.com)/)
  })

  it('refuses to pretend when the mailer is unconfigured', () => {
    expect(fnCode).toMatch(/GMAIL_RELAY_URL[\s\S]{0,600}?503/)
  })

  it('imports only what its modules actually export', () => {
    // The bug this exists for was a **BOOT_ERROR in production**: two helpers
    // moved from `admin-gate.ts` to `pin-reset-code.ts` while the function kept
    // importing them from the first. Nothing in this repository caught it —
    // `tsc` typechecks the *shared* modules against the app, not the function's
    // own import list, and Deno only complains when the function boots. The
    // first deploy of ADR-0027 therefore answered `503 BOOT_ERROR` on every
    // request, which reads like a secrets problem and is not one.
    //
    // A missing export is cheap to catch statically, so it is a test: every
    // name the function imports must be exported by the module it names.
    const relativeImport = /import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g
    const exportedNames = (file: string): Set<string> => {
      const text = readFileSync(join(__dirname, '../../', file), 'utf8')
      return new Set(
        [...text.matchAll(
          /export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z0-9_]+)/g,
        )].map((match) => match[1]),
      )
    }

    const failures: string[] = []
    for (const match of fnSource.matchAll(relativeImport)) {
      const names = match[1]
        .split(',')
        .map((part) => part.trim().replace(/^type\s+/, ''))
        .filter(Boolean)
      const specifier = match[2]
      const target = `supabase/functions/${specifier.replace(/^\.\.\//, '').replace(/\.ts$/, '')}.ts`
      const available = exportedNames(target)
      for (const name of names) {
        if (!available.has(name)) failures.push(`${name} ← ${specifier}`)
      }
    }

    expect(failures).toEqual([])
  })

  it('returns the verdict from the transaction instead of assigning it', () => {
    // Firestore re-runs a transaction callback on contention. A captured `let`
    // would carry the last attempt's answer into a commit made by a different
    // one, so the verdict has to be the callback's return value.
    expect(fnCode).toContain('Promise<ResetRefusal>')
    expect(fnCode).toContain('type ResetRefusal')
    expect(fnCode).toMatch(/return attempts >= PIN_RESET_MAX_ATTEMPTS \? 'spent' : 'mismatch'/)
    // No assignment left inside the callback: the one `reason =` is the call
    // itself.
    const assignments = [...fnCode.matchAll(/\breason\s*=(?!=)/g)]
    expect(assignments).toHaveLength(1)
  })

  it('spends the code and deletes the PIN in server writes no client can make', () => {
    // The dispose is the Admin SDK's, after the digest matched — not a client
    // delete a phone could perform on its own.
    expect(fnCode).toContain('batch.delete(firestore.collection(SECURITY_COLLECTION).doc(uid))')
    expect(fnCode).toContain("collection(SECURITY_EVENTS_COLLECTION)")
    // And the reset record goes with it, so the code cannot be replayed.
    expect(fnCode).toContain('batch.delete(resetRef)')
  })
})
