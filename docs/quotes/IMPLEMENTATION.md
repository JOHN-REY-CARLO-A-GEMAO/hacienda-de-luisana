# Server-attested booking prices — implementation and rollout

The mechanism decided in
[ADR-0019](../adr/0019-a-price-is-attested-by-the-server-before-a-booking-may-carry-it.md). This
file is for the person who has to *deploy* it: what the pieces are, the order to do things in, what
to check afterwards, and what will mislead you if you check it with the wrong instrument.

Nothing here is deployed from this repository. The commands are the commands, and the verification
numbers below are from a 2026-10-21 run on this checkout.

## Files

| Path | What it is |
| --- | --- |
| `functions/src/pricing.ts` | The pure half: `parseQuoteRequest`, `deriveQuote`, `moneyMismatches`, `quotePayload`, `ratesVersionDrift`, `ATTESTED_KEYS`, the twelve refusal causes and their Guest sentences. No Firestore, no clock it does not receive. |
| `functions/src/quotes.ts` | `quoteBooking` and `verifyBookingMoney`, the `onCall` pair: reads `site_config/*`, writes `booking_quotes/{id}`, stamps `money_checked*`. |
| `functions/src/booking/*` | **Generated mirror** of `src/lib/booking/*` plus `manifest.json`. Never edit. |
| `scripts/sync-booking-pricing.mjs` | The copier and the checker (`--check` exits 1 on drift). |
| `src/lib/quotesApi.ts` | The website's client: `requestQuote`, `attestationForStay`, `quotesRequired`, `QuoteRefusedError`, `verifyBookingMoney`. |
| `src/lib/firestoreBookings.ts` | `add()` asks for a quote and stamps `quote_id`. One read of `site_config/booking` for both policy decisions (lead time and enforcement). |
| `firestore.rules` | `quotesRequired()`, `validGuestQuote()` (in the Guest create), `validAttestedQuote()`, and the re-pricing clause in `guestSelfServeUpdate()`. |
| `test/rules/quote-attestation.rules.test.ts` | The forgery table, flag off/on per case. |
| `test/web/booking-quotes.test.ts` | The Guest side of the wire: what is sent, what is carried, what is refused. |
| `functions/test/pricing.test.ts`, `functions/test/booking-sync.test.ts` | The server half: the figures, the named refusals, and the mirror's freshness. |

## Data flow

1. Guest picks dates on `/book`. The page prices the stay locally (`quoteAccommodation`) for
   display, as it always has.
2. On submit, `cloudBookingsDB.add()` reads `site_config/booking` **once** —
   `{minimumLeadTimeDays, quotesRequired}` — then calls `quoteBooking` with
   `{accommodation, check_in, check_out, guests, pet_count, late_checkout_hours}`. No money.
3. `quoteBooking` validates the published rates document, re-derives the price with the mirrored
   module, and writes `booking_quotes/{sha256(uid|request|rates_version)}` — flat, `expires_at`
   `QUOTE_TTL_MINUTES` minutes out (default 30, clamped to 1–240), `bound_uid` the caller's uid,
   `created_at` a server timestamp. An identical live request returns the existing document, un-extended (`reused: true`).
4. The client stamps `quote_id` on the payload and writes the Booking. The figures on the record are
   the page's; the rules refuse the write if they do not match the attestation.
5. `firestore.rules`, evaluating the create: if `quotes_required` is `true`, load
   `booking_quotes/{data.quote_id}`, require it live and bound to this uid, and require all 19
   priced fields to match (money to the centavo).
6. Later: the Admin's Payments screen verifies the screenshot; optionally calls
   `verifyBookingMoney`, which compares the Booking with its attestation and with the *current*
   published card, and records `money_checked` — never rewriting money.

A quote **prices**, it does not **reserve**. The 24-hour Date hold still belongs to the Booking
(ADR-0004). Two Guests quoting the same night both get a price; only the writes decide who has it.

## The two switches

| Switch | Where | Who changes it | Off means |
| --- | --- | --- | --- |
| `BOOKING_QUOTES_ENABLED` | `.env` for the Functions runtime (names in `.env.example`), deploy-time | whoever deploys | both callables answer "not enabled"; the website cannot get a quote |
| `site_config/booking.quotes_required` | Firestore document | the Admin, from the app's booking-policy screen or the console | the rules do not require an attestation; a `quote_id`, if present, is carried and ignored |

Order matters in one direction only: **enforcement on before the functions are deployed means no
Guest can book at all** (the website asks, is refused, and fails closed). Deploy the functions,
then flip the document. Turning the document off is the rollback and needs no redeploy.

## Deploy checklist

1. `npm run check:pricing` — the mirror is current. If it is not: `npm run sync:pricing`, then
   `cd functions && npx tsc --noEmit && npm test`.
2. `npm test && npm run test:rules && npm run test:disputes` — expected on this checkout:
   **958 web**, **328 rules**, **218 functions**. `npx tsc -b` and `npm run build` clean.
3. Emulator first, always: `firebase emulators:exec --only firestore,functions --project demo-hdl "npm run test:emulator"`.
   The offline evaluator in `test/rules/` does **not** model Firestore's 1,000-expression budget or
   its read limits, so a suite that is green here can still fail to deploy (ADR-0018 is the story of
   exactly that). The emulator is the only instrument on this machine that can see the class.
4. `firebase deploy --only firestore:rules`, then `firebase deploy --only functions`.
   **`functions` deployment requires the Blaze plan** — on the free Spark plan the deploy fails,
   and nothing in this ADR can be rolled out. The environment the Functions runtime reads must set
   `BOOKING_QUOTES_ENABLED=true`; the repository's `.env.example` names it beside
   `DISPUTES_ENABLED`, and `.env` files stay uncommitted. `QUOTE_TTL_MINUTES` optionally shortens
   how long a price is honoured (default 30). Both callables ship in the existing `disputes`
   codebase (`firebase.json` → `functions[0]`), so there is no second deploy target to configure.
5. Confirm the refusal path from a signed-in Guest browser console *before* turning enforcement on:
   write a Booking by hand with a plausible `stay_total` and no `quote_id`; it must be refused once
   `quotes_required` is `true` and accepted when `false`. If both are accepted, the rules did not
   deploy — check the console's Rules screen shows `validGuestQuote`.
6. Flip it: `firestore` → `site_config/booking` → `quotes_required: true`. Then run the real flow end
   to end (quote → proof upload → Booking appears with `quote_id` → Admin sees the figures).
7. Watch `functions.log` for `quoteBooking` refusals for a day: a rising
   `PUBLISHED_RATES_MALFORMED` count means the published document, not the Guests, is the problem —
   and every Guest seeing "prices are being updated" is an outage, not a bug in this mechanism.

### Admin-app follow-ups (rollout, not security)

The Flutter app is unverifiable in this environment — no Flutter SDK, so nothing below has been
built or run. The security property does not depend on any of it.

- Payments screen: surface the attested figures and a "no attestation on this record" state, via
  `verifyBookingMoney`. (`amount_claimed` vs `amount_due` becomes sound on its own as soon as
  money is not Guest-authored.)
- Admin-created bookings: an Admin's manual Booking has no quote, and the rules already allow that
  (`validGuestCreate` is the gated clause). `verifyBookingMoney` will report
  `rates_version_drift`-style findings for it; that is the intended verdict, not an error.
- A Booking whose `quote_id` is absent because the Guest booked while enforcement was off stays
  writable in the ordinary way. Nothing retroactively freezes money on records made before the switch.

## Verification, and what will mislead you

- `npm run test:rules` proves the *clause*, not the deployment. A green run with the switch off
  proves only the flag-off leg, which is why every case in
  `test/rules/quote-attestation.rules.test.ts` asserts both legs and names whether the write
  "reached the estate" (refused by the pre-existing arithmetic gate, or by the attestation).
- Three evaluator habits, each of which produces a denial that looks like a policy refusal:
  1. `get()` on a possibly-missing document **throws**; guard with `exists(path) ? get(path) : …`.
  2. `let` bindings and ternaries are evaluated **eagerly**, so a clause must be value-safe on every
     branch. Do not rely on `&&`/`||` short-circuiting to protect a later `get()` — pass `{}` and
     compare against it instead (`enforced ? attested : true`, never `!enforced || checks(doc)`).
  3. `request.resource.data` is modelled as the **exact patch** the client sent; Firestore merges
     `updateDoc` patches into the stored document. Build update-test input as
     `{...resourceData, ...patch}` or `pricingSnapshotImmutable` denies a legal write.
- Rules are **OR-ed across every matching block**. Before adding a guard to `bookings`, check
  `grep -n "^\s*match " firestore.rules | sort | uniq -c` — the duplicate `payment_references` block
  in ADR-0018 is what happens otherwise.
- `firestore-rule-limits.test.ts` counts only `let` bindings. It will not tell you a clause is too
  expensive; `test/rules/engine.ts` models no expression budget either. Adding a counter is still
  open work (`docs/HANDOFF-rules-budget.md` §8).
- The centavo comparison exists because there is no `Math.round` in the rule language.
  `int(x * 100 + 0.5)` is round-half-up, matching `roundMoney` in `src/lib/booking/internal.ts`.
  Writing `x == y` for money would refuse honest quotes on float wobble; truncating would too.

## Not done, on purpose

- No quote is a reservation, and no quote queue exists.
- Nothing deletes expired `booking_quotes` documents: they are the evidence behind a price and what
  `verifyBookingMoney` compares against later. Growth is bounded by distinct
  (identity, stay, rates version) — see ADR-0019's consequences. If the estate ever wants a bound,
  `disputeMaintenance`'s schedule is where it belongs, with a floor of "never delete an
  attestation a live Booking still points at".
- No rate limiting beyond the in-process `spend()` guard already in `quotes.ts`; it is per instance
  and best-effort, the same posture as the rest of this codebase (`docs/LIMITATIONS.md`).
- Enforcement off is the shipped default. Proving the mechanism works is not the same as spending
  the estate's booking flow on it.
