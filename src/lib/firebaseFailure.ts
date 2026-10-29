// ----------------------------------------------------------------------------
// Firebase's refusals, said in words a person can act on
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The website can be perfectly wired and still be refused by the project behind
// it: Anonymous sign-in switched off, the rules never deployed, the database
// never created, a domain missing from the authorized list. Each of those
// arrives as a code — `auth/operation-not-allowed`, `permission-denied`,
// `not-found` — and none of them means anything to the person reading the
// screen, or to the owner who has to go and fix it.
//
// One place translates them. The device that hits the failure tells the Guest
// what to do differently; this tells the owner what to switch on. Pure: no SDK
// import, no browser API, so it is a test rather than a guess
// (`test/web/firebase-config.test.ts`).
// ----------------------------------------------------------------------------

export type FailureWords = {
  /** The code as it arrived, or 'unknown'. */
  code: string
  /** The sentence a Guest or the owner reads. */
  advice: string
  /** What Firebase itself said, when it said anything. */
  message?: string
}

/** The `code` off whatever was thrown, when it looks like a Firebase error. */
export function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'unknown'
}

function messageOf(error: unknown): string | undefined {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.length > 0 ? message : undefined
}

const CONSOLE_AUTH = 'Firebase console → Authentication → Sign-in method'
const CONSOLE_DOMAINS = 'Firebase console → Authentication → Settings → Authorized domains'

const AUTH_ADVICE: Record<string, string> = {
  'auth/operation-not-allowed':
    `Anonymous sign-in is switched off for this project, so the website cannot attach a Guest ` +
    `identity to a Booking. Turn it on in ${CONSOLE_AUTH} (Anonymous), and enable Email/Password ` +
    `and Google there too if Guests should be able to sign in.`,
  'auth/api-key-not-valid':
    'The Firebase API key this build was given is not accepted by the project. Check ' +
    'VITE_FIREBASE_API_KEY in the hosting dashboard (or src/lib/firebaseDefaults.ts) and rebuild.',
  'auth/invalid-api-key':
    'The Firebase API key this build was given is malformed. Check VITE_FIREBASE_API_KEY in the ' +
    'hosting dashboard (or src/lib/firebaseDefaults.ts) and rebuild.',
  'auth/unauthorized-domain':
    `This domain is not on the project's authorized list, so sign-in popups are refused. Add it in ` +
    `${CONSOLE_DOMAINS} (the site's own domain, no protocol or path).`,
  'auth/network-request-failed':
    'The browser could not reach Firebase — offline, or something on the device is blocking it. ' +
    'A Guest sees this as a slow connection, not as a setting to change.',
  'auth/too-many-requests':
    'Firebase is refusing further sign-ins from this device for now (too many attempts). Wait a ' +
    'minute, or check for a loop that signs in again and again.',
  'auth/quota-exceeded':
    'The project has reached its sign-in quota for today. Nothing on the website can fix that.',
  'auth/internal-error':
    'Firebase answered with an internal error. Usually transient; retry, and check the Firebase ' +
    'status page if it persists.',
}

const FIRESTORE_ADVICE: Record<string, string> = {
  'permission-denied':
    'Firestore refused the write. For a Booking create, this error does not identify which ' +
    'firestore.rules condition failed: the deployed rules may be outdated, the Booking may be ' +
    'missing its Guest identity, or its payment/rate snapshot may not match the current ' +
    'site_config/rates policy. Check /status for sign-in and reads, then compare the current ' +
    'published quote. If the browser also reports ERR_BLOCKED_BY_CLIENT for firestore.googleapis.com, ' +
    'retry without privacy or ad-blocking extensions; that blocked channel may be separate.',
  unauthenticated:
    `The request reached Firestore with no usable sign-in. Enable Anonymous sign-in in ` +
    `${CONSOLE_AUTH} so the website can attach an identity to a Booking.`,
  'not-found':
    'This project has no Firestore database yet. Create one in Firebase console → Build → ' +
    'Firestore Database.',
  unavailable:
    'Firestore could not be reached from this browser — offline, blocked, or the project is ' +
    'having a bad day. The Bookings screen reads from what is already here.',
  'failed-precondition':
    'Firestore refused the query for a missing index or an invalid document shape. Check ' +
    'firebase deploy --only firestore:indexes and the fields being written.',
  'resource-exhausted':
    'The project has hit its Firestore quota (free plans have a daily limit on reads and writes).',
  'already-exists':
    'Firestore refused the create because the document or held dates already exist.',
  'invalid-argument':
    'Firestore refused the data itself — a field that should be a string is not, or a document ' +
    'id is empty.',
}

/** What to tell a person about a refused sign-in. */
export function describeAuthFailure(error: unknown): FailureWords {
  const code = codeOf(error)
  return {
    code,
    advice:
      AUTH_ADVICE[code] ??
      'Sign-in failed for a reason this build does not know how to explain. The Firebase console ' +
        'shows the project’s own log of it.',
    message: messageOf(error),
  }
}

/** What to tell a person about a refused Booking write or read. */
export function describeFirestoreFailure(error: unknown): FailureWords {
  const code = codeOf(error)
  return {
    code,
    advice:
      FIRESTORE_ADVICE[code] ??
      'Firestore refused the request for a reason this build does not know how to explain. Check ' +
        'the Firebase console for the project.',
    message: messageOf(error),
  }
}

/** One line, for a console warning. */
export function failureLine(words: FailureWords): string {
  return `[${words.code}] ${words.advice}`
}

const INTERNAL_SDK_CODES = new Set([
  'internal',
  'not-found',
  'unimplemented',
  'invalid-argument',
  'aborted',
  'cancelled',
  'data-loss',
])

const RAW_INTERNAL_MESSAGE_RE =
  /FirebaseError:|firestore\.googleapis\.com|projects\/[A-Za-z0-9_-]+\/databases|\b(?:functions|auth|firestore|storage)\/[a-z-]+|\[code=[a-z-]+\]|\b(?:TypeError|ReferenceError|RangeError|SyntaxError):|\n\s*at\s+/i

function hasCuratedGuestMessage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { from_server_details?: unknown; name?: unknown }
  return candidate.from_server_details === true || candidate.name === 'QuoteRefusedError'
}

/**
 * Maps technical or Firebase errors to understandable, friendly messages for guests.
 * Keeps technical details out of guest-facing UI while keeping technical errors in development logs.
 */
export function guestFacingErrorMessage(
  error: unknown,
  fallbackMessage = "We couldn't submit your request right now. Please try again.",
): string {
  if (!error) return fallbackMessage

  const code = codeOf(error)
  const normalizedCode = code.replace(/^(?:functions|firestore|storage)\//, '')
  const message = messageOf(error) ?? (typeof error === 'string' ? error : '')
  const lowerMessage = message.toLowerCase()

  // Preserve server-curated Guest guidance (e.g., submitBooking DATE_UNAVAILABLE
  // or QuoteRefusedError) before generic status-code fallbacks overwrite it.
  if (hasCuratedGuestMessage(error) && message && !RAW_INTERNAL_MESSAGE_RE.test(message)) {
    return message
  }

  if (
    normalizedCode === 'resource-exhausted' ||
    code === 'auth/too-many-requests' ||
    code === 'auth/quota-exceeded' ||
    lowerMessage.includes('resource-exhausted') ||
    lowerMessage.includes('too-many-requests') ||
    lowerMessage.includes('quota-exceeded')
  ) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (
    normalizedCode === 'already-exists' ||
    lowerMessage.includes('already-exists') ||
    lowerMessage.includes('document already exists')
  ) {
    return 'Those dates or this booking are no longer available. Please review your selection and try again.'
  }
  if (normalizedCode === 'permission-denied' || lowerMessage.includes('permission-denied')) {
    return "We couldn't submit your booking right now. Please try again."
  }
  if (normalizedCode === 'failed-precondition' || lowerMessage.includes('failed-precondition')) {
    return "We couldn't process this request with the current details. Please check your stay details and try again."
  }
  if (
    normalizedCode === 'unavailable' ||
    normalizedCode === 'deadline-exceeded' ||
    code === 'network-request-failed' ||
    code === 'auth/network-request-failed' ||
    lowerMessage.includes('network-request-failed') ||
    lowerMessage.includes('deadline-exceeded') ||
    lowerMessage.includes('failed to fetch')
  ) {
    return 'Your internet connection appears to be unavailable. Please check your connection and try again.'
  }
  if (
    normalizedCode === 'unauthenticated' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential'
  ) {
    return 'Invalid email or password. Please try again.'
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Please sign in instead.'
  }
  if (
    INTERNAL_SDK_CODES.has(normalizedCode) ||
    code.startsWith('auth/') ||
    code.startsWith('functions/') ||
    code.startsWith('firestore/') ||
    code.startsWith('storage/')
  ) {
    return fallbackMessage
  }

  // Use plain message if user-friendly and not a raw Firebase/runtime error string
  if (message && !RAW_INTERNAL_MESSAGE_RE.test(message)) {
    return message
  }

  return fallbackMessage
}
