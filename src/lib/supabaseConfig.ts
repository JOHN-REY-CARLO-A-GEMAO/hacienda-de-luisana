// ----------------------------------------------------------------------------
// Which Supabase project this build talks to — the decision, in one pure place
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// `firebaseConfig.ts`, for the `payment-proofs` bucket. Same question, same answer
// shape, same reason for existing as its counterpart: a module that only decides
// can be unit-tested, and can be imported by `vite.config.ts` to print what a
// build resolved to — which a module that builds a client at load time cannot.
//
// Three sources, winning in this order:
//
//   1. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` — what the hosting
//      dashboard or a local `.env.local` says.
//   2. The committed project (`supabaseDefaults.ts`) — production builds only, so
//      a deployment with an empty dashboard still uploads Guest receipts to the
//      bucket the Admin reads instead of quietly keeping them in the Guest's
//      browser. That silence was finding F12.
//   3. Nothing — demo mode, where the screenshot stays in this browser.
//
// A value is *refused* rather than accepted for the same reason as on the
// Firebase side: a variable still holding the `.env.example` placeholder would
// initialise a client pointed at nothing, turning a recoverable demo mode into an
// upload error at the exact moment a Guest is trying to pay. Refused values are
// named in the report, so the build log and `/status` can say so.
// ----------------------------------------------------------------------------

import { isUsableValue, readEnvValue } from './firebaseConfig'

/** The two environment variables that name a Supabase project. */
export const SUPABASE_ENV_KEYS = {
  url: 'VITE_SUPABASE_URL',
  anonKey: 'VITE_SUPABASE_ANON_KEY',
} as const

export type SupabaseField = keyof typeof SUPABASE_ENV_KEYS

/** Where the two values came from. */
export type SupabaseConfigSource =
  /** Both from `VITE_SUPABASE_*`. */
  | 'env'
  /** Both from the committed project. */
  | 'defaults'
  /** A real mixture of the two. */
  | 'mixed'
  /** No project at all — proofs stay in this browser. */
  | 'none'

export type SupabaseConfig = { url: string; anonKey: string }

export type SupabaseFieldReport = {
  field: SupabaseField
  envKey: string
  state: 'env' | 'default' | 'missing' | 'invalid'
  value: string
  /** Set but refused; why, in words a person can act on. */
  problem?: string
}

export type SupabaseConfigReport = {
  /** What the client will be initialised with. */
  config: SupabaseConfig
  /** True when a Supabase project can be reached at all. */
  configured: boolean
  source: SupabaseConfigSource
  fields: SupabaseFieldReport[]
  refusedEnvKeys: string[]
}

/** `https://<project-ref>.supabase.co`, with a project ref actually present. */
export function isSupabaseUrlLike(value: string | undefined): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && /^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * A Supabase `anon`/`publishable` key.
 *
 * The legacy keys are a three-segment JWT (`eyJ…`); the newer publishable keys
 * are an `sb_publishable_…` string. Both are public by design and both are safe to
 * ship to a browser.
 *
 * A `service_role` key has the same shape as an `anon` key, so this cannot tell
 * them apart and does not try to — a `service_role` key must never reach this
 * repository at all. See `supabaseDefaults.ts`.
 */
export function isAnonKeyLike(value: string | undefined): boolean {
  if (!value) return false
  return value.startsWith('sb_publishable_') || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)
}

/** Read one environment value the way `firebaseConfig.ts` reads its own. */
export function readSupabaseEnvValue(raw: unknown): string | undefined {
  return readEnvValue(raw)
}

/**
 * Decide the Supabase project for this build.
 *
 * `env` is anything shaped like `import.meta.env`, passed in so this stays a
 * function of its arguments. `allowDefaults` is the production switch: a
 * *deployed* build falls back to the committed project, while `npm run dev` and
 * the test run keep the documented demo behaviour — and, importantly, never write
 * to the real bucket.
 */
export function resolveSupabaseConfig({
  env,
  defaults,
  allowDefaults,
}: {
  env: Record<string, unknown>
  defaults: SupabaseConfig
  allowDefaults: boolean
}): SupabaseConfigReport {
  const fields: SupabaseFieldReport[] = []
  const refusedEnvKeys: string[] = []
  const config: SupabaseConfig = { url: '', anonKey: '' }
  let fromEnv = 0
  let fromDefaults = 0

  for (const field of ['url', 'anonKey'] as const) {
    const envKey = SUPABASE_ENV_KEYS[field]
    const looksRight = field === 'url' ? isSupabaseUrlLike : isAnonKeyLike
    const raw = readEnvValue(env[envKey])
    const fallback = readEnvValue(defaults[field])
    const fallbackOk = looksRight(fallback)

    let state: SupabaseFieldReport['state']
    let value = ''
    let problem: string | undefined

    if (raw && looksRight(raw)) {
      state = 'env'
      value = raw
      fromEnv += 1
    } else if (raw) {
      // Named, never silently used.
      refusedEnvKeys.push(envKey)
      problem =
        field === 'url' ? 'not a https://<project-ref>.supabase.co URL' : 'not a Supabase anon key'
      if (allowDefaults && fallbackOk) {
        state = 'default'
        value = fallback as string
        fromDefaults += 1
      } else {
        state = 'invalid'
      }
    } else if (allowDefaults && fallbackOk) {
      state = 'default'
      value = fallback as string
      fromDefaults += 1
    } else {
      state = 'missing'
    }

    config[field] = value
    fields.push({ field, envKey, state, value, ...(problem ? { problem } : {}) })
  }

  const configured = Boolean(config.url && config.anonKey)
  const source: SupabaseConfigSource = !configured
    ? 'none'
    : fromEnv === 2
      ? 'env'
      : fromDefaults === 2
        ? 'defaults'
        : 'mixed'

  return { config, configured, source, fields, refusedEnvKeys }
}

/** Where the connection came from, said to a person. */
export function describeSupabaseSource(source: SupabaseConfigSource): string {
  switch (source) {
    case 'env':
      return 'This deployment was built with its own Supabase settings (VITE_SUPABASE_* environment variables).'
    case 'defaults':
      return 'This deployment has no Supabase environment variables of its own, so it is using the project committed in the repository (src/lib/supabaseDefaults.ts).'
    case 'mixed':
      return 'This deployment sets some Supabase environment variables; the rest come from the committed project (src/lib/supabaseDefaults.ts).'
    default:
      return 'This deployment has no Supabase project at all: payment-proof screenshots stay in the guest’s own browser.'
  }
}

export { isUsableValue }