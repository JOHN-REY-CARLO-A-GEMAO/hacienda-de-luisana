# ADR-0022: A stay of 1–20 nights is priced one standard stay per night

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

ADR-0021 capped a stay at twenty nights and deliberately left the expansion to
*priced* stays of 1–20 nights "Proposed, not decided here": a Guest could select
and inspect a multi-night range, but nothing could quote or submit it while the
published rate model priced exactly one 22-hour standard stay. The business has
now decided to let longer stays be booked online.

The five conditions ADR-0021 listed for that expansion, and what happened to
each:

1. **Price model.** Decided here: one standard stay per night, every night at
   the classification of the *check-in* night — the night that already sets the
   rate. `stay_total = rate_amount × nights + addons`, where pets and a late
   checkout are charged once per stay (a pet fee and an hourly extension are
   not nightly figures). This is the arithmetic the Admin app has always used
   for its own bookings (`rate_amount × nights`), so one Booking carries one
   receipt and one 50/50 split whether it is one night or twenty.
2. **Money snapshot and attestation.** `AuthoritativeMoney.nights` is now a
   count, not the literal `1`; the quote document carries the real nights and
   `firestore.rules` compares them field for field as it already did;
   `attestationSurvivesRuleLayer` bounds the minted nights to 1–20 so a quote
   the rule layer would refuse is never written.
3. **Payment.** Unchanged and re-checked: `amount_due` / `balance_due` are the
   50/50 split of the (now larger) `stay_total`, floored to centavos, and the
   Security deposit is unchanged — it is held against damage, not per night.
4. **Rules and verification.** `firestore.rules` `validBookingMoneyInvariants`
   now checks `nights` is an int from 1 to 20 (the shape check; the price is
   the attestation's business, per ADR-0018). The offline rules suite gained a
   coherent multi-night Guest create and a 21-night refusal; the web and
   Functions suites price multi-night stays through the same paths.
5. **Documents.** `docs/BOOKING_POLICY.md`, `docs/LIMITATIONS.md` and
   `CONTEXT.md` updated in this change.

## Decision

- `quoteAccommodation` prices any stay of 1–20 nights: the guest-count
  schedule's amount for the check-in night, times the nights, plus the
  one-per-stay addons. `PropertyQuote` carries `nights` so every surface that
  renders the quote knows how many standard stays it is made of.
- The one-night restriction is removed at every layer that refused it: the
  client preflight (`validateBookingSelection`), the server quote
  (`deriveQuote` — the `NOT_A_STANDARD_STAY` cause is retired), the payload
  snapshot check (`nights` must equal the nights the dates describe), and the
  BookingPage's own validation message.
- `MAX_STAY_NIGHTS = 20` is unchanged. The ceiling bounds the *length* a Guest
  may book; the price model is one standard stay per night within it.
- The rules' own ceiling for a Guest-written `nights` is the same 20, so the
  shape check and the pricing ceiling cannot drift apart silently.

## Consequences

- A Guest can book and pay for a stay of 1 to 20 nights online, end to end,
  with the same down payment, balance and Security deposit the one-night flow
  uses.
- Every night of a multi-night stay is priced at the check-in night's
  classification. A Friday-to-Sunday stay is three weekend-rate nights; a
  Sunday-to-Tuesday stay is two weekday-rate nights. There is no per-night
  re-classification, because the published schedule is per standard stay and
  the check-in night already sets it.
- A 20-night Booking is now purchasable; before ADR-0021 it could be selected
  but not quoted. The Admin app's approve path and the `verifyBookingMoney`
  callable read the same `nights` field and need no change.
- Historical Bookings are unaffected: they keep their stored snapshot, and the
  legacy `nightly_rate × nights` recovery path is untouched.
