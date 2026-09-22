// ----------------------------------------------------------------------------
// Credentials: what a person types, and what goes wrong when they type it
// ----------------------------------------------------------------------------
// Every authentication failure the three roles can meet, in one place and in
// words a Guest can act on. Two things live here that used to live in the sign-in
// form alone: the mapping from a provider's error code to a sentence, and the
// validation and sanitising of what was typed before it is sent anywhere.
//
// The codes are Firebase's on purpose. The local demo adapter throws the same
// ones, so one form, one mapping and one set of tests cover both, and swapping a
// deployment from demo mode to Firebase changes nothing a Guest can see.
//
// This is an internal file of the `src/lib/auth` module.
// ----------------------------------------------------------------------------

/** The failures a sign-in, a sign-up or a role change can produce. */
export type AuthErrorCode =
  // Wrong secrets.
  | 'auth/invalid-email'
  | 'auth/invalid-credential'
  | 'auth/user-not-found'
  | 'auth/email-already-in-use'
  | 'auth/weak-password'
  | 'auth/too-many-requests'
  | 'auth/user-disabled'
  // A session that is over.
  | 'auth/user-token-expired'
  | 'auth/network-request-failed'
  | 'auth/popup-closed-by-user'
  | 'auth/operation-not-allowed'
  // This system's own refusals.
  | 'hdl/forbidden'
  | 'hdl/not-configured'
  | 'hdl/unavailable'
  | 'hdl/unknown'

const MESSAGES: Record<AuthErrorCode, string> = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/invalid-credential': 'Invalid email or password. Please try again.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/email-already-in-use': 'An account with this email already exists. Try logging in.',
  'auth/weak-password': 'Password must be at least 6 characters',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/user-disabled': 'That account has been disabled. Ask the Host to re-enable it.',
  'auth/user-token-expired': 'Your session has expired. Please sign in again.',
  'auth/network-request-failed': 'Cannot reach the server. Check your connection and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/operation-not-allowed': 'That sign-in method is not enabled on this project.',
  'hdl/forbidden': 'Your role does not allow that.',
  'hdl/not-configured': 'Firebase Auth is not configured. Check your .env.local',
  'hdl/unavailable': 'That is not available here.',
  'hdl/unknown': 'Something went wrong. Please try again.',
}

/**
 * An authentication failure, carrying the code a caller branches on and a
 * message that is safe to show whoever met it.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? MESSAGES[code])
    this.name = 'AuthError'
    this.code = code
  }
}

/** Read a code out of anything that was thrown, tolerating Firebase's `auth/` prefix. */
function codeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const raw = (error as { code?: unknown }).code
  if (typeof raw !== 'string' || !raw) return null
  return raw.startsWith('auth/') ? raw : `auth/${raw}`
}

const KNOWN = new Set(Object.keys(MESSAGES))

/**
 * Whatever was thrown, as an AuthError with a message for a person.
 *
 * Unknown codes keep their own message when they have one — a Host setting the
 * project up needs to read what Firebase actually said — but never their stack.
 */
export function describeAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error
  const code = codeOf(error)
  if (code && KNOWN.has(code)) return new AuthError(code as AuthErrorCode)
  const message = typeof error === 'string' ? error : (error as { message?: unknown })?.message
  return new AuthError('hdl/unknown', typeof message === 'string' && message.trim() ? message.trim() : undefined)
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/** Firebase's own floor for a password; going lower only buys a refused sign-up. */
export const MIN_PASSWORD_LENGTH = 6
/** Long enough for any real password, short enough that hashing stays quick. */
export const MAX_PASSWORD_LENGTH = 200
const MAX_EMAIL_LENGTH = 254
const MAX_NAME_LENGTH = 80
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type Credentials = { email: string; password: string }
export type Registration = Credentials & { displayName?: string }

export type Accepted<T> = { ok: true; value: T }
export type Rejected = { ok: false; field: 'email' | 'password' | 'displayName'; error: AuthError }

/** An email address, trimmed and folded — the way every provider stores it. */
function sanitizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** A display name with the whitespace and control characters taken out of it. */
function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

function checkEmail(raw: unknown): string | null {
  const email = sanitizeEmail(raw)
  if (!email) return 'Please enter your email address.'
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) return MESSAGES['auth/invalid-email']
  return null
}

function checkPassword(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return 'Please enter your password.'
  if (raw.length < MIN_PASSWORD_LENGTH) return MESSAGES['auth/weak-password']
  if (raw.length > MAX_PASSWORD_LENGTH) return 'That password is too long to use.'
  return null
}

/** An email address on its own, for the one flow that asks for nothing else. */
export function validateEmail(raw: unknown): Accepted<{ email: string }> | Rejected {
  const problem = checkEmail(raw)
  if (problem) return { ok: false, field: 'email', error: new AuthError('auth/invalid-email', problem) }
  return { ok: true, value: { email: sanitizeEmail(raw) } }
}

/**
 * An email and password, checked and sanitised before either is sent anywhere.
 *
 * The same gate stands in front of signing in and signing up, so a form cannot
 * reach a provider with something that was always going to be refused.
 */
export function validateCredentials(raw: { email?: unknown; password?: unknown }): Accepted<Credentials> | Rejected {
  const emailProblem = checkEmail(raw.email)
  if (emailProblem) return { ok: false, field: 'email', error: new AuthError('auth/invalid-email', emailProblem) }
  const passwordProblem = checkPassword(raw.password)
  if (passwordProblem) {
    return {
      ok: false,
      field: 'password',
      error: new AuthError(
        passwordProblem === MESSAGES['auth/weak-password'] ? 'auth/weak-password' : 'auth/invalid-credential',
        passwordProblem,
      ),
    }
  }
  return { ok: true, value: { email: sanitizeEmail(raw.email), password: raw.password as string } }
}

/**
 * A sign-up, checked and sanitised.
 *
 * There is deliberately no role to validate: a sign-up is always a Guest, and
 * only a Host can make anybody anything else (ADR-0005).
 */
export function validateRegistration(raw: {
  email?: unknown
  password?: unknown
  displayName?: unknown
}): Accepted<Registration> | Rejected {
  const credentials = validateCredentials(raw)
  if (!credentials.ok) return credentials
  const displayName = sanitizeDisplayName(raw.displayName)
  return {
    ok: true,
    value: displayName ? { ...credentials.value, displayName } : credentials.value,
  }
}
