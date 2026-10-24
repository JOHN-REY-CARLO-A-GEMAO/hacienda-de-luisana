# Guest Booking policy and availability

Hacienda de LuisAna requires a Guest Booking at least **30 Manila calendar days before check-in** by default. The inline calendar and native date inputs are convenience and explanation layers; the server callable is the authoritative Guest-create boundary.

| Rule | Current behavior |
| --- | --- |
| Business timezone | `Asia/Manila` |
| Minimum lead time | `site_config/booking.minimumBookingLeadTimeDays`; default 30 |
| Stay occupancy | Half-open `[check_in, check_out)` |
| Standard website stay | One night under the existing Published rate model |
| Maximum stay | 20 nights (`MAX_STAY_NIGHTS`), enforced in the picker, the preflight and `submitBooking` |
| Pending hold | 24 hours from server submission |
| Inventory | `site_config/rates.accommodations[id].available_units` |
| Canonical IDs | `main-house`, `annex`, `house-a-camping` |
| Cloud authority | Private Firestore `bookings` documents |

For example, while Manila's date is 1 October 2026, 30 October is too early and **31 October is allowed**. This is calendar arithmetic, not exactly 720 elapsed hours in the browser's timezone.

## Inline availability calendar

The Stay Details step contains a responsive dual-month date-range picker connected to the selected Accommodation. Two consecutive months are shown side by side on desktop and one month at a time on mobile, with previous/next navigation, **Clear dates**, and **Close** controls. Separate **Check-in** and **Checkout** fields sit above the calendars; both also accept typed dates. Its visible legend and date labels expose state without relying on color alone:

- **Available (green):** at least one unit remains.
- **Booked (red, struck through):** committed occupancy has filled inventory.
- **Pending hold (yellow, struck through):** active Pending holders have filled the remaining inventory.
- **Past / lead-time-invalid / unknown (neutral, struck through):** the Guest cannot select the date.
- **Selected (dark):** the check-in and checkout endpoints; the nights between them are tinted.

Missing inventory, malformed responses, permission failures, network failures, and loading transitions are never represented as Available. The calendar offers Refresh/retry and keeps Continue disabled until the selected range is freshly confirmed.

Selection is two-step: the Guest picks an available check-in, then a checkout. The picker highlights `[check_in, check_out)` and disables any checkout the current booking policy does not support, any range containing an unavailable night, and any invalid or past range. The checkout date is a boundary, not an occupied night: a Booking ending on 20 November does not block another check-in on 20 November, so a booked date may still be chosen as a checkout as long as every night before it is available.

### Date-range selection is separate from pricing eligibility

Any checkout date after check-in, up to 20 nights later, is selectable — not only the next day. The calendar's range validator checks **dates and stay length only** (valid calendar dates, booking lead time, 1–20 nights). It deliberately does not call the pricing preflight: `validateBookingSelection` refuses anything that is not one 22-hour standard stay, and letting that rule decide which dates could be picked is what previously forced `checkout = check-in + 1`.

Pricing eligibility remains enforced where it belongs, unchanged:

- `validateBookingSelection` runs before `/book` advances to payment.
- `deriveQuote` in the `quoteBooking` and `submitBooking` callables refuses a multi-night range with `NOT_A_STANDARD_STAY`.

A multi-night range is therefore visible, selectable and reviewable, and it highlights fully, but it cannot be quoted or submitted while the published rate model prices one night. The UI says so in plain language instead of pretending the range is bookable.

### Maximum stay length

A stay may be at most **20 nights**, counted as checkout minus check-in. `MAX_STAY_NIGHTS` in `src/lib/booking/availability.ts` is the only definition; the mirrored Functions copy is hash-checked by `functions/test/booking-sync.test.ts`.

- The picker stops offering checkout dates at check-in + 20 nights, and the checkout field carries a matching `max`. The bound applies even if a published policy would allow a longer stay.
- Changing the check-in date recalculates the valid checkout range and clears a checkout that is no longer after the check-in or has become longer than 20 nights.
- Typed dates are refused with a message naming the limit and the last valid checkout date.
- `submitBooking` and the quote callable enforce the same limit server-side through `deriveQuote` (`STAY_TOO_LONG`), so a forged request cannot skip it.
- Checkout must always be later than check-in (`CHECK_OUT_NOT_AFTER_CHECK_IN`).

The cap is additive: because the Published rate model currently prices exactly one 22-hour standard stay, a 2–20 night selection can be selected and inspected, and is then refused at quotation/submission as `NOT_A_STANDARD_STAY`/`STAY_LENGTH_NOT_SUPPORTED`. ADR-0021 records that gap and sketches what a priced 1–20 night model would require; it is not approved by this policy.

### State calculation

The canonical projection is in `src/lib/booking/availability.ts` and mirrored into Functions by `scripts/sync-booking-pricing.mjs`.

1. Filter to the requested canonical Accommodation.
2. Ignore Rejected, Cancelled, Completed, and Expired records.
3. Ignore Pending records whose `hold_expires_at` is not later than the trusted evaluation time.
4. Count half-open overlap per date against Published `available_units`.
5. If committed occupancy fills inventory, return `booked`; otherwise, if committed plus active holds fills it, return `pending`; otherwise return `available`.

Committed occupancy takes precedence over Pending in the aggregate reply. The projection returns only day states, never another Guest's Booking record.

## Cloud read boundary

A Guest cannot list private `bookings` documents. Cloud mode therefore calls regional (`asia-southeast1`) `bookingAvailability`, which reads with the Admin SDK and returns only:

```text
{ accommodation, from, to, generated_at, days: [{ date, state }] }
```

Requests use strict ISO dates, one canonical Accommodation, and a bounded range. The browser caches a validated projection for at most 60 seconds, invalidates it when property/range changes, supports manual Refresh, and bypasses the cache for selected-range preflight. Demo mode applies the same pure projection to demo records.

## Authoritative Guest submission

Website records with `source: "web"` go through regional `submitBooking`; they are no longer created directly by the browser SDK. The callable requires Firebase authentication and binds the payload UID to that caller. It validates:

- strict check-in/check-out and configured Manila lead time;
- active Published Accommodation, capacity, guest count, rate class and money snapshot;
- proof/payment fields and quote attestation when configured;
- active committed/Pending conflicts under half-open range rules.

The callable then writes the Pending Booking and first `Submit` Activity event in one Firestore transaction.

### Last-unit serialization

A property-scoped `booking_inventory_locks/{accommodation}` revision is read and incremented in that transaction. This makes concurrent submissions contend even when both overlap queries initially see an empty result. The lock contains only `{ revision, updated_at }`; it contains no dates, capacity, state, Booking ID, or Guest data and is closed to every client. It is transaction coordination—not an availability store. Firestore Bookings remain authoritative.

`firestore.rules` permits direct Booking creation only to authenticated Admins, preserving the existing manual workflow while preventing Guests from bypassing `submitBooking`. Existing owner reads, proof resubmission/withdrawal, Admin review, approval-time recheck, payment verification, stay progression, cancellation, and refund flows retain their existing guards.

## Existing configuration

The Admin-owned document remains:

```text
site_config/booking
  minimumBookingLeadTimeDays: positive integer (supported policy values)
  quotes_required: boolean (optional)
```

Deleting/omitting the lead-time field restores the shared 30-day default. Guests may read this public policy but cannot change it. Published price/inventory remains in `site_config/rates`; no blackout calendar or parallel inventory document was introduced.

## Payment-proof storage boundary

Proof storage and Firestore remain independent stores (ADR-0011). Client and server checks reject known-invalid selections before Booking creation, but this architecture cannot make an upload and a Firestore transaction atomic. An upload that finishes just as policy/availability changes can become orphaned. Preventing or cleaning all such objects requires a separate trusted upload-retention workflow and is not claimed here.

## Deployment

This feature spans several deployable surfaces. A frontend-only release is not sufficient.

1. Deploy `firestore.indexes.json` and wait until the `accommodation` + `check_out` + `check_in` composite index is ready.
2. Deploy the new callable Functions.
3. Deploy the callable-enabled website and verify a test projection/submission.
4. Deploy `firestore.rules` to close direct Guest creation.

Prefer one coordinated release. Closing direct creation before the website calls `submitBooking` causes a temporary Guest-submission outage. Keep Functions in `asia-southeast1`. No production data migration is required; the coordination-lock documents are created lazily.

## Verification — 22 October 2026

Run from the repository root:

```bash
npm test
npm run test:rules
npm run test:functions
npm run lint
npm run build
npm run test:emulator
```

Coverage includes state precedence, active/expired Pending holds, terminal statuses, multi-unit inventory, Accommodation switching, strict dates, checkout turnover, loading/error fail-closed UI, privacy-safe cloud delegation, concurrent last-unit submission, identity/rate/lead-time refusal, atomic Booking/Activity creation, and direct-create Rules closure.

The Firebase emulator suite additionally requires the pinned Google emulator JARs. If their download host is inaccessible, report it as blocked rather than treating supplemental Rules evaluation as emulator verification.

See [ADR-0020](./adr/0020-private-availability-projection-and-transactional-guest-submit.md) for the boundary decision and deployment consequences.
