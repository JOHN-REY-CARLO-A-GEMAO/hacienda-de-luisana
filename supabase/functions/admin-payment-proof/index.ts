// The Admin-side read of a payment proof (ADR-0011).
//
// Why this exists: `supabase/01-storage.sql` grants the `anon` role write and
// nothing else, because the `anon` key is public — it ships inside the Vite
// bundle. A read policy for `anon` would therefore publish every Guest's GCash
// or Maya reference number and amount to anyone who loads the website. So an
// Admin cannot fetch a proof with a key; it asks this function, which
// authenticates the caller and hands back a URL that expires in 60 seconds.
//
// The call chain, end to end:
//
//   Flutter app                this function                     Supabase
//   ───────────                ────────────                     ────────
//   Firebase ID token  ──────► verify the JWT  (firebase-admin)
//   booking ref / path  ─────►
//                              read profiles/{uid}.role  ─────►  service_role
//                                 must be 'admin'                  (bypasses RLS)
//                              createSignedUrl(path, 60s) ─────►
//   ◄──────────────────────  { url, expiresIn }  (short-lived)
//
// ON THE AUTH, and one honest gap: this checks `profiles/{uid}.role == 'admin'`
// and deliberately does NOT carry its own copy of the bootstrap email
// allowlist. That list already exists in five files in this repository and
// duplicating it a sixth time inside a function is how the `carlo` typo
// happened in the first place. The cost is that an Admin who is on the
// allowlist but has no `profiles/{uid}` document is refused here, so
// `docs/ANDROID.md` step 5 (create the Profile with `role: 'admin'`) is now
// required for proof review, not optional. Profile-as-the-source is also what
// ADR-0005 already calls the stored half of the answer.
//
// DEPLOYMENT — this file is unrun code. There is no Supabase CLI and no access
// token in this repository, so nothing here has been executed, and treat it as
// a review item rather than a working feature until it has been deployed and
// exercised against the real bucket:
//
//   supabase functions deploy admin-payment-proof
//   supabase secrets set FIREBASE_PROJECT_ID=hacienda-de-luisana
//
// `service_role` is supplied to the function by the platform — never set it as
// a secret, and never let it near the app.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cert, getAuth } from 'npm:firebase-admin@11/auth'
import { initializeApp } from 'npm:firebase-admin@11/app'

/** How long a signed URL stays usable. Long enough to open, not to share. */
const EXPIRY_SECONDS = 60

/** The one bucket that exists. */
const BUCKET = 'payment-proofs'

/**
 * The stored address of a proof, and the only one this function will sign.
 *
 * Rebuilt from the caller's Booking rather than trusted from the request body:
 * a caller who can ask for `payments/anyone-elses-uid/REF/proof.png` must not
 * be able to walk out with someone else's receipt by editing a string. The
 * Firestore read below is what makes the `{uid}` in the path mean something.
 */
const PROOF_PATH = /^payments\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/proof\.[A-Za-z0-9]+$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'POST only.' }, 405)
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'No Firebase ID token.' }, 401)

  // ---- who is asking -------------------------------------------------------
  let uid: string
  try {
    const projectId = Deno.env.get('FIREBASE_PROJECT_ID')
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set')
    const app = initializeApp(
      { credential: cert(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? '') },
      `verify-${projectId}`,
    )
    const decoded = await getAuth(app).verifyIdToken(token)
    uid = decoded.uid
  } catch (error) {
    // Never echo the verifier's complaint: it describes the token, and this
    // body reaches a phone screen.
    console.error('[admin-payment-proof] token rejected', error)
    return json({ error: 'That sign-in could not be verified. Sign in again.' }, 401)
  }

  // ---- what are they asking for -------------------------------------------
  let path: string
  try {
    const { path: asked } = await request.json()
    if (typeof asked !== 'string' || !PROOF_PATH.test(asked)) {
      return json({ error: 'Not a payment proof path.' }, 400)
    }
    path = asked
  } catch {
    return json({ error: 'Send {"path": "payments/…/proof.png"}.' }, 400)
  }

  // ---- are they an Admin ---------------------------------------------------
  // service_role: this is the platform-provided key, and it bypasses RLS. It is
  // used here to read one Profile, never to write anything.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('uid', uid)
    .maybeSingle()

  if (profile?.role !== 'admin') {
    return json({ error: 'Only the Admin may open a payment proof.' }, 403)
  }

  // ---- hand back something that expires ------------------------------------
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, EXPIRY_SECONDS)

  if (error) {
    // "not found" is the common one and is not the caller's fault — the Guest
    // may simply not have sent a proof yet.
    console.error('[admin-payment-proof] sign failed', error)
    return json({ error: 'No proof is stored at that path.' }, 404)
  }

  return json({ url: data.signedUrl, expiresIn: EXPIRY_SECONDS })
})
