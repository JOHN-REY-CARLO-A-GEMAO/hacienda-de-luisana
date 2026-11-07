/**
 * The Admin gate behind the PIN-reset function: who is asking, and are they the
 * Admin?
 *
 * Deliberately a sibling of `admin-payment-proof/index.ts` rather than a shared
 * import, because the two answer slightly different questions:
 *
 *   - `admin-payment-proof` admits the bootstrap allowlist *or* a Profile that
 *     says `admin`;
 *   - this one also requires the Firebase account to have a **verified email**,
 *     because the email address is where the code goes. A reset code mailed to
 *     an unverified address is a code mailed to whoever typed it in.
 *
 * The role is read from Firestore `profiles/{uid}` with the service account,
 * exactly as the proof function does and for the same reason: `profiles` is a
 * Firestore collection, not a Postgres table, and the Admin app's own claim is
 * never trusted. `BOOTSTRAP_ADMIN_EMAILS` is the allowlist fallback, kept in the
 * function's environment rather than restated as a literal.
 */

export interface AdminCheckInput {
  email: string | null | undefined
  emailVerified: boolean | undefined
  bootstrapAdminEmails: readonly string[]
  role: unknown
}

export type AdminCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'no-email' | 'unverified' | 'not-admin' }

/**
 * Decide, in one place, whether this verified token belongs to the Admin.
 *
 * `emailVerified` is checked before the role so the refusal says the useful
 * thing: an Admin whose address is unverified is told to verify it, not that
 * they are not the Admin.
 */
export function checkAdminCaller(input: AdminCheckInput): AdminCheck {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email === '') return { ok: false, reason: 'no-email' }
  if (input.emailVerified !== true) return { ok: false, reason: 'unverified' }

  const isBootstrap =
    input.bootstrapAdminEmails.includes(email) && input.emailVerified === true
  if (input.role !== 'admin' && !isBootstrap) {
    return { ok: false, reason: 'not-admin' }
  }
  return { ok: true, email }
}

/** The allowlist secret, parsed the one way this project parses it. */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/**
 * May this stored code still be tried?
 *
 * Every reason here is a refusal the app already knows by the time it gets
 * there — an expired code, a consumed one — but the check has to exist on the
 * server too: the app is a screen, and the screen is not the boundary.
 */
export function codeUsability(
  code: { attempts?: number; expiresAt?: number; consumedAt?: number | null } | undefined,
  now: number,
  maxAttempts: number,
): 'ok' | 'spent' | 'expired' | 'consumed' {
  if (!code) return 'spent'
  if (typeof code.consumedAt === 'number') return 'consumed'
  const attempts = code.attempts ?? 0
  if (attempts >= maxAttempts) return 'spent'
  if (typeof code.expiresAt !== 'number' || code.expiresAt <= now) return 'expired'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Enough of an address to recognise, not enough to leak it to a shoulder.
 *
 * `gemaojohnreyarguilles@gmail.com` becomes `g***s@gmail.com`: the first and
 * last character of the local part, and the domain. The Admin knows their own
 * address; anyone else holding the phone learns almost nothing, and the
 * sentence is written against `email_verified` so a stale, unverified address
 * can never be the one a code is sent to.
 */
export function maskEmail(address: string): string {
  const trimmed = address.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return 'your registered email'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (domain === '') return 'your registered email'
  const head = local[0]
  const tail = local.length > 1 ? local[local.length - 1] : ''
  return `${head}***${tail}@${domain}`
}
