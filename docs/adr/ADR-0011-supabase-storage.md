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

## Amendment — the signer accepts the shapes the estate actually holds (2026-11-01)

The Admin tapped **Buksan at Suriin ang Payment Proof** on a real Booking and
the function answered `Not a payment proof path.` — a 400, before any signature
was attempted. The value was a genuine `payment_proof_url`; the *rule* was too
narrow. The path this bucket is written under has changed twice already:

| Era | Shape written to `payment_proof_url` |
| --- | --- |
| Firebase Storage (pre-ADR-0011) | `payments/{uid}/{bookingRef}/proof.{ext}` |
| Supabase, first cut | same shape, now under `payment-proofs` |
| Supabase, per-attempt (current) | `payments/{uid}/{ref}/proof-{n}[-{uploadId}].{ext}` |

Every Booking written under an older shape is still in Firestore and still
being verified. Refusing to sign one of them left the Admin unable to read a
receipt the Hacienda itself had accepted — the one thing this function exists
to do — and the refusal said nothing about which of the shapes had failed or
what the record actually held.

So validation moved out of a regex literal inside the function and into
`supabase/functions/_shared/proof-path.ts`, which:

- requires `payments/` and at least one folder below it (`{uid}`), so nothing
  outside the prefix the upload policy writes under can be signed;
- refuses traversal (`..`), empty segments, backslashes and control characters,
  before and after percent-decoding;
- accepts any filename that ends in an extension the website can upload —
  `proof.png`, `proof-2.jpg` and `receipt_1.png` are all proofs;
- reduces a *stored address* to the key it names, so a dashboard copy, a
  `payment-proofs/payments/…` key and a public/signed Supabase URL all sign the
  same object;
- names a **Firebase Storage URL** for what it is (`legacy-storage`) instead of
  calling the proof absent: those bytes are in the old bucket, which this
  function has no key for, so the receipt has to be migrated or sent again.

The refusal body now carries `code`, `problem` and the trimmed `recorded` value,
and the Admin app turns that into a sentence naming what is stored. A future
report of this bug should be self-diagnosing.

A second defect was sitting directly behind the first. `decoded` — the verified
Firebase token — was declared with `const` **inside** the `try` block that
verifies it, and read again sixty lines below by the bootstrap-allowlist check.
Nothing type-checks the bundled function, so this was invisible: the first
request that got past the path check threw `decoded is not defined` and
answered 500. Fixing only the path rule would have moved the Admin's symptom
from "not a payment proof path" to "the proof service is unavailable". The
declaration is hoisted, and `test/web/supabase-storage.test.ts` now pins it —
the same assertion style `firestore.rules` gets, since a Deno function in this
repository is text either way.

Being pure, the module is the first part of this function covered by a test that
runs the real code (`test/web/supabase-storage.test.ts`) rather than a copy of
its regex. A widened rule is still a narrowing of the deployment gap, though:
the function must be redeployed (`supabase functions deploy admin-payment-proof`)
before any of this reaches the Admin's phone — which is also the likeliest
explanation for a 400 arriving from a build whose source already accepted the
shape.
