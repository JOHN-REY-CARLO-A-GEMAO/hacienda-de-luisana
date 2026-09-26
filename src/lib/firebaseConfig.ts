// ----------------------------------------------------------------------------
// Which Firebase project this build talks to — the decision, in one pure place
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One question, asked once per build: is this deployment wired to the Firebase
// project the Admin app reads, or is it standing on its own in this browser?
//
// Three sources, and they win in this order:
//
//   1. `VITE_FIREBASE_*` — what the hosting dashboard (Vercel, GitHub Actions)
//      or a local `.env.local` says. Complete enough to connect: it is used,
//      and nothing is taken from anywhere else.
//   2. The committed project (`firebaseDefaults.ts`) — the same Firebase project
//      the Flutter Admin app already ships keys for, used by production builds
//      so that a deployment with an empty dashboard still reaches the Admin
//      instead of quietly keeping Guest requests in their own browser.
//   3. Nothing — the local demo adapter (`authLocal.ts`), where accounts and
//      Bookings live in this browser and the page says so.
//
// This module is the decision itself: no Firebase SDK, no `window`, no import
// side effects, so every branch above is a unit test rather than a hope
// (`test/web/firebase-config.test.ts`). `firebase.ts` calls it once and does the
// wiring.
//
// Why a value is *refused* rather than accepted: a dashboard variable that is
// present but is still the placeholder from `.env.example` ("your_api_key_here",
// "<paste yours>") is worse than an absent one. Absent falls through to the next
// source; a placeholder would initialise a Firebase app pointed at nothing and
// turn "demo mode" into an error message. So placeholders are rejected here,
// named in the report, and reported to whoever is looking (`/status`).
// ----------------------------------------------------------------------------

/** Every Firebase value this build can be told, and the variable that carries it. */
export const FIREBASE_ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  measurementId: 'VITE_FIREBASE_MEASUREMENT_ID',
} as const

export type FirebaseConfigField = keyof typeof FIREBASE_ENV_KEYS

export type FirebaseConfig = Record<FirebaseConfigField, string>

/**
 * The three without which there is no project to talk to. `apiKey` authenticates
 * the client, `projectId` says which project, and `authDomain` is where the
 * sign-in popup and redirect come back to — Auth, Firestore and Storage all
 * refuse to be built without them.
 */
export const REQUIRED_FIELDS: readonly FirebaseConfigField[] = ['apiKey', 'projectId', 'authDomain']

/**
 * Value added, but only for the parts that need it: `appId` is what Analytics
 * (and Cloud Messaging) key off — Auth, Firestore and Storage do not read it —
 * and `storageBucket` is what uploads go to. Missing on a working deployment is
 * worth a sentence, not a refusal to connect.
 */
export const RECOMMENDED_FIELDS: readonly FirebaseConfigField[] = [
  'appId',
  'storageBucket',
  'messagingSenderId',
]

/** Where one value came from, and whether it is usable. */
export type FieldState =
  /** A `VITE_FIREBASE_*` variable, and it looks like a real value. */
  | 'env'
  /** Nothing in the environment: the committed project supplies it. */
  | 'default'
  /** Nobody supplied it. */
  | 'missing'
  /** Supplied, but it is a placeholder or the wrong shape — refused. */
  | 'invalid'

/** Where the connection as a whole came from. */
export type ConfigSource =
  /** Every value from `VITE_FIREBASE_*`. */
  | 'env'
  /** Every value from the committed project. */
  | 'defaults'
  /** A real mixture: some variables set, the rest from the committed project. */
  | 'mixed'
  /** No project at all — the local demo adapter. */
  | 'none'

export type FieldReport = {
  field: FirebaseConfigField
  /** The variable a deployment would set to override this value. */
  envKey: string
  required: boolean
  state: FieldState
  /** The value that will be used, or ''. Firebase config is public by design. */
  value: string
  /** When the state is 'invalid': why, in words a person can act on. */
  problem?: string
}

export type FirebaseConfigReport = {
  /** What the SDK will be initialised with. */
  config: FirebaseConfig
  /** True when a Firebase project can be reached at all. */
  configured: boolean
  source: ConfigSource
  fields: FieldReport[]
  /** Required fields this build does not have — the reason it is in demo mode. */
  missingRequired: FirebaseConfigField[]
  /** Environment variables that were set and refused, with the reason. */
  refusedEnvKeys: string[]
}

const REQUIRED_SET = new Set<FirebaseConfigField>(REQUIRED_FIELDS)

/**
 * Values that mean "nobody filled this in yet". Matched against the whole
 * trimmed, lower-cased value — `.env.example` is the source of most of them.
 */
const PLACEHOLDERS = new Set([
  'undefined',
  'null',
  'your_api_key_here',
  'your_project_id',
  'your_app_id',
  'your_sender_id',
  'your_auth_domain',
  'your_storage_bucket',
])

/**
 * Read one environment value: the strings a build actually carries are trimmed
 * and unquoted (a dashboard value pasted as `"AIza…"` is a value, not a typo),
 * and an empty string is the same as absent — which is what `.env.example`
 * leaves behind and what a cleared dashboard field reads as.
 */
export function readEnvValue(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  let value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim()
    }
  }
  return value.length > 0 ? value : undefined
}

/** Is this a filled-in value, or the placeholder someone left behind? */
export function isUsableValue(value: string | undefined): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  if (PLACEHOLDERS.has(lower)) return false
  if (lower.includes('your_') || lower.includes('placeholder') || lower.includes('example')) return false
  if (lower.includes('xxxx')) return false
  if (lower.startsWith('<') || lower.endsWith('>')) return false
  return true
}

/**
 * Google/Firebase web API keys start with `AIza` and are ~39 characters. Length
 * is checked loosely on purpose: a key that is merely short is refused, a key
 * Google has since reissued in another shape is not.
 */
export function isApiKeyLike(value: string | undefined): boolean {
  return Boolean(value && value.startsWith('AIza') && value.length >= 20)
}

function stateOf(value: string | undefined, looksRight: boolean): FieldState {
  if (!value) return 'missing'
  return looksRight ? 'env' : 'invalid'
}

/**
 * Decide the project for this build.
 *
 * `env` is anything shaped like `import.meta.env` — the caller passes it in so
 * this stays a function of its arguments. `allowDefaults` is the production
 * switch: the committed project is what a *deployed* build falls back to, while
 * `npm run dev` and the test run keep the documented demo behaviour and its
 * emulator/practice workflow (`docs/FIREBASE_SETUP.md`).
 */
export function resolveFirebaseConfig({
  env,
  defaults,
  allowDefaults,
}: {
  env: Record<string, unknown>
  defaults: FirebaseConfig
  allowDefaults: boolean
}): FirebaseConfigReport {
  const fields: FieldReport[] = []
  const config = {} as FirebaseConfig
  const refusedEnvKeys: string[] = []
  let fromEnv = 0
  let fromDefaults = 0
  let fromDefaultsRequired = 0

  for (const field of Object.keys(FIREBASE_ENV_KEYS) as FirebaseConfigField[]) {
    const envKey = FIREBASE_ENV_KEYS[field]
    const raw = readEnvValue(env[envKey])
    const looksRight = field === 'apiKey' ? isApiKeyLike(raw) : isUsableValue(raw)
    const envState = stateOf(raw, looksRight)
    const fallback = readEnvValue(defaults[field])
    const fallbackOk = field === 'apiKey' ? isApiKeyLike(fallback) : isUsableValue(fallback)

    let state: FieldState
    let value = ''
    let problem: string | undefined

    if (envState === 'env') {
      state = 'env'
      value = raw as string
      fromEnv += 1
    } else if (envState === 'invalid') {
      // Named, never silently used: a placeholder that initialises a Firebase app
      // is how a deployment ends up with a "configured" banner and a dead form.
      refusedEnvKeys.push(envKey)
      problem =
        field === 'apiKey'
          ? 'not a Firebase web API key (they start with "AIza")'
          : 'still the placeholder from .env.example'
      if (allowDefaults && fallbackOk) {
        state = 'default'
        value = fallback as string
        fromDefaults += 1
        fromDefaultsRequired += 1
      } else {
        state = 'invalid'
      }
    } else if (allowDefaults && fallbackOk) {
      state = 'default'
      value = fallback as string
      fromDefaults += 1
      if (REQUIRED_SET.has(field)) fromDefaultsRequired += 1
    } else {
      state = 'missing'
    }

    config[field] = value
    fields.push({
      field,
      envKey,
      required: REQUIRED_SET.has(field),
      state,
      value,
      ...(problem ? { problem } : {}),
    })
  }

  // Named in the order the docs list them, so the same three values read the
  // same way in a build log and on /status.
  const missingRequired = REQUIRED_FIELDS.filter(
    (field) => !fields.find((f) => f.field === field)?.value,
  )
  const configured = missingRequired.length === 0

  let source: ConfigSource = 'none'
  if (configured) {
    if (fromDefaults === 0) source = 'env'
    else if (fromEnv === 0 || fromDefaultsRequired === REQUIRED_FIELDS.length) source = 'defaults'
    else source = 'mixed'
  }

  return { config, configured, source, fields, missingRequired, refusedEnvKeys }
}

/** The report for one field, for callers that ask about a single value. */
export function fieldReport(report: FirebaseConfigReport, field: FirebaseConfigField): FieldReport {
  return report.fields.find((f) => f.field === field) as FieldReport
}

/** A value shown the way a public key may be shown: enough to recognise, no more. */
export function maskValue(value: string): string {
  if (!value) return ''
  if (value.length <= 10) return `${value.slice(0, 3)}…`
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

/** Where the connection came from, said to a person. */
export function describeSource(source: ConfigSource): string {
  switch (source) {
    case 'env':
      return 'This deployment was built with its own Firebase settings (VITE_FIREBASE_* environment variables).'
    case 'defaults':
      return 'This deployment has no Firebase environment variables of its own, so it is using the project settings committed in the repository (src/lib/firebaseDefaults.ts).'
    case 'mixed':
      return 'This deployment sets some Firebase environment variables; the rest come from the committed project settings (src/lib/firebaseDefaults.ts).'
    default:
      return 'This deployment has no Firebase project at all: accounts and bookings stay in this browser.'
  }
}
