# READINESS — Server-Attested Booking Quotes (F13 / F19 / F1 / F8)

Status date: 2026-10-22. Branch `arena/6d428814-hacienda-de-luisana`, base commit `3a0c7e6`, PR #85.
Mechanism: ADR-0018 (why rules cannot price) and ADR-0019 (what prices instead).
Build and deploy checklist: [`IMPLEMENTATION.md`](IMPLEMENTATION.md). Accepted limits:
[`docs/LIMITATIONS.md`](../LIMITATIONS.md). Executed evidence: [`docs/VERIFICATION.md`](../VERIFICATION.md) §16-§17.
Budget history: [`docs/HANDOFF-rules-budget.md`](../HANDOFF-rules-budget.md).

Every result below carries **PASS / FAIL / BLOCKED / NOT RUN** from an actual execution in this
sandbox, on 2026-10-22. A check that could not be executed here says so and names what would
clear it; nothing is labelled PASS because it was reasoned about.

---

## 1. Verdict

**Deploy: yes, with enforcement off. Activate: not yet** — activation needs three things this
sandbox cannot supply, all cheap to obtain and none of them security design changes:

1. one run of `npm run test:emulator` on a machine with Java (the rules engine that actually
   ships has never once executed these clauses),
2. a Flutter `analyze`/`test` run over the Payments screen and the manual-booking screen, because
   the Admin half of the loop is the last unverified writer,
3. a deployed function with `BOOKING_QUOTES_ENABLED=true` **before** anyone flips
   `site_config/booking.quotes_required` — with the callable absent, enforcement means every
   online Booking is refused.

Nothing in the audit found a way to book a stay at a price the estate did not publish **once
enforcement is on**: the amount-claim comparison in the Admin app becomes sound at that moment,
because the number it compares against stops being Guest-authored. Two gaps found on the way are
now closed in code (the Admin landmine, §5) and one documented guarantee was too strong and has
been corrected in the docs.

**Do not read §6's measured numbers as a rules-budget certificate.** They are measured by an
in-house counter and their scale is not Firestore's.

---

## 2. The ten audit items

| # | Item | Label | Evidence |
|---|------|-------|----------|
| 1 | Repo state, PR #85, ADR-0018/0019, IMPLEMENTATION | **PASS** | `git log`/`gh pr view 85` (open); both ADRs and `docs/quotes/IMPLEMENTATION.md` read; `functions` = codebase `disputes`, v2 `onCall`, region `asia-southeast1`, exported from `functions/src/index.ts:14`, and `firebase.json` runs the build in `predeploy` |
| 2 | `quoteBooking` / `verifyBookingMoney` / `booking_quotes` / `BOOKING_QUOTES_ENABLED` / `quotes_required` | **PASS** (rules layer) | `npm run test:rules` 334/334 against the real `firestore.rules`; `functions` 223/223 covering both callables' branches incl. `internal` on read failure |
| 3 | Emulator rules run + expression-budget behaviour | **BLOCKED**; instrumentation **PASS**; new suite **NOT RUN** | no JVM, no egress to `storage.googleapis.com` (probes in §7). Budget counter now exists and is asserted; `test/emulator/quote-attestation.emulator.test.ts` is written and has never been executed |
| 4 | Every Booking create/update path: online Guest, manual Admin, existing bookings, resubmission, retries, concurrency | **PASS** with §6 R4/R6 named | Guest create is `validGuestCreate` ∧ `validGuestQuote`; Guest update is `reservedIsPaidFor() ∧ pricingSnapshotImmutable() ∧ (adminUpdate() ∨ guestSelfServeUpdate())` with a 28-key vocabulary that does not contain `quote_id`, plus a 12-key price freeze once a Booking is attested, and `old.uid == request.auth.uid`; Admin exemption measured at 240 nodes / ≤1 read; local-only submits never reach Firestore |
| 5 | Ownership, expiry, single-use/reuse, rate change between quote and approval, replay onto another Booking | **PASS** except single-use, which is **not a property of this design** | `bound_uid` must equal the writer (cross-uid and unauthenticated refusals are tested); `expires_at > request.time` + `created_at <= request.time` tested; a *stale card version* is treated as unverifiable rather than as a mismatch (`STALE_CARD`); the same request re-mints to the same document id, so a retry reuses one attestation by construction |
| 6 | The 19 attested fields cover every price-affecting input; rounding, currency, 50% split | **PASS** on inputs and the split, **FAIL→fixed** on rounding, **documented** on currency | field-by-field: every input the estate prices from is compared (§4); `validPublishedAccommodation` pins `down_payment_percent == 50` (`firestore.rules:464`) and refuses any other value at publication; the one-centavo `int(t*50)` artefact is tolerated by the window and refused at mint by `attestationSurvivesRuleLayer`; currency is a convention, not a check |
| 7 | Admin approval and verification: only backend-derived amounts set the payable balance; verification never silently rewrites money | **PASS** at the rules/API layer | `verifyBookingMoney` performs exactly one write — `bookingRef.update({ money_checked: record })` at `functions/src/quotes.ts:279` — and never touches an amount; `unattestedVerdict` answers `STALE_CARD` when the card moved, which reads as "cannot verify now", not as "the Admin should correct the money"; the Admin rules path stays `allow update: if isAdmin()`, so an Admin-priced manual Booking is not attested and says so (§6 R5) |
| 8 | Payments screen and manual booking compatible with attested pricing; Flutter changes if required | **PASS (no Dart change required)**; verification of the Dart suite **BLOCKED** | the approval path already refuses a short proof from the Booking's own figures — `lib/services/booking_lifecycle.dart:1037-1041` (`claimed < owed` → refused) with a `claimed > 0` pre-check at `:896` — and those are the two fields the attestation pins; `grep -rn quote_id lib --include=*.dart` finds nothing, so no Dart file had to learn about quotes. `flutter`/`dart` are absent here and there are no `*.test.dart` files in the tree (§6 R8) |
| 9 | Auth, authz, abuse, logging, and hosting the callable in the `disputes` codebase | **PASS** with §6 R3/R7 named | `quoteBooking` requires `request.auth.uid`; `isWriterAdmin` re-resolves server-side (`getAuth().getUser`, then a verified bootstrap address or `profiles.role === 'admin'`) rather than trusting a token claim; every logging/metadata read failure returns `internal` instead of degrading quietly; mints are braked per identity by `MinuteBudget` (bounded rows, pruned, retry seconds in the error), and logs carry `code + detail` with no PII |
| 10 | Firebase plan requirements, cost drivers, config, deploy dependencies, rollback | **PASS**, §8 | Blaze plan for `functions`; cost drivers are one extra document write per quote, up to two extra rule reads per Booking create, and one `getUser` + one `get` per verification |

---

## 3. Checks executed here

| Command | Result |
|---|---|
| `npm run test:rules` | **PASS** — 7 files, **334 / 334**; the committed tree ran 328, and the six added cases are the two in `test/rules/quote-attestation.rules.test.ts` (unusable `quote_id`, fractional total) and the four measured-cost assertions in `test/rules/firestore-rule-limits.test.ts` |
| `npm test` | **PASS** — 68 files, 958/958 |
| `npm run test:e2e` | **PASS** — 44/44 (booking-migration cloud e2e) |
| `npm run test:safety` | **PASS** |
| `npm run check:pricing` | **PASS** — the mirror of `src/lib/booking/rates.ts` into `functions/src/pricing.ts` is current |
| `npx tsc -b` | **PASS** — clean, includes `test/` |
| `npm --prefix functions test` | **PASS** — runs `tsc` then 223/223 |
| `npm run test:invariants` | **FAIL — pre-existing, unchanged**: 22 failed / 9 passed, all `DESIRED` cases. Reproduced identically in a worktree at `3a0c7e6`, so this work did not move it |
| `npm run test:qa:booking` | **BLOCKED** — "Playwright (optional browser QA tooling) missing" |
| `npm run test:rules:baseline` / `check:rules:baseline` | **BLOCKED** — the harness pins base commit `e5155de`, unreachable in this shallow clone (3 commits). Needs a full clone |
| `npm run test:emulator` | **BLOCKED** — no `java`/`javac`, `apt-get` unavailable, no docker, `storage.googleapis.com` refused at TLS. Not attempted blindly |
| `npm run test:flutter` / `test:flutter:analyze` | **BLOCKED** — no `flutter`, no `dart` |

**No existing security test was weakened or deleted**, checked rather than asserted: diffing every
`it()` title under `test/rules/` between base `c0f443e` and this branch finds **zero removals or
renames**, and across all of `test/` the count goes 1,204 → 1,214. The only deleted files are three
stray `scratch-probe` / `zz-probe` scratch tests. `test/rules/disputes.rules.test.ts` still passes,
so the canonical rules comparison is intact.

---

## 4. What the attestation covers, and what it cannot

The 19 compared fields: `accommodation, check_in, check_out, guests, pet_count,
late_checkout_hours, rate_unit, rate_amount, rate_classification, nights, stay_total, amount_due,
balance_due, security_deposit, payment_plan, policy_version, policy_effective_date, rates_version,
refund_policy_snapshot`.

- **In the comparison, and only there, does it bite:** every key the estate's price is computed from,
  plus `amount_claimed`, which the rules tie to the attested `amount_due`. `payment_proof_url` is
  *not* attested — no hash of the screenshot is in the payload — so the Admin still reads the receipt;
  what has stopped being Guest-authored is the figure it is checked against.
- **Outside it, on purpose:** `name`, `email`, `phone`, notes, `hold_expires_at`, `source`,
  `screening_*`, cancellation and refund fields. A quote therefore does not freeze a Guest's
  contact details, and does not promise a refund outcome beyond the `refund_policy_snapshot`
  string it carries.
- **Currency is assumed, not asserted.** Nothing checks that `rate_amount` is pesos; the card is a
  single-currency document by convention, now written down in `docs/LIMITATIONS.md`. A card published
  in another currency would price correctly and mean something else.

---

## 5. Gaps found by this audit and closed in code

| ID | Finding | Fix | Test |
|----|---------|-----|------|
| **F1** | `validGuestQuote` interpolated `quote_id` into a lookup path with no type check. **No Admin screen writes `quote_id` at all** (`grep -rn quote_id lib --include=*.dart` → zero matches), so every manual Booking arrives with the key absent, and `booking_quotes/$(null)` would have thrown inside the clause the moment the switch went on. An engine error is indistinguishable from a denial, so the visible outcome would have been: Admin manual bookings stop working at activation. Confirmed by reproducing the parse-level failure against the real grammar. | `quoted` now checks `is string && size in 1..64` and an unusable id routes to a sentinel path, so the clause returns a boolean denial instead of an error — for a Guest, and nothing at all for an Admin | `test/rules/quote-attestation.rules.test.ts` ("an unusable quote id is a denial, never a parse error"), the Admin case in `test/emulator/quote-attestation.emulator.test.ts`, and the measured 240 nodes / ≤1 read on the Admin path |
| **F8** | The rule's `int(stay_total * 50)` and `downPaymentAmount`'s centavo arithmetic disagree by one centavo on some totals — a float-representation artefact rather than a rounding policy: ₱1,024.10 prices to ₱512.05 on the page while `1024.10 * 50` truncates to 51204, i.e. ₱512.04, and the old equality refused it. Separately, `deriveQuote` could mint an attestation the rules refuse to store at all (sub-₱1,000 totals): a quote that always denies, i.e. a self-inflicted outage. | rules compare in whole centavos inside a **one-centavo** window and require `balance_due` to close `stay_total` exactly; the callable refuses with `QUOTE_BELOW_RULE_FLOOR` / `ATTESTATION_UNWRITABLE` rather than minting anything the estate cannot store | `attestationSurvivesRuleLayer` is the single agreement both sides are tested against: 5 new `functions` tests and a new rules case, including the fractional total the old rule refused |
| **F13** | No expression/read budget was measured anywhere; the failure mode that broke production on 2026-10-14 was guarded only by a comment. | the rules engine reports `expressions` and `reads` per decision, and `firestore-rule-limits.test.ts` asserts a read limit, an enforcement delta bound, an absolute canary ceiling, and that the Admin path pays nothing | 4 new cases in `test/rules/firestore-rule-limits.test.ts` |
| **F19** | Two abuse/robustness holes in the backend: a signed-out client was told "the estate has not published a price", and `minted`/`seen` grew a Map entry per booking id forever. Plus `verifyBookingMoney`'s no-quote branch carried a second copy of the comparison that disagreed with the rules. | `quotesApi` refuses with `AUTH_REQUIRED` (retryable) before the network call; the limiter is now a `MinuteBudget` with a row cap and pruning, and reports retry seconds; the no-quote branch delegates to `unattestedVerdict`, shared with the tests | `MinuteBudget` and `unattestedVerdict` cases in `functions/test/pricing.test.ts` (limit, rollover, prune bound, `namedButGone`) |

## 6. Residual risks, named

| ID | Risk | Why it is not a blocker / who owns it |
|----|------|---------------------------------------|
| R1 | **Budget not verified by Firestore.** Measured on the real file: a Guest create with enforcement on costs **1,190** nodes and **8** reads; the Admin create 240 / ≤1; a Guest update 533 / 2. The counter counts grammar nodes, so it over-counts relative to Firestore — the deployed file is ~40 KB and ships today. | The emulator run in §7 is the check. If the emulator refuses to deploy, that is a *hard* stop, not a warning |
| R2 | **The cost is paid even with enforcement off.** `let` bindings are eager (in this engine and in Firestore), so the quote document is `exists()`+`get()`-ed on every Guest create regardless of the switch; flipping enforcement off is a *policy* rollback, not a cost rollback. Asserted so the fact cannot be lost. | Accept, or accept and later optimise. Nobody is paying 20 reads |
| R3 | **An expired quote still lets the Booking through.** The update path allows a proof resubmission while `quote_id` is set, even if the attestation has expired. | Deliberate, and the safe direction: denying it would delete evidence for a Booking that is already written. Owner: the same person who decides whether re-quoting an expired stay should be possible at all |
| R4 | **`uid` self-assertion at create.** `validGuestCreate` requires a non-empty `uid`, not `uid == request.auth.uid` (ADR-0004). The *attestation* is bound to the authenticated writer, so a Guest who claims another uid cannot attach that other Guest's quote — they get a denial; but they can still *name* someone else on an unenforced estate. | Pre-existing and out of scope for this mechanism; the reason it is listed here is that attestation makes the asymmetry visible. Needs its own decision |
| R5 | **Money the Admin enters is not attested.** A confirmed payment on an Admin-priced manual Booking carries `money_checked.source: 'admin'`. The rules cannot tell a correct Admin price from a wrong one, and do not try. | Accepted by ADR-0019's own scope. The audit's contribution is that verification can no longer be laundered silently: a stale card version reads as `STALE_CARD` rather than as an invitation for the Admin to "correct" the money |
| R6 | **No single-use enforcement, no replay window beyond `bound_uid`.** A quote is a document keyed by a hash of the request plus the card version; it is never consumed, so the same attestation backs the same Booking twice (a retry — desirable) and could back a second identical Booking by the same uid (harmless money-wise, but it exists). | Preventing it would need a claim on the quote document, i.e. a Guest write, which the collection forbids. Owner: whoever wants double-booking prevention at the rules layer; today that is the `hold_expires_at`/availability path, not the quote |
| R7 | **`verifyBookingMoney` reads `site_config/rates` through the same Admin client the rules restrict**, and that read has no rules-querier allow-list entry anywhere in this codebase — there is no `firebase.json` `functions[0].` config block and no central runtime-config module (`functions/src/index.ts` and `quotes.ts` read `process.env` inline). The callable turns the failure into `internal` rather than "verified", so the exposure is an outage of *verification*, not of booking. | Confirm what identity `adminReader()` assumes and whether `site_config/rates` is readable for it — this is a one-line check in a deployed environment, not a design question. The quote env vars are declared in `.env.example`, which is where this codebase records them |
| R8 | **The Flutter half of the estate has no executed verification of any kind here.** `pubspec.yaml` and `lib/` are in this tree, but a `find` for `*.test.dart` returns **zero files**, and there is no `flutter` or `dart` binary — so `npm run test:flutter` and `test:flutter:analyze` have nothing to run and no toolchain to run it with. | Owner: whoever has the SDK. It is not a blocker for the guarantee, which is enforced in `firestore.rules` and `functions/`; it is a blocker for claiming the Admin screens behave |
| R9 | **Guests see the callable's refusal text.** `QuoteRefusedError` propagates out of `submitBooking` uncaught (correctly — it is fail-closed), so an enforced estate shows e.g. "The estate has not published a price for these dates." rather than the screen's own diagnosis wording. | Cosmetic; fix in the screen's error classifier when someone is in that file |

---

## 7. To clear the BLOCKED items

On a machine with a JDK (or `npm run prepare:phase0:java`) and a **full** clone:

```bash
npm ci && npm --prefix functions ci
firebase emulators:exec --only firestore --project demo-hacienda \
  'npx vitest run --config vitest.emulator.config.ts'      # includes test/emulator/quote-attestation.emulator.test.ts
npm run test:rules && npm run check:rules:baseline         # the baseline harness needs the real history
cd lib && flutter analyze && flutter test                  # and the Dart suite from the repo root: npm run test:flutter
```

Three things count as a clean run, and only the first two are the usual kind: every case green,
**no** `PERMISSION_DENIED` on a case that expects success, and no line in the emulator output
mentioning an expression limit or `too complex`. If `booking_quotes` reads are refused for the
Admin case, that is the querier question in R7, not a rules bug.

---

## 8. Activation plan

**Plan and billing.** `functions` requires the **Blaze** plan: on Spark the deploy fails and nothing
in this document can be rolled out. Expected marginal cost per booking: one `booking_quotes` write,
one callable invocation, up to two extra rule reads on the create, and one `getUser` plus one `get`
per Admin verification. Rate limiting per identity lives in this codebase (`MinuteBudget`, default 12
mints per uid per minute); Firestore rules provide no throttling of any kind.

**Configuration.** `BOOKING_QUOTES_ENABLED` (fail-closed: anything but the literal `true` refuses,
with `FUNCTIONS_EMULATOR=true` the one convenience for local runs), `QUOTE_TTL_MINUTES` (clamped
1–240, default 30) and `QUOTE_RATE_LIMIT_PER_MINUTE` (clamped to at least 1) — all three named in
`.env.example`, none committed, and because these are generation-2 functions they must be set in the
runtime environment that already carries `DISPUTES_ENABLED`; `.env` files are not read at deploy time.
The bootstrap Admin addresses are **not** configuration: they are a hard-coded pair at
`functions/src/quotes.ts:48`. The **enforcement** switch is not an env var either — it is the
Admin-writable document `site_config/booking.quotes_required`, so flipping it needs no deploy and
cannot be set from the website.

**Order, and why this order.**

1. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`). With the switch absent,
   `validGuestQuote` allows everything, so this step is inert for Guests — but it is what makes step 2
   checkable, and the emulator run in §7 must precede it.
2. Deploy the callables with `BOOKING_QUOTES_ENABLED=true`. Confirm `quoteBooking` returns an
   attestation for a real stay, and that an unauthenticated call is refused with `unauthenticated`.
3. Leave the switch off and run the website against production for one business day, then read a
   sample of written Bookings and `get()` their `booking_quotes/{quote_id}`: the id must be present
   and the document must exist. A Booking with no `quote_id` after a successful submit means the client
   skipped the callable (local-only storage, or a refusal while enforcement is off) — legal today, and
   precisely what step 4 starts refusing.
4. Flip `site_config/booking.quotes_required` to `true`. Guest clients learn the switch from
   `bookingPolicyDB.getGuestPolicy()` and start demanding attestations; the Admin app needs no change,
   because it never reads or writes `quote_id` (§5 F1).
5. Rollback: set the field to `false`. One document, no deploy, no data repair. It restores the
   pre-feature *policy* immediately; it does not restore the pre-feature *cost* (R2), and it does not
   un-write anything.

**Watch after step 4**: a spike in online submissions that never become Bookings, and `QUOTE_*` or
`PUBLISHED_RATES_MALFORMED` counts in `firebase functions:log`. Both should sit at zero. Step 7 of
`docs/quotes/IMPLEMENTATION.md` says why the second one is an outage of prices rather than of Guests.

---

## 9. One reversal, recorded so it is not relitigated

An earlier cut at F8 tightened `validatePublishedRates` to whole pesos, so ₱1,999.50 could never be
published. **That was wrong and it has been reverted.** Admin publishes the card through the rules
alone, so a fractional figure already saved would have made every subsequent `deriveQuote` return
`PUBLISHED_RATES_MALFORMED` — a self-inflicted booking outage in exchange for a pricing nicety that
is not a security property. A hotel may price at ₱1,999.50. The correct response to a half-centavo
disagreement is the tolerance in §5/F8, plus refusing to mint an attestation the rule layer cannot
accept. Both are now tested; the reasoning sits next to the validators in
`src/lib/booking/rates.ts` (the note at :213) so the two halves cannot drift apart again.
