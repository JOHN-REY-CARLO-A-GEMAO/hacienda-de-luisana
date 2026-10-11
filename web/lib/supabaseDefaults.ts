// ----------------------------------------------------------------------------
// The Supabase project this repository deploys to — committed, on purpose
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// This is `firebaseDefaults.ts`, for the other half of the cloud story: the
// `payment-proofs` bucket, which is the only place a Guest's downpayment
// screenshot lands in cloud mode (ADR-0011). The reasoning is the same as the
// Firebase project's, and so is the failure it exists to prevent.
//
// A Supabase `anon` key is public by design. It is the key every browser bundle
// in every Supabase application ships; it identifies the project and grants
// nothing. The authorization for `payment-proofs` is the row-level security in
// `supabase/01-storage.sql` — `to anon` insert only, under `payments/`, with no
// read grant — and that answers every request whether or not anybody knows this
// key. The Admin reads proofs through the `admin-payment-proof` Edge Function,
// which verifies the caller's Firebase ID token and then their `admin` role.
//
// Never put the `service_role` key in this file, in a `VITE_*` variable, or in
// any other file in this repository. Everything Vite exposes to the browser is
// public, and `service_role` bypasses RLS entirely — every policy in this
// project stops applying the moment it is shipped. See docs/FIREBASE_SETUP.md.
//
// Why a committed default exists: the deployed website got its Supabase
// settings only from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and
// `.github/workflows/deploy.yml` sets no `env:` block, so a production build had
// neither variable. `src/lib/supabase.ts` read that as "demo mode" and
// `uploadPaymentProofFile` kept the screenshot in the Guest's own
// `localStorage`. Nothing said so: the upload reported success, `mode` was
// dropped by its caller, and `firestore.rules` only requires
// `payment_proof_url` to be a non-empty string — which a path is. The result was
// a Booking that the Admin could open, in `Pending`, pointing at a receipt that
// existed nowhere but the Guest's browser, and the Guest told it was sent. That
// is finding F12 in docs/phase0/REPORT.md, and it is the same class of failure
// the Firebase defaults were committed to prevent: the business loses the money
// and never learns about it.
//
// So production is configured from here, and a dashboard variable — where one is
// set — wins over it (see `supabase.ts` for the order). Local development is
// unchanged: `npm run dev` and the test run still fall back to browser-local
// storage, so the demo adapter and the emulator workflow keep working and the
// test suite never writes to the real bucket.
//
// To point a deployment at a different Supabase project, set
// `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the host's dashboard (and
// redeploy — Vite reads them at build time) or in `.env.local` locally. Nothing
// here has to change.
// ----------------------------------------------------------------------------

/** The Supabase project the Admin app's Edge Function reads proofs from. */
export const COMMITTED_SUPABASE = {
  /** The project's REST endpoint. Matches `project_id` in `supabase/config.toml`. */
  url: 'https://xgcjjzwdkxykdosxdzhn.supabase.co',
  /**
   * The project's `anon` key — the public, RLS-bound one. The Admin app never
   * carries this key: it authenticates to the Edge Function with a Firebase ID
   * token instead (see `supabase/config.toml` and
   * `supabase/functions/admin-payment-proof/index.ts`), so nothing here is
   * needed to read a proof.
   */
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnY2pqendka3h5a2Rvc3hkemhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NzU0MzMsImV4cCI6MjEwNjA1MTQzM30.f7ec_bdNxj31TP0BLeCxCv8aIFXhKdMMGu8DOkBVELw',
} as const
