# A price is attested by the server before a Booking may carry it

**Status**: accepted and implemented, 2026-10-21. **Not yet deployed** — the functions and the
switch are described in [`docs/quotes/IMPLEMENTATION.md`](../quotes/IMPLEMENTATION.md), and until
they are run this document describes a mechanism that exists in this repository and in tests, not
in a live project. Closes the gap recorded in
[ADR-0018](./0018-the-rule-layer-checks-coherence-not-price-and-the-gap-that-opens.md), which
becomes *superseded in part* — see *What ADR-0018 still owns* below.

---

## Context

ADR-0018 recorded a precise hole: `firestore.rules` checks that a Guest's Booking is
*internally coherent* — `amount_due == int(stay_total * 50) / 100.0`, one night, a known rate
unit, `stay_total >= 1000` — and nothing checks that `stay_total` is the number the published rate
card produces. A ₱1,000 Booking for a stay the card prices at ₱6,000 was, and still is, a
legal write. The two candidate arguments for living with it ("Guests use the UI"; "the Admin
checks the screenshot") were both rejected there: the rules exist for the browser console, and a
screenshot proves what was *paid*, never what was *owed*.

That ADR also listed the fixes it rejected, and one of them was the shape chosen here:

> A callable the Guest calls instead of writing directly would be the right long shape, and it
> changes every identity and rate surface at once — that is a project, not a repair.

It turned out not to be a project. It is two functions, a small store, and two rule clauses. The
part that made "one arithmetic" tractable is that the pricing module is **copied, not rewritten**
(see *One arithmetic* below).

## Decision

**What a stay costs is decided by the estate, and recorded where a client cannot write it. A
Booking may not carry money that the estate has not attested, once the estate asks.**

Four parts.

1. **`quoteBooking`** — an `onCall` function in the existing `functions/` bundle (`disputes`
   codebase, `asia-southeast1`, gated by `BOOKING_QUOTES_ENABLED` the way cases are gated by
   `DISPUTES_ENABLED`). It takes *quoteable inputs only* — `accommodation`, `check_in`,
   `check_out`, `guests`, `pet_count`, `late_checkout_hours` — reads `site_config/rates` and
   `site_config/booking`, prices the stay, and writes the answer to `booking_quotes/{id}`. Money
   is not an input, so there is no money to negotiate with: a field the client cannot send cannot
   be argued about. **A quote prices a stay; it does not reserve one.** Availability stays the
   Booking's own Date hold, exactly as before (ADR-0004's 24-hour hold is untouched).
2. **The attestation document is flat**: the priced request, the money, `rates_version`, `bracket`,
   `bound_uid`, `created_at`, `expires_at`, `expires_at_ms`. Flatness is not style — the rules
   compare this document with the Booking field for field, and every level of nesting is
   expressions spent reaching keys instead of checking money. `booking_quotes` has **no `match`
   block at all**, so the catch-all `deny` applies: no client reads it, no client writes it, and
   the Admin's own writes to it are refused as well (the function is the only writer).
3. **`validGuestQuote` in `firestore.rules`** — ANDed into the Guest create path. When
   `site_config/booking.quotes_required` is `true`, a Booking must carry a `quote_id` that
   resolves to a live (`request.time < expires_at`), identity-bound (`bound_uid`) attestation
   whose 19 priced fields match the Booking's — money compared **within one centavo**, because
   `Math.round` does not exist in the rules language and the two sides floor differently: the callable
   rounds the half up (`int(x * 100 + 0.5)`, matching `roundMoney`) while `int(stay_total * 50)` in the
   rule truncates, and on a float a product can land a centavo below its own exact value (₱1,024.10 →
   51204.999…). Demanding equality refused honest quotes. When the switch is
   off the clause is `true`, so the estate's existing behaviour is preserved exactly.
4. **`validAttestedQuote` on the update path** — a Guest may still resend a payment proof for an
   attested Booking, but may not re-price one: once `quote_id` is set, the twelve money and plan
   keys stop being writable by the Guest (`old.get('quote_id','') == '' || !affected.hasAny([...])`).
   One `hasAny` on the `affected` set the clause already computes: no extra read, no clock.

A fifth piece serves the Admin rather than the Guest: **`verifyBookingMoney`**, an Admin-only
callable that re-reads a Booking, re-reads its attestation, and returns a field-by-field verdict —
plus `money_checked`, `money_checked_by`, `money_checked_at` stamps. It deliberately does **not**
rewrite Booking money: an Admin who finds a disagreement has to decide what to do about it, in
the open, rather than have a function quietly change a number a Guest agreed to.

## Enforcement is data, not a build flag

| Switch | Lives in | Read by | Effect |
| --- | --- | --- | --- |
| `BOOKING_QUOTES_ENABLED` | deploy-time env (`functions/.env`) | `quoteBooking`, `verifyBookingMoney` | whether the functions answer at all |
| `site_config/booking.quotes_required` | Firestore document, Admin-writable | `firestore.rules`, `src/lib/quotesApi.ts` | whether a Guest write must be attested |

There is no `VITE_*` variable anywhere in this design. That is the load-bearing choice: turning
enforcement on is one document write, with no website rebuild, and turning it *off* is the same
one write if anything goes wrong. A `VITE_` flag would have made the security posture a property
of a build artifact, which nobody can flip while a Guest is mid-form.

## One arithmetic, mirrored and hash-checked

`functions/src/pricing.ts` does not contain pricing arithmetic. It imports
`functions/src/booking/{rates,money,availability,leadTime,internal,statuses}.ts` — copies of
`src/lib/booking/*` produced by `scripts/sync-booking-pricing.mjs`, which resolves the transitive
`./x` closure, prepends a `GENERATED FILE — DO NOT EDIT` banner carrying `@ts-nocheck`, writes a
manifest of `source_sha256`/`copy_sha256` per file, and refuses in `--check` mode on any drift
(`npm run check:pricing`).

Two directions of drift are possible and both are caught: the website changes and nobody re-syncs
(the source hash no longer matches the manifest), and somebody edits a copy — to fix a bug, or to
quietly change a rate — and regenerates the manifest to match (caught by
`functions/test/booking-sync.test.ts`, which asserts the mirrored body *ends with* the website's
file verbatim, so the only permitted difference is the banner, independent of what the manifest
claims).

The Functions project sets `noUncheckedIndexedAccess`; `src/lib/booking` was not written against
it. `@ts-nocheck` in the generated header is therefore deliberate: a mirror that gets "fixed" to
satisfy a second project's settings is a second implementation of the price, which is the exact
failure this file exists to prevent. Type-checking happens where the module is authored
(`npx tsc -b`) and its behaviour is tested there (`npm test`).

## Refusals are named

`deriveQuote` refuses with one of twelve causes (`REQUEST_SHAPE`, `NOT_A_STANDARD_STAY`,
`LEAD_TIME`, `PUBLISHED_RATES_MISSING`, `PUBLISHED_RATES_MALFORMED`, `ACCOMMODATION_UNKNOWN`,
`ACCOMMODATION_INACTIVE`, `NO_PUBLISHED_RATE`, `GUEST_COUNT_UNPRICED`, `EXTRAS_UNPRICED`,
`NO_DOWN_PAYMENT_PUBLISHED`, `QUOTE_SERVICE_UNAVAILABLE` client-side), each with a sentence for
the Guest and a detail for the log. Two rules hold throughout:

- **The function never defaults a figure.** If `validatePublishedRates` refuses the document, no
  quote is issued — a malformed card must not be priced "approximately", because the Admin would
  then approve a number that came from nowhere. The Guest sees "prices are being updated"; the
  detail goes to `console.error` and to the callable's `details`.
- **A rolled date is a refusal, not a price.** V8's ISO parser turns `2026-02-30` into 2 March;
  `parseQuoteRequest` round-trips every date and rejects what does not come back the same, so a
  stay is never priced for a night nobody asked for.

## What is guaranteed, and by what

| Claim | Enforced by | Test |
| --- | --- | --- |
| A Guest cannot invent a price while enforcement is on | `firestore.rules` + `booking_quotes` | `test/rules/quote-attestation.rules.test.ts` — the 14 forgeries ADR-0018 named, each run twice, with a per-case expectation of whether the un-enforced estate could be reached at all (11 could; 3 are refused by the pre-existing arithmetic gate too, and the test says so rather than claiming a victory the attestation did not win) |
| A Guest cannot re-price an attested Booking | `guestSelfServeUpdate` in `firestore.rules` | same file, the resend-vs-reprice pair |
| A quote cannot be claimed by a second identity | `bound_uid` + expiry in `validAttestedQuote` | same file (`expires_at`, `bound_uid` cases) |
| The server's figure is the page's figure | mirrored module + `check:pricing` | `functions/test/booking-sync.test.ts`, `functions/test/pricing.test.ts` |
| The request carries no money | `QuoteRequest` type, `parseQuoteRequest` | `test/web/booking-quotes.test.ts` (asserts the exact key set sent), `functions/test/pricing.test.ts` (asserts a forged money field is not read) |
| Enforcement off ⇒ nothing changes for Guests | `quotesRequired()` default `false` | the flag-off leg of every case above |
| A Booking can still be written by the Admin without a quote | `validGuestCreate` is the gated clause, Admin path is not | same file, Admin manual-create case |
| The estate can verify any Booking's money after the fact | `verifyBookingMoney` | `functions/test/pricing.test.ts` (comparison), rules test for the immutability |

## What ADR-0018 still owns

Its *Corrections* stand — the duplicate `payment_references` block, `pricingSnapshotImmutable`'s
broken `toSet()`, the fixture lies — and so does its central sentence: **the rule layer checks
coherence, not price.** That is still true of the rules alone. What changed is that the rules now
have something outside the client to be coherent *with*. ADR-0018's tripwire case
(`test/rules/firestore-rules.test.ts`, `GAP (recorded, 2026-10-14)`) is kept rather than flipped:
that suite runs un-enforced, so the five forgeries still pass there, and the new file proves they
are refused once `quotes_required` is `true`. The gap is closed **by construction and by switch**,
not by a rule that now quietly assumes a deployment.

## Rejected alternatives

- **Re-derive the price in the rules, cheaper.** Rejected in ADR-0018 and unchanged: the descent
  is ~500–950 expressions and Firestore reports budget failure as `permission-denied`. The
  attestation clause is bounded by the *number of compared fields* — roughly 25 comparisons plus
  one `exists()`/`get()` pair — because the expensive part happened earlier, in a function.
- **Re-derive in the Admin app at approve (the fix ADR-0018 nominated).** Still worth doing, but
  it refuses *late*: a Guest has already been quoted, paid, and waitlisted, and the estate's
  refund machinery starts turning. Server-attested pricing refuses at the moment of booking.
- **A signed token returned to the client and echoed back.** A token the client holds is a token
  the client can replay, strip, or hand to another identity; and the rules would have to
  re-validate a signature, which is arithmetic the rule language is worse at than a
  field-for-field map compare.
- **Writing money onto the Booking from the function** (a `set()` after the add). Rejected:
  it makes the *Admin-visible* record a two-phase object, so a screenshot can arrive with a
  placeholder total, and it cannot refuse the Guest's write — only clean up after it.
- **A nested `quote` map on the Booking, or the quote in a subcollection.** Either puts the
  attestation somewhere the client's own write can reach, or costs the rules a collection query.
  A sibling document in a client-unwritable collection is the only shape where the comparison is
  a `get()` and the source is unforgeable.
- **`allow write: if false` on `booking_quotes`.** Kept in the end, but as the *absence* of a
  `match` block: a denied-by-default store cannot be re-opened by a later block that ORs in.

## Consequences

- **Money on a Booking is no longer Guest-authored** (under enforcement), which is what makes the
  Admin app's existing `amount_claimed` vs `amount_due` compare at
  `lib/views/payments/payment_screen.dart:1037-1041` sound. **No Dart change is required for the
  security property.** Dart work — showing the attested figures in the Payments screen, and
  routing an Admin's manual booking through `verifyBookingMoney` — is rollout checklist material
  in `docs/quotes/IMPLEMENTATION.md`, not a precondition of closing the hole.
- `firebase deploy --only functions` requires the **Blaze** pay-as-you-go plan. That is a real
  deployment dependency, stated before any claim that the estate is protected, and it is the
  reason the switch defaults off.
- Attestation documents are **kept, not deleted**. An expired quote is dead to the create path and
  is what the Admin's later `verifyBookingMoney` compare reads, so the collection is evidence, not
  cache. Growth is bounded by distinct (identity, stay, rates version) requests because the id is a
  hash of exactly those — a Guest who retries the same stay gets the same document back, unchanged
  and un-extended. `LIMITATIONS.md` carries the fact that nothing ages them out.
- The website always *asks* for a quote and stamps the id when it gets one; with enforcement off a
  failure to ask is not fatal, so the functions and the website can be deployed in either order.
- The offline rules evaluator needed three documented habits: a `get()` on a possibly-missing
  document must be guarded by `exists()`, `let` bindings are evaluated eagerly (so a clause must be
  value-safe on every branch), and `request.resource.data` is modelled as the exact patch rather
  than the merged document. All three are in *Verification notes* in
  `docs/quotes/IMPLEMENTATION.md`, because each one produces a denial that looks like a policy
  refusal — the same failure mode this ADR is about, one level down.

## Amendment (2026-10-22, production-readiness audit)

Four things this ADR stated or implied were corrected during the audit; none changes the decision.

- **The centavo comparison is a window, not an equality.** `int(amount_due * 100 + 0.5)` must fall in
  `[int(stay_total * 50), int(stay_total * 50) + 1]`, and `balance_due` must close `stay_total` to the
  exact centavo. The tolerance is one centavo and no wider: it exists for float representation, not for
  convenience. Because the rule floors each half independently, a forger must still break the closing
  sum to be caught.
- **The callable now refuses to mint what the estate cannot store.** `deriveQuote` runs
  `attestationSurvivesRuleLayer` on its own figures first and answers `QUOTE_BELOW_RULE_FLOOR` (the
  rule's ₱1,000 floor) or `ATTESTATION_UNWRITABLE` instead of writing an attestation the create clause
  would deny — which would have been a self-inflicted outage dressed as a security check.
- **An unusable `quote_id` is a denial, never an error.** The clause interpolated whatever
  `request.resource.data.quote_id` happened to be into a path. No Admin screen writes `quote_id`, so
  the key is absent on every manual Booking, and an engine error is indistinguishable from a refusal:
  activation would have disabled manual bookings. The id is now type-checked and length-checked first.
- **Turning enforcement off is a policy rollback, not a cost rollback.** `let` bindings are eager, so
  the attestation's reads and comparisons are paid on every Guest create whichever way the switch sits
  (asserted in `test/rules/firestore-rule-limits.test.ts`). Anyone reading an earlier draft of this ADR
  as "off means free, so rollback is cheap" should stop; what makes rollback cheap is that the clause
  *decides* nothing when off.

And one tightening proposed during the audit was **reverted**: rejecting fractional published rates
(whole pesos only) to make the two roundings agree exactly. Admin publishes the card through the rules
alone, so a fractional figure already stored would have made every subsequent `deriveQuote` return
`PUBLISHED_RATES_MALFORMED` and stopped online booking. A price of ₱1,999.50 is legal arithmetic for a
hotel; the tolerance is the right answer and the floor is where it belongs.
