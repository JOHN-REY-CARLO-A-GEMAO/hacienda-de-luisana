// The PIN-reset code: what a locked-out Admin has to receive before the app
// will dispose of a forgotten Security PIN (ADR-0027).
//
// Why this exists: ADR-0016 closed the permanent lockout by letting an Admin's
// own signed-in session delete `admin_security/{uid}` after a 24 h cooldown. It
// was honest about what that cost — **anyone holding a signed-in, unlocked
// phone** could wipe the record and set a new PIN. This function is the door
// that replaces it: the delete now needs proof that the person holding the
// phone can read the Admin's own verified email address.
//
// The call chain, end to end:
//
//   Admin app                   this function                  elsewhere
//   ─────────                   ────────────                  ─────────
//   "Send the code" + Firebase ─► verify the JWT   (firebase-admin)
//   ID token                     read profiles/{uid}.role     ─►  Firestore
//                                require email_verified
//                                rate-limit, mint 6 digits
//                                store the salted SHA-256     ─►  Firestore
//                                                                 admin_security_resets/{uid}
//                                SMTP over TLS                ─►  Gmail   ─►  the Admin's inbox
//   ◄─────────────────────────  { email, masked, expiresIn }
//
//   "I have the code" + code ──► verify the JWT + the digest
//                                delete admin_security/{uid}
//                                delete the reset record
//                                file admin_security_events/PinReset
//   ◄─────────────────────────  { reset: true }
//
// WHAT THIS FUNCTION DOES NOT DO: it never reads, writes, or rotates the PIN
// itself. A successful verify removes the record so `PinGate` reaches
// `setUpNeeded` and the Admin chooses a fresh PIN on the phone — the same
// posture ADR-0016 took, with the identity proof moved from "has the phone" to
// "can read the Admin's email".
//
// DEPLOYMENT:
//
//   supabase functions deploy admin-pin-reset
//   supabase secrets set FIREBASE_PROJECT_ID=hacienda-de-luisana
//   supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON=<service account json>
//   supabase secrets set BOOTSTRAP_ADMIN_EMAILS="gemaojohnreyarguilles@gmail.com"
//   supabase secrets set GMAIL_SMTP_USER=your-gmail@gmail.com
//   supabase secrets set GMAIL_SMTP_APP_PASSWORD=your-16-character-app-password
//
// Gmail SMTP uses the account address as the sender; only an App Password is
// accepted here, never the account's regular password.

import { cert, initializeApp, getApps, type App } from 'npm:firebase-admin@11/app'
import { getAuth, type DecodedIdToken } from 'npm:firebase-admin@11/auth'
import { getFirestore } from 'npm:firebase-admin@11/firestore'
import {
  checkAdminCaller,
  codeUsability,
  maskEmail,
  parseAdminEmails,
} from '../_shared/admin-gate.ts'
import {
  PIN_RESET_CODE_TTL_MS,
  PIN_RESET_MAX_ATTEMPTS,
  PIN_RESET_REQUESTS_PER_HOUR,
  PIN_RESET_REQUEST_COOLDOWN_MS,
  checkRequestPacing,
  hashResetCode,
  isResetCodeShape,
  newCodeSalt,
  newResetCode,
  nextRequestPacingState,
  verifyResetCode,
} from '../_shared/pin-reset-code.ts'

/** Where a pending code and its counters live. Server-written, client-unreadable. */
const RESET_COLLECTION = 'admin_security_resets'
/** The PIN record a confirmed code disposes of (ADR-0015). */
const SECURITY_COLLECTION = 'admin_security'
/** The append-only trail (ADR-0016) the reset writes into. */
const SECURITY_EVENTS_COLLECTION = 'admin_security_events'

/** Gmail implicit-TLS SMTP endpoint. */
const GMAIL_SMTP_HOST = 'smtp.gmail.com'
const GMAIL_SMTP_PORT = 465

/** Warn once per instance, not once per request, when the allowlist secret is unset. */
let warnedMissingBootstrap = false

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // The bodies name an address and a remaining wait; neither is cacheable.
      'cache-control': 'no-store',
    },
  })

/**
 * One Firebase app per isolate, reused across requests.
 *
 * `initializeApp` on every call would re-parse the service account and open a
 * new connection each time an Admin asks for a code.
 */
function firebaseApp(projectId: string): App {
  const existing = getApps()
  if (existing.length > 0) return existing[0]
  const serviceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set')
  return initializeApp(
    { credential: cert(JSON.parse(serviceAccount)), projectId },
    `hacienda-${projectId}`,
  )
}

/** The code email. Plain text plus a minimal HTML part; no link, no images. */
function codeEmail(code: string, minutes: number) {
  const text = [
    'Hello,',
    '',
    'Somebody asked to reset the Security PIN on the Hacienda de LuisAna Admin app',
    'using this email address.',
    '',
    `Your code is: ${code}`,
    '',
    `It works once, and only for the next ${minutes} minutes.`,
    '',
    'If this was you, type the code into the app on the phone that asked for it.',
    'If it was not you, ignore this email: the PIN stays exactly as it is, and',
    'whoever asked learns nothing.',
    '',
    'Thank you,',
    'Hacienda de LuisAna',
  ].join('\n')

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f3ec;font-family:Helvetica,Arial,sans-serif;color:#15241b">
  <div style="max-width:420px;margin:0 auto;background:#fffdf8;border:1px solid #e6e1d3;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7f5d1f">Hacienda de LuisAna</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">Your Security PIN reset code</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4e5e4f">
      Somebody asked to reset the Security PIN on the Admin app using this address.
      Type this code into the app on the phone that asked for it:
    </p>
    <p style="margin:0 0 16px;font-size:34px;letter-spacing:.28em;font-weight:700;color:#15241b">${code}</p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#4e5e4f">
      It works once, and only for the next ${minutes} minutes.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#4e5e4f">
      If this was not you, ignore this email. The PIN stays exactly as it is.
    </p>
  </div>
</body></html>`

  return { text, html }
}

/**
 * Hand the code to Gmail over SMTP/TLS, and say plainly whether it left.
 *
 * The code itself is never logged: a reset code in a log is a reset code in a
 * log reader's hands. Only the address is, because a failed send is diagnosed
 * by knowing where it was going.
 */
function base64(value: string): string {
  return btoa(value)
}

async function smtpWrite(connection: Deno.Conn, value: string): Promise<void> {
  const bytes = new TextEncoder().encode(value)
  let offset = 0
  while (offset < bytes.length) {
    offset += await connection.write(bytes.subarray(offset))
  }
}

async function smtpResponse(connection: Deno.Conn): Promise<{ code: number; text: string }> {
  const decoder = new TextDecoder()
  const bytes = new Uint8Array(1)
  const lines: string[] = []
  let line = ''
  while (true) {
    const count = await connection.read(bytes)
    if (count === null) throw new Error('Gmail closed the SMTP connection')
    const char = decoder.decode(bytes.subarray(0, count))
    line += char
    if (line.endsWith('\n')) {
      const clean = line.replace(/[\r\n]+$/, '')
      lines.push(clean)
      if (/^\d{3} /.test(clean)) break
      line = ''
    }
    if (lines.join('\n').length > 8192) throw new Error('SMTP response was too long')
  }
  const code = Number(lines.at(-1)?.slice(0, 3))
  if (!Number.isFinite(code)) throw new Error('Malformed SMTP response')
  return { code, text: lines.join(' | ') }
}

async function smtpCommand(
  connection: Deno.Conn,
  command: string,
  accepted: number[],
): Promise<string> {
  await smtpWrite(connection, `${command}\r\n`)
  const response = await smtpResponse(connection)
  if (!accepted.includes(response.code)) throw new Error(`SMTP ${response.code}: ${response.text}`)
  return response.text
}

/** Gmail SMTP supports AUTH LOGIN with an App Password on port 465. */
async function sendCodeEmail(
  username: string,
  appPassword: string,
  to: string,
  code: string,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  let connection: Deno.Conn | undefined
  try {
    connection = await Deno.connectTls({ hostname: GMAIL_SMTP_HOST, port: GMAIL_SMTP_PORT })
    const greeting = await smtpResponse(connection)
    if (greeting.code !== 220) throw new Error(`SMTP ${greeting.code}: ${greeting.text}`)
    await smtpCommand(connection, `EHLO hacienda-de-luisana`, [250])
    await smtpCommand(connection, 'AUTH LOGIN', [334])
    await smtpCommand(connection, base64(username), [334])
    await smtpCommand(connection, base64(appPassword.replace(/\s/g, '')), [235])
    await smtpCommand(connection, `MAIL FROM:<${username}>`, [250])
    await smtpCommand(connection, `RCPT TO:<${to}>`, [250, 251])
    await smtpCommand(connection, 'DATA', [354])

    const minutes = Math.round(PIN_RESET_CODE_TTL_MS / 60_000)
    const content = codeEmail(code, minutes)
    const message = [
      `From: Hacienda de LuisAna <${username}>`,
      `To: <${to}>`,
      `Subject: Your Hacienda de LuisAna reset code: ${code}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="hacienda-pin-reset"',
      '',
      '--hacienda-pin-reset',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      content.text,
      '--hacienda-pin-reset',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      content.html,
      '--hacienda-pin-reset--',
      '.',
    ].join('\r\n').replace(/\r?\n\./g, '\r\n..')
    await smtpWrite(connection, `${message}\r\n`)
    const sent = await smtpResponse(connection)
    if (sent.code !== 250) throw new Error(`SMTP ${sent.code}: ${sent.text}`)
    await smtpCommand(connection, 'QUIT', [221])
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'SMTP connection failed'
    console.error(`[admin-pin-reset] Gmail SMTP delivery failed: ${detail.slice(0, 300)}`)
    return { ok: false, status: 0, detail: detail.slice(0, 300) }
  } finally {
    try { connection?.close() } catch { /* already closed */ }
  }
}

/**
 * The body of a call. Two shapes, one endpoint, because the alternative is two
 * functions sharing an auth check and a rate limiter.
 */
type CallBody =
  | { action: 'request'; code?: never }
  | { action: 'verify'; code: string }

function readBody(value: unknown): CallBody | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Send {"action":"request"} or {"action":"verify","code":"123456"}.' }
  }
  const record = value as Record<string, unknown>
  if (record.action === 'request') return { action: 'request' }
  if (record.action === 'verify') {
    const code = record.code
    if (!isResetCodeShape(code)) {
      return { error: 'The code is six digits from the email.' }
    }
    return { action: 'verify', code }
  }
  return { error: 'Send {"action":"request"} or {"action":"verify","code":"123456"}.' }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'No Firebase ID token.' }, 401)

  // ---- who is asking -------------------------------------------------------
  let uid: string
  let decoded: DecodedIdToken
  let firestore: ReturnType<typeof getFirestore>
  try {
    const projectId = Deno.env.get('FIREBASE_PROJECT_ID')
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set')
    const app = firebaseApp(projectId)
    decoded = await getAuth(app).verifyIdToken(token)
    uid = decoded.uid
    firestore = getFirestore(app)
  } catch (error) {
    // Never echo the verifier's complaint: it describes the token, and this
    // body reaches a phone screen.
    console.error('[admin-pin-reset] token rejected', error)
    return json({ error: 'That sign-in could not be verified. Sign in again.' }, 401)
  }

  // ---- what are they asking for -------------------------------------------
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'The request is not valid JSON.' }, 400)
  }
  const parsed = readBody(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400)

  // ---- are they an Admin, with a verified address -------------------------
  let role: unknown
  try {
    const snapshot = await firestore.collection('profiles').doc(uid).get()
    role = snapshot.exists ? snapshot.data()?.role : undefined
  } catch (error) {
    console.error('[admin-pin-reset] profile read failed', error)
    return json({ error: 'Could not confirm your role. Try again in a moment.' }, 503)
  }

  const bootstrapAdminEmails = parseAdminEmails(Deno.env.get('BOOTSTRAP_ADMIN_EMAILS'))
  if (bootstrapAdminEmails.length === 0 && !warnedMissingBootstrap) {
    warnedMissingBootstrap = true
    console.warn('[admin-pin-reset] BOOTSTRAP_ADMIN_EMAILS is not set; relying on profiles only')
  }

  const caller = checkAdminCaller({
    email: decoded.email,
    emailVerified: decoded.email_verified,
    bootstrapAdminEmails,
    role,
  })
  if (!caller.ok) {
    switch (caller.reason) {
      case 'no-email':
        return json({ error: 'This account has no email address to send a code to.' }, 403)
      case 'unverified':
        return json(
          { error: 'Verify your email address first — the code is sent there.' },
          403,
        )
      case 'not-admin':
        return json({ error: 'Only the Admin may reset a Security PIN.' }, 403)
    }
  }
  const email = caller.email

  const resetRef = firestore.collection(RESET_COLLECTION).doc(uid)

  // ---- request: mint, store, mail -----------------------------------------
  if (parsed.action === 'request') {
    const smtpUser = Deno.env.get('GMAIL_SMTP_USER')?.trim() ?? ''
    const appPassword = Deno.env.get('GMAIL_SMTP_APP_PASSWORD')?.trim() ?? ''
    if (smtpUser === '' || appPassword === '') {
      console.error('[admin-pin-reset] Gmail SMTP credentials are not set')
      return json(
        {
          error:
            'Sending reset codes is not set up yet. Ask the developer to finish the mail settings.',
        },
        503,
      )
    }
    const now = Date.now()

    // Mint first, then transact. The digest is a hash of a code that only this
    // request knows, so computing it before the transaction costs nothing when
    // the pacing check refuses — the value is simply dropped.
    const code = newResetCode()
    const salt = newCodeSalt()
    const digest = await hashResetCode(code, salt)

    // The pacing check and the write are one transaction: two taps racing each
    // other cannot both pass the cooldown, and the counters that were read are
    // the counters that are written.
    let pacing:
      | { ok: true }
      | { ok: false; reason: 'cooldown' | 'hourly'; retryAfterMs: number }
    try {
      pacing = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(resetRef)
        const state = snapshot.exists
          ? (snapshot.data() as Record<string, unknown>)
          : undefined
        const stored = state
          ? {
              windowStartedAt:
                typeof state.window_started_at === 'number' ? state.window_started_at : undefined,
              sent: typeof state.sent === 'number' ? state.sent : undefined,
              lastSentAt: typeof state.last_sent_at === 'number' ? state.last_sent_at : undefined,
            }
          : undefined

        const verdict = checkRequestPacing(
          stored,
          now,
          PIN_RESET_REQUEST_COOLDOWN_MS,
          PIN_RESET_REQUESTS_PER_HOUR,
        )
        if (!verdict.ok) return verdict

        // Written in the same commit that mints the code: the counters and the
        // digest can never disagree, and an interrupted request can only ever
        // leave a code nobody was told.
        transaction.set(resetRef, {
          uid,
          email,
          code_hash: digest,
          code_salt: salt,
          attempts: 0,
          issued_at: now,
          expires_at: now + PIN_RESET_CODE_TTL_MS,
          consumed_at: null,
          ...nextRequestPacingState(stored, now),
        })
        return { ok: true } as const
      })
    } catch (error) {
      console.error('[admin-pin-reset] mint failed', error)
      return json({ error: 'Could not send a code just now. Try again in a moment.' }, 503)
    }

    if (!pacing.ok) {
      return json(
        {
          error:
            pacing.reason === 'cooldown'
              ? 'A code was already sent. Wait a minute before asking for another.'
              : 'Three codes have been sent this hour. Try again later.',
          retryAfterMs: pacing.retryAfterMs,
        },
        429,
      )
    }

    // Mailed only after the record exists. If the mail fails, the record stays:
    // it holds the pacing counters (so a repeated failure cannot become a free
    // retry storm) and a digest for a code nobody received, which expires on
    // its own.
    const sent = await sendCodeEmail(smtpUser, appPassword, email, code)
    if (!sent.ok) {
      return json(
        {
          error:
            sent.detail.includes('535') || sent.detail.includes('534')
              ? 'Gmail refused the SMTP login. Check the Gmail address and App Password.'
              : 'Gmail could not send the code right now. Check the server mail settings and try again.',
        },
        502,
      )
    }

    return json({
      sent: true,
      email,
      maskedEmail: maskEmail(email),
      expiresIn: Math.round(PIN_RESET_CODE_TTL_MS / 1000),
      attempts: PIN_RESET_MAX_ATTEMPTS,
    })
  }

  // ---- verify: check the digest, then dispose of the record ---------------
  //
  // The verdict is the transaction's **return value**, not a variable it
  // assigns. That is not style: Firestore may re-run this callback when a
  // concurrent write contends, and a captured `let` would then be read as
  // whatever the *last* attempt wrote while an earlier attempt's writes are the
  // ones that commit. Returning it means each committed attempt carries its own
  // answer, so a retry cannot turn a spent code into an accepted one.
  const code = parsed.code
  let reason: ResetRefusal = 'missing'
  try {
    reason = await firestore.runTransaction(async (transaction): Promise<ResetRefusal> => {
      const snapshot = await transaction.get(resetRef)
      const state = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined
      const now = Date.now()
      const usability = codeUsability(
        state
          ? {
              attempts: typeof state.attempts === 'number' ? state.attempts : undefined,
              expiresAt: typeof state.expires_at === 'number' ? state.expires_at : undefined,
              consumedAt: typeof state.consumed_at === 'number' ? state.consumed_at : null,
            }
          : undefined,
        now,
        PIN_RESET_MAX_ATTEMPTS,
      )
      if (usability !== 'ok') return usability

      const storedHash = typeof state!.code_hash === 'string' ? state!.code_hash : ''
      const salt = typeof state!.code_salt === 'string' ? state!.code_salt : ''
      const matches =
        salt !== '' && storedHash !== '' && (await verifyResetCode(code, salt, storedHash))
      if (!matches) {
        const attempts = (typeof state!.attempts === 'number' ? state!.attempts : 0) + 1
        transaction.update(resetRef, { attempts })
        return attempts >= PIN_RESET_MAX_ATTEMPTS ? 'spent' : 'mismatch'
      }

      // A correct code is consumed in the same transaction that settles the
      // PIN: a second submit cannot spend it twice, and the delete below can
      // only happen once.
      transaction.update(resetRef, { consumed_at: now })
      return 'ok'
    })
  } catch (error) {
    console.error('[admin-pin-reset] verify failed', error)
    return json({ error: 'Could not check the code just now. Try again in a moment.' }, 503)
  }

  if (reason !== 'ok') {
    return json({ error: RESET_REFUSAL[reason], reason }, 400)
  }

  // The reset itself: the PIN record is disposed of, the trail is filed, and the
  // reset record goes with them — one batch, so no state exists in which the
  // code still works after the PIN is gone.
  try {
    const batch = firestore.batch()
    batch.delete(firestore.collection(SECURITY_COLLECTION).doc(uid))
    batch.delete(resetRef)
    batch.set(
      firestore.collection(SECURITY_EVENTS_COLLECTION).doc(`pin-reset-${Date.now()}-${uid}`),
      {
        uid,
        action: 'PinReset',
        // Server-stamped here rather than by `request.time`: this write is made
        // by the Admin SDK, which bypasses the rules that hold a client's `at`
        // to the request. The line keeps the documented three-field shape, and
        // now that clients may not write it at all (ADR-0027), a line existing
        // *is* the record of a code-confirmed reset.
        at: new Date(),
      },
    )
    await batch.commit()
  } catch (error) {
    console.error('[admin-pin-reset] reset commit failed', error)
    return json({ error: 'Could not set the PIN aside. Nothing was changed — try again.' }, 503)
  }

  return json({ reset: true })
})

/** Every way a code check can end, named once so the transaction and the copy agree. */
type ResetRefusal = 'missing' | 'spent' | 'expired' | 'consumed' | 'mismatch' | 'ok'

/** What a failed entry says. Each one is a next step, not a status code. */
const RESET_REFUSAL: Record<ResetRefusal, string> = {
  ok: 'The code was accepted.',
  missing: 'Ask for a code first.',
  spent: 'That code has been used up. Ask for a new one.',
  expired: 'That code has expired. Ask for a new one.',
  consumed: 'That code has already been used. Ask for a new one.',
  mismatch: 'That code is not right. Check the email and try again.',
}

