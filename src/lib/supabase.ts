// ------------------------------------------------------------------------------
// Supabase client — payment-proof uploads (ADR-0011).
//
// Supabase Storage hosts the `payment-proofs` bucket: the only place a Guest's
// downpayment screenshot lands in cloud mode. Why Supabase rather than Firebase
// Storage, and why the path (not a signed URL) is what the Booking records, is
// written up in docs/adr/ADR-0011-supabase-storage.md.
//
// Which project this build talks to is decided in `supabaseConfig.ts`, in the
// same order as the Firebase side: `VITE_SUPABASE_*` first, then the committed
// project (`supabaseDefaults.ts`) for production builds, then nothing. Step 2
// used to be absent, and its absence was finding F12 — the deployed build set no
// `env:`, so demo mode was entered quietly and every Guest's receipt was kept in
// their own `localStorage` while the Booking was created in Firestore pointing at
// a proof path the Admin cannot read.
//
// This module is only the wiring. The decision is pure and separately testable.
// ------------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabaseConfig, type SupabaseConfigSource } from './supabaseConfig'
import { COMMITTED_SUPABASE } from './supabaseDefaults'

/** The single bucket payment proofs are uploaded to. */
export const PAYMENT_PROOFS_BUCKET = 'payment-proofs'

export type { SupabaseConfigReport, SupabaseConfigSource } from './supabaseConfig'
export { describeSupabaseSource } from './supabaseConfig'

const report = resolveSupabaseConfig({
  env: import.meta.env as unknown as Record<string, unknown>,
  defaults: COMMITTED_SUPABASE,
  allowDefaults: import.meta.env.PROD,
})

/** True when both Supabase values are present and usable. */
export const isSupabaseConfigured: boolean = report.configured

/** Where the project came from, for `/status` and the build log. */
export const supabaseConfigSource: SupabaseConfigSource = report.source

/** The full account of both values — what `/status` and the build log read. */
export const supabaseConfigReport = report

/**
 * What `/status` shows about payment-proof storage.
 *
 * The failure this exists for was silent: a build with no Supabase project is a
 * website that accepts a Booking in Firestore and keeps the screenshot that
 * proves the Guest paid in that Guest's own browser. Nothing errored, and the
 * Admin's review queue held a receipt that did not exist anywhere.
 */
export function getSupabaseStatus() {
  return {
    /** True when a screenshot will actually reach the bucket. */
    configured: report.configured,
    source: report.source,
    bucket: PAYMENT_PROOFS_BUCKET,
    /** The project host, or '' — enough to recognise, and public by design. */
    host: report.configured ? new URL(report.config.url).hostname : '',
    /** Variables that were set and refused, by name. */
    refusedEnvKeys: report.refusedEnvKeys,
  }
}

/**
 * The Supabase client, or null in demo mode.
 *
 * Built once at module load; module consumers (helpers, tests) import `supabase`
 * rather than calling createClient themselves.
 *
 * No session is persisted and none is refreshed. This client exists only to put
 * a Guest's receipt in the bucket, with the public `anon` key and no Supabase
 * account anywhere in the product — so a session could only ever be a leftover.
 * A leftover is not harmless: supabase-js sends a persisted token as
 * `Authorization`, Postgres adopts its `role` claim, and the request stops
 * arriving as `anon`. The storage policies are granted `to anon` only, so that
 * turns into `42501 new row violates row-level security policy` against a
 * policy that is correct in the dashboard. Writing receipts must not depend on
 * which role the browser happens to be holding.
 */
export const supabase: SupabaseClient | null = report.configured
  ? createClient(report.config.url, report.config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null