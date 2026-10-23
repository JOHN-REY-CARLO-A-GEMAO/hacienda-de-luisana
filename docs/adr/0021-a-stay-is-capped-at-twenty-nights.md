# ADR-0021: Cap a stay at twenty nights without changing the one-night price model

- **Status:** Accepted (the twenty-night cap). The expansion to 1–20 priced nights is Proposed, not decided here.
- **Date:** 2026-10-24

## Context

The booking date picker needed a maximum stay length: a Guest should not be able to select a checkout date arbitrarily far after the check-in date. The request was a maximum of 20 nights, with the same rule enforced during submission and in the trusted server path.

The repository already enforces a much narrower rule. An online Booking is **exactly one night** — one 22-hour standard stay — in five places:

| Layer | Rule |
| --- | --- |
| `src/lib/booking/rates.ts` | `quoteAccommodation` returns no quote unless the range is 1 night |
| `src/lib/booking/validation.ts` | `nights !== 1` ⇒ `STAY_LENGTH_NOT_SUPPORTED` |
| `functions/src/pricing.ts` | `nights !== 1` ⇒ `NOT_A_STANDARD_STAY`; `attestationSurvivesRuleLayer` requires `nights === 1` |
| `firestore.rules` | `validBookingMoneyInvariants` requires `data.nights == 1` |
| `docs/BOOKING_POLICY.md` | "Standard website stay: one night under the existing Published rate model" |

A 20-night maximum is *looser* than that rule. Making a 20-night Booking valid end to end would therefore also require per-night pricing, a multi-night quote and money snapshot, a different downpayment/balance calculation, and a `firestore.rules` change — a rates and money-policy change, not a date-picker change.

## Decision

1. Add one shared constant, `MAX_STAY_NIGHTS = 20`, in `src/lib/booking/availability.ts` — the module already mirrored into the Cloud Functions bundle by `scripts/sync-booking-pricing.mjs` and hash-checked by `functions/test/booking-sync.test.ts`. There is one number, and both runtimes read it.
2. Export `stayLengthProblem()` and `maximumCheckoutDate()` beside `nightsBetween()`, so the picker, the client preflight and the callable answer "how long is this stay?" the same way.
3. Enforce the cap at every entry point:
   - **Calendar picker** — checkout candidates stop at `checkIn + 20 nights`, and the checkout field carries `max`. This bound holds even if a published policy would allow longer.
   - **Client preflight** — `validateStayDates` (the typed-date path) and `validateBookingSelection` (the pre-payment gate) both refuse 21 nights with a message naming the limit and the last usable checkout date.
   - **Trusted server path** — `deriveQuote` in `functions/src/pricing.ts`, which `submitBooking` and the quote callable both run, refuses 21 nights with the `STAY_TOO_LONG` cause, and refuses a checkout that is not after the check-in. The cause is surfaced to the Guest by `src/lib/availabilityApi.ts`.
4. Keep the existing rules untouched: minimum lead time, availability and the 24-hour Pending hold, published pricing, guest capacity, payment split, and Admin approval. The cap is **additive** — it can only refuse more, never permit more.

The cap is a maximum and the existing price rule is "exactly 1". Those are different questions, and they are answered in different places:

- **Which dates may be picked?** 1–20 nights, any checkout after check-in, each night available. The picker's range validator uses only date and stay-length rules — it no longer calls `validateBookingSelection`.
- **What may be quoted and submitted?** One 22-hour standard stay, unchanged. A multi-night range is refused by `deriveQuote` (`NOT_A_STANDARD_STAY`) and by the pre-payment preflight.

So a Guest can select and visually inspect any 1–20 night range, and a 20-night Booking is still not purchasable. That is deliberate: it makes the date-range behaviour honest without changing rates, money arithmetic, attestation, rules, or payment policy, and it records the gap rather than hiding it behind a calendar that silently forces the next day.

## Consequence of the cap alone

- A Guest cannot select a stay longer than 20 nights anywhere, including by typing dates.
- The UI states the limit ("Stays are 1 to 20 nights") and names the last valid checkout for the chosen check-in.
- The published stay length is unchanged, so no Booking can be created with a total the rate card did not produce.
- `MAX_BOOKING_NIGHTS` in `src/lib/validation.ts` now aliases `MAX_STAY_NIGHTS` (it was 30), so the courtesy validator and the server cannot drift.

## Proposed, not decided: priced stays of 1–20 nights

Allowing a 20-night Booking for real requires a separate, approved change:

1. **Price model.** Decide how multiple nights are priced: `nightlyRate × nights`, or per-night classification (a Friday + Saturday stay spanning a weekday), plus how `units_per_booking` and the guest schedule apply per night. `quotedStayTotal` already multiplies a nightly rate by nights, but `quoteAccommodation` refuses anything but one night, and the two must be reconciled deliberately.
2. **Money snapshot and attestation.** `AuthoritativeMoney.nights` is the literal type `1`; `attestationSurvivesRuleLayer` and `firestore.rules` both assert `nights == 1`. These move together.
3. **Payment.** `amount_due`/`balance_due` already derive from `stay_total`, but the 50% down payment and deposit behaviour should be re-checked against a multi-night total.
4. **Rules and verification.** The change to `firestore.rules` must ship with emulator rules tests (`npm run test:rules`) and the Admin app's Flutter suite, because the Admin app displays and approves these figures too.
5. **Documents.** Update `docs/BOOKING_POLICY.md`, `CONTEXT.md`, and the published-rate contract in `docs/adr/` in the same change.

Until that is approved, `NOT_A_STANDARD_STAY` remains the answer for a 2–20 night selection, and the Guest is told the stay is not one that can be quoted online.
