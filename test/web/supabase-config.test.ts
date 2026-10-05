// Which Supabase project a build talks to — the decision, asserted.
//
// This is the seam where F12 lived. A build with no Supabase project is not a
// broken website; it is a website that accepts a Booking in Firestore and keeps
// the screenshot that proves the Guest paid in that Guest's own browser. The
// Booking looks real, the Admin's review queue holds a receipt that exists
// nowhere, and nothing anywhere reports an error.
//
// So every branch of the order — variables, committed project, nothing — is a
// case here, along with every way a value can arrive wrong, and one case that
// exists only for this finding: that the committed project is itself usable. If
// somebody empties `supabaseDefaults.ts`, that case fails here in a normal test
// run, rather than only being caught by SUPABASE_ENV_STRICT at deploy time.
import {
  describeSupabaseSource,
  isAnonKeyLike,
  isSupabaseUrlLike,
  resolveSupabaseConfig,
  type SupabaseConfig,
} from '../../src/lib/supabaseConfig'
import { COMMITTED_SUPABASE } from '../../src/lib/supabaseDefaults'

/**
 * A synthetic key with the right *shape*. The committed real key is never
 * pasted here: `isAnonKeyLike` is about form, and a test that copied a live
 * credential into the suite would make rotation a two-file job.
 */
const REAL_URL = 'https://abcdefghijklmnopqrst.supabase.co'
const REAL_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXBsYWNlaG9sZGVy'
// A project ref is exactly 20 characters. Both refs below are, deliberately:
// one character either way is refused by `isSupabaseUrlLike`, which is asserted
// so a future edit to that guard cannot quietly widen it.
const OTHER_URL = 'https://qwertyuiopasdfghjklz.supabase.co'

const REAL: SupabaseConfig = { url: REAL_URL, anonKey: REAL_KEY }
const EMPTY: SupabaseConfig = { url: '', anonKey: '' }

const FULL_ENV = {
  VITE_SUPABASE_URL: REAL_URL,
  VITE_SUPABASE_ANON_KEY: REAL_KEY,
}

describe('reading a Supabase value out of the environment', () => {
  it('only accepts a real project URL', () => {
    expect(isSupabaseUrlLike(REAL_URL)).toBe(true)
    expect(isSupabaseUrlLike(OTHER_URL)).toBe(true)
  })

  it('refuses anything that is not that URL', () => {
    // The `.env.example` placeholder, which is the shape this actually goes wrong in.
    expect(isSupabaseUrlLike('your_supabase_url')).toBe(false)
    expect(isSupabaseUrlLike('https://example.supabase.co')).toBe(false) // ref too short
    expect(isSupabaseUrlLike('https://abcdefghijklmnopqrstu.supabase.co')).toBe(false) // ref one char long
    expect(isSupabaseUrlLike('http://abcdefghijklmnopqrst.supabase.co')).toBe(false) // not https
    expect(isSupabaseUrlLike('https://abcdefghijklmnopqrst.supabase.com')).toBe(false)
    expect(isSupabaseUrlLike('not a url')).toBe(false)
    expect(isSupabaseUrlLike('')).toBe(false)
    expect(isSupabaseUrlLike(undefined)).toBe(false)
  })

  it('accepts both generations of public key and nothing else', () => {
    expect(isAnonKeyLike(REAL_KEY)).toBe(true) // legacy three-segment JWT
    expect(isAnonKeyLike('sb_publishable_abcdefghijklmnop')).toBe(true) // newer
    expect(isAnonKeyLike('your_anon_key_here')).toBe(false)
    expect(isAnonKeyLike('eyJnot-a-key')).toBe(false)
    expect(isAnonKeyLike('')).toBe(false)
    expect(isAnonKeyLike(undefined)).toBe(false)
  })
})

describe('the Supabase project a build talks to', () => {
  it('has no project at all when neither a variable nor a default supplies one', () => {
    const report = resolveSupabaseConfig({ env: {}, defaults: EMPTY, allowDefaults: false })

    expect(report.configured).toBe(false)
    expect(report.source).toBe('none')
  })

  it('uses the variables when the build has them, and nothing else', () => {
    const report = resolveSupabaseConfig({ env: FULL_ENV, defaults: EMPTY, allowDefaults: true })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('env')
    expect(report.config).toEqual(REAL)
    expect(report.fields.every((f) => f.state === 'env')).toBe(true)
  })

  it('falls back to the committed project on a production build with an empty dashboard', () => {
    // The exact condition of the deployed GitHub Pages build: no
    // VITE_SUPABASE_* variables at all. Before the committed project existed,
    // this returned `none` and every Guest's receipt stayed in their browser.
    const report = resolveSupabaseConfig({ env: {}, defaults: REAL, allowDefaults: true })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('defaults')
    expect(report.config).toEqual(REAL)
  })

  it('keeps local development and the test run in demo mode', () => {
    // `npm run dev`, `npm test`, the emulator workflow. The committed project is
    // not applied here, which is what keeps the suite from writing a test
    // receipt into the real bucket — and what keeps demo mode demo mode.
    const report = resolveSupabaseConfig({ env: {}, defaults: REAL, allowDefaults: false })

    expect(report.configured).toBe(false)
    expect(report.source).toBe('none')
  })

  it('lets a variable over the committed project, value by value', () => {
    const report = resolveSupabaseConfig({
      env: { VITE_SUPABASE_URL: OTHER_URL },
      defaults: REAL,
      allowDefaults: true,
    })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('mixed')
    expect(report.config.url).toBe(OTHER_URL)
    expect(report.config.anonKey).toBe(REAL_KEY)
  })

  it('refuses a placeholder variable instead of pointing a client at nothing', () => {
    const report = resolveSupabaseConfig({
      env: { VITE_SUPABASE_URL: 'your_supabase_url', VITE_SUPABASE_ANON_KEY: REAL_KEY },
      defaults: EMPTY,
      allowDefaults: false,
    })

    expect(report.configured).toBe(false)
    expect(report.refusedEnvKeys).toEqual(['VITE_SUPABASE_URL'])
    expect(report.fields.find((f) => f.field === 'url')?.state).toBe('invalid')
    expect(report.fields.find((f) => f.field === 'url')?.problem).toMatch(/supabase\.co/)
  })

  it('falls back to the committed project when a variable is a placeholder', () => {
    const report = resolveSupabaseConfig({
      env: { VITE_SUPABASE_URL: 'your_supabase_url' },
      defaults: REAL,
      allowDefaults: true,
    })

    expect(report.configured).toBe(true)
    expect(report.refusedEnvKeys).toEqual(['VITE_SUPABASE_URL'])
    expect(report.config.url).toBe(REAL_URL)
  })

  it('reads a quoted paste as the value somebody meant', () => {
    const report = resolveSupabaseConfig({
      env: { VITE_SUPABASE_URL: `"${REAL_URL}"`, VITE_SUPABASE_ANON_KEY: `'${REAL_KEY}'` },
      defaults: EMPTY,
      allowDefaults: false,
    })

    expect(report.configured).toBe(true)
    expect(report.config).toEqual(REAL)
  })

  it('says where the project came from, in words', () => {
    expect(describeSupabaseSource('env')).toMatch(/environment variables/)
    expect(describeSupabaseSource('defaults')).toMatch(/committed/)
    expect(describeSupabaseSource('mixed')).toMatch(/rest/)
    expect(describeSupabaseSource('none')).toMatch(/browser/)
  })
})

describe('the committed project', () => {
  // The one case that is not about the resolver. Every other test would still
  // pass with an empty `supabaseDefaults.ts` if it were handed empty defaults —
  // so this asserts the real committed values are usable, which is precisely
  // what SUPABASE_ENV_STRICT checks at deploy time. Fail here first, in a normal
  // test run, rather than only on a deployment.
  it('is a URL and an anon key the resolver accepts', () => {
    expect(isSupabaseUrlLike(COMMITTED_SUPABASE.url)).toBe(true)
    expect(isAnonKeyLike(COMMITTED_SUPABASE.anonKey)).toBe(true)
  })

  it('leaves a production build with no dashboard variables configured', () => {
    const report = resolveSupabaseConfig({
      env: {},
      defaults: COMMITTED_SUPABASE,
      allowDefaults: true,
    })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('defaults')
    expect(report.refusedEnvKeys).toEqual([])
  })

  it('points at the same project the Admin app reads (supabase/config.toml)', () => {
    // A default that drifts from the project `project_id` would upload receipts
    // the Admin's Edge Function cannot sign a URL for.
    expect(new URL(COMMITTED_SUPABASE.url).hostname.split('.')[0]).toBe(
      'xgcjjzwdkxykdosxdzhn',
    )
  })
})