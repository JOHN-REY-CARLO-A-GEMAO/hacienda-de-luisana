# ADR-0011: Supabase Storage for payment proofs (and local demo fallback)

**Date:** 2026-09-27
**Status:** accepted

## Context

Guests send a downpayment screenshot and the Admin verifies it against the amount
the Guest claims. That upload originally lived in Firebase Storage under
`payments/{uid}/{bookingRef}/proof.{ext}`, read back by the Admin through the
same Firebase project the rest of the system already uses.

Two things pushed it out:

1. **The Government ID KYC stage was removed** (2026-09-27) with the lifecycle
   change `Pending → Payment Pending`. The payment proof is now the only file
   either app uploads, so the upload path no longer needs to ride along with the
   same Storage rules machinery that carried `/kyc` — it can be chosen purely on
   merit.
2. **Firebase Storage credentials are awkward for a static site.** The web app
   already writes its *documents* to Firestore, but Storage put the receipt in a
   second Google-authenticated surface: another set of rules, another console
   bucket, another emulator. Supabase Storage is a single bucket + anon key away
   from working, fits a Vite SPA, and costs nothing at this scale.

The hybrid word in the task refers to *who writes the Booking document*: that
stays Firestore. Only the **file bytes** move.

## Decision

- **`@supabase/supabase-js` uploads the screenshot to the Supabase Storage
  bucket `payment-proofs`.** The client is built in `src/lib/supabase.ts` from
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. The upload helper lives in
  `src/lib/storage.ts` (`uploadPaymentProofFile`) and returns the **file path**,
  not a signed URL — e.g. `payments/{uid}/{HDL-ref}/proof.png`.
- **The file path is stored on the Booking** in Firestore (and in the localStorage
  fallback store) as `paymentProofUrl`, alongside the canonical
  `payment_proof_url` the verification flow has always read. Both keys carry the
  same value; neither is a URL that can expire mid-review. The Admin resolves the
  path through the bucket when it is time to verify.
- **Demo mode falls back to this browser.** With either Supabase variable
  missing, the same helper stores the file as a data URL under
  `localStorage['hdl:payment-proofs']` and still returns the path — the same
  demo-mode posture the site takes for Firebase itself: no secret, no cloud, and
  nothing that pretends to reach the Hacienda.
- **OCR runs before the upload.** When the Guest picks the screenshot,
  `tesseract.js` reads it *client-side* and pre-fills the reference input
  (10–13 digit GCash / Maya / bank references, see `payments/ocr.ts`); the
  extracted value is stored on the document as `extractedRefNumber`. OCR is
  never verification — the Admin still matches reference and amount.
- **The bucket and its policies live in the repo:** `supabase/01-storage.sql`
  creates the private bucket (`payment-proofs`, 5 MB to mirror
  `payments/contract.ts`) and grants the web app's `anon` role write under
  `payments/`. The Admin does **not** read with the anon key — see the
  amendment below.

## Consequences

- One Google surface (Firestore) for documents, one Supabase surface for files —
  each with a single, obvious credential story.
- `storage.rules` keeps only the legacy `/payments` block for old Firebase-hosted
  receipts; no new Storage rules are written for proofs (ADR-0005's `/kyc` grant
  is gone; ADR-0007's "Admin reads Guest documents" invariant is now enforced by
  bucket policy instead).
- Losing the Supabase keys does not break the site: uploads degrade to labelled
  demo mode rather than failing, exactly as a missing Firebase project does.
- `firestore.rules` guest writes accept the new keys — `paymentProofUrl` and
  `extractedRefNumber` — in `affectedKeys`, still only from `Payment Pending`.
- Anything downstream that wants a *URL* must sign the path at read time;
  nothing stores one, so no stored link can expire.

## Amendment — the Admin read is a signed URL, not an anon read (2026-09-27)

The decision above originally left the Admin reading "through the same
project", which in practice meant reading with the `anon` key. That is not
safe here and the ADR was wrong to leave it open:

- The `anon` key ships inside the public Vite bundle, so every visitor to the
  website has it. A `select` policy for `anon` on `payment-proofs` publishes
  every Guest's GCash/Maya reference number and amount to anyone who loads the
  site. A payment proof is money-adjacent personal data (RA 10173).
- So reads are deliberately **not** granted. `supabase/01-storage.sql` grants
  `anon` insert and update under `payments/` and no `select` in any wording;
  `test/web/supabase-storage.test.ts` fails if one ever appears.
- The Admin reads through the edge function
  `supabase/functions/admin-payment-proof`: it verifies the caller's Firebase
  ID token, requires `profiles/{uid}.role == 'admin'`, and returns a
  60-second signed URL. It carries no sixth copy of the bootstrap email
  allowlist, so an Admin needs a `profiles/{uid}` document (ADR-0005).
- The function is **unrun code** — no Supabase CLI or access token in this
  repository, nothing deployed or exercised against a real bucket. Treat it as
  a review item, not a working feature, until it has been deployed and tested.
