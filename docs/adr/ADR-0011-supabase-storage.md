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
- **Bucket policy is operational, not in-repo:** create a private bucket named
  `payment-proofs` (5 MB image limit to mirror `payments/contract.ts`); the web
  app writes with the anon key, the Admin reads through the same project.

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
