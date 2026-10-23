# Guest Booking policy and availability

Hacienda de LuisAna requires a Guest Booking at least **30 Manila calendar days before check-in** by default. The inline calendar and native date inputs are convenience and explanation layers; the server callable is the authoritative Guest-create boundary.

| Rule | Current behavior |
| --- | --- |
| Business timezone | `Asia/Manila` |
| Minimum lead time | `site_config/booking.minimumBookingLeadTimeDays`; default 30 |
| Booking window | `site_config/booking.bookingsOpenUntil`; last bookable check-in, absent/empty = open |
| Stay occupancy | Half-open `[check_in, check_out)` |
| Standard website stay | One night under the existing Published rate model |
| Pending hold | 24 hours from server submission |
| Inventory | `site_config/rates.accommodations[id].available_units` |
| Canonical IDs | `main-house`, `annex`, `house-a-camping` |
| Cloud authority | Private Firestore `bookings` documents |

For example, while Manila's date is 1 October 2026, 30 October is too early and **31 October is allowed**. This is calendar arithmetic, not exactly 720 elapsed hours in the browser's timezone.

## Booking window (season cutoff)

The Admin can close the season without deleting rates or blocking dates one by one. `site_config/booking.bookingsOpenUntil` holds the **last calendar date on which a Guest may check in**, in `Asia/Manila` terms. It is a date, not a duration: a rolling "24 months from today" would move under a Guest whose tab stays open, and a Guest who reloads could be told a date they were just shown is closed. The Admin moves the date when the season moves.

- Absent or `""` means **no cutoff**: the 30-day lead time is the only date boundary.
- The cutoff date itself is bookable. A Booking that checks in on the last night checks out the next day; no stay may run past that checkout.
- The inline calendar paints later dates as **Outside booking window** (crossed out, `data-availability="closed"`, disabled) and stops month navigation at the cutoff month.
- The native date inputs receive `max` bounds, the preflight refuses a typed date with `BOOKING_WINDOW_CLOSED`, `submitBooking` re-checks the same document through `deriveQuote`, and `firestore.rules` refuses a direct Guest create after the cutoff.
- The cutoff never shortens the lead time. A date has to satisfy **both** boundaries. If `bookingsOpenUntil` falls before `today + minimumBookingLeadTimeDays`, no date is bookable; the page says **Bookings are currently closed** instead of drawing an all-grey calendar, and the Admin must move the cutoff or the lead time.
- Like the lead time, this is a **creation-time** constraint. Existing Bookings and Admin manual operations are not retroactively restricted, and an Admin manual create is not subject to the cutoff.

Example — the conflict to avoid: on 23 October 2026 (Manila) with the default 30-day lead time, the earliest possible check-in is 22 November. Setting `bookingsOpenUntil: "2026-11-20"` therefore closes the season *before* it opens; a cutoff of `"2026-12-31"` (or a shorter lead time) is needed for a bookable window.

### Configuration

```text
site_config/booking
  minimumBookingLeadTimeDays: positive integer (optional; default 30)
  bookingsOpenUntil: "YYYY-MM-DD" | "" (optional; empty/absent = no cutoff)
  quotes_required: boolean (optional)
  callable_booking_required: boolean (optional)
```

`firestore.rules` refuses a malformed `bookingsOpenUntil` — anything but a real `YYYY-MM-DD` calendar date or the empty string — so neither app has to guess what `"2026-1-1"`, `"2026-02-30"` or a timestamp means. A hand-edited malformed value reads as "open" in the app, matching the lead-time field's fallback.

### Demo mode

With no Firebase project the website runs against local persistence, so `bookingPolicyDB` reads the same document shape from `localStorage['hdl:booking-policy']`; an absent or malformed value means the shared default (30 days, no cutoff). This exists only so a local demo can show a closed season; a deployed build never reads it.

```js
localStorage.setItem('hdl:booking-policy', JSON.stringify({
  minimumBookingLeadTimeDays: 3,
  bookingsOpenUntil: '2026-11-20',
}))
location.reload()
```

## Inline availability calendar

The Stay Details step contains a responsive six-week calendar connected to the selected Accommodation. Its visible legend and date labels expose state without relying on color alone:

- **Available (green):** at least one unit remains.
- **Booked (red):** committed occupancy has filled inventory.
- **Pending hold (yellow):** active Pending holders have filled the remaining inventory.
- **Past / lead-time-invalid / unknown (neutral):** the Guest cannot select the date.
- **Outside booking window (crossed out):** the Admin has closed the season after `bookingsOpenUntil`; no check-in is accepted on or after the following day.

Missing inventory, malformed responses, permission failures, network failures, and loading transitions are never represented as Available. The calendar offers Refresh/retry and keeps Continue disabled until the selected range is freshly confirmed.

Selecting an available check-in chooses the existing one-night standard stay and highlights `[check_in, check_out)`. Checkout is a boundary, not an occupied night: a Booking ending on 20 November does not block another check-in on 20 November.

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

Deleting/omitting the lead-time field restores the shared 30-day default; deleting/omitting `bookingsOpenUntil` opens every future date. Guests may read this public policy but cannot change it. Published price/inventory remains in `site_config/rates`; no blackout calendar or parallel inventory document was introduced.

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
npm run test:disputes
npm run lint
npm run build
npm run test:emulator
```

Coverage includes state precedence, active/expired Pending holds, terminal statuses, multi-unit inventory, Accommodation switching, strict dates, checkout turnover, loading/error fail-closed UI, privacy-safe cloud delegation, concurrent last-unit submission, identity/rate/lead-time refusal, atomic Booking/Activity creation, and direct-create Rules closure.

The Firebase emulator suite additionally requires the pinned Google emulator JARs. If their download host is inaccessible, report it as blocked rather than treating supplemental Rules evaluation as emulator verification.

See [ADR-0020](./adr/0020-private-availability-projection-and-transactional-guest-submit.md) for the boundary decision and deployment consequences.
