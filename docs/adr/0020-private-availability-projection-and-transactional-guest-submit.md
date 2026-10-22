# ADR-0020: Project private availability and serialize Guest Booking submission

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

A Guest must see useful date availability without receiving another Guest's Booking document, name, contact information, payment state, or proof path. Firestore Rules correctly prevent a Guest from listing the shared `bookings` collection, so a browser-side overlap query cannot establish availability. Treating that inability as “available” is unsafe.

A browser calendar is also not an authoritative race boundary. Two Guests can select the final unit from the same stale projection. Approval-time revalidation prevents a later approval conflict, but it does not prevent both submissions from receiving active 24-hour Pending holds.

Existing policy is load-bearing:

- `bookings` is the availability authority.
- A stay occupies `[check_in, check_out)`; checkout is reusable by another check-in.
- Active Pending Bookings hold dates for 24 hours.
- Committed lifecycle statuses block inventory.
- Rejected, Cancelled, Completed, Expired, and expired Pending records do not block.
- Capacity comes from the active Published rates entry for the canonical Accommodation ID.

## Decision

### Read boundary

Expose the regional callable `bookingAvailability`. It accepts one canonical Accommodation and a bounded ISO-date range, reads private Bookings with the Admin SDK, and returns only:

```text
{ accommodation, from, to, generated_at, days: [{ date, state }] }
```

A state is `available`, `pending`, `booked`, or `unknown`. It never includes Booking IDs, Guest data, counts, prices, or payment details. Missing/invalid inventory produces `unknown`; failures fail closed.

The website caches a valid projection for at most 60 seconds to bound reads. Property/range changes invalidate the view, manual Refresh bypasses the cache, and a selected range is force-refreshed before progression. Demo mode runs the same canonical pure projection over demo Bookings rather than introducing a second availability model.

### Write boundary

Website Booking creation uses the authenticated regional callable `submitBooking`. The server:

1. binds the payload to the caller's Firebase UID;
2. validates the request shape, strict dates, Published rate, configured Manila lead time, quote (when required), and payment snapshot;
3. reads overlapping Bookings and applies canonical status/hold/capacity rules;
4. writes the Pending Booking and first Activity event in one Firestore transaction.

Direct client creation of `bookings/{id}` is Admin-only. This closes the browser/console bypass around the server transaction while preserving manual Admin creation and existing owner/Admin update flows.

### Empty-query race

An overlap query can initially return no documents. To prevent two final-unit submissions from both committing around that empty result, the transaction also reads and increments `booking_inventory_locks/{accommodation}`.

This document is coordination metadata only:

```text
{ revision, updated_at }
```

It stores no date, status, capacity, availability, Booking ID, or Guest data. It is closed to all client reads and writes. `bookings` remains the sole source from which availability is computed; the lock is not a competing inventory store. Property-scoped revisions avoid contention between Main House, Annex, and A-House/Camping.

## Consequences

- Unknown or failed reads are never colored green.
- Calendar results preserve Booking privacy.
- Checkout turnover remains half-open and same-day checkout/check-in is valid.
- An active Pending hold is visibly distinct from committed occupancy.
- Competing website submissions for the last unit serialize before either hold is accepted.
- Availability is a point-in-time projection; it can change after display, so submission still revalidates.
- While `site_config/booking.callable_booking_required` is absent or `false` (matching ADR-0019 `quotes_required`), a frontend-only / Spark deployment where `bookingAvailability` or `submitBooking` fails at the callable transport boundary falls back to live Firestore reads (`site_config/booking`, `site_config/rates`, optional non-PII `site_config/availability`, and the caller's own `bookings` documents) and direct rule-checked `addDoc('bookings', ...)` writes — never falling back to browser `localStorage`, and still failing closed when Firestore itself is unreachable or returns malformed config.
- Once Cloud Functions are deployed on Blaze and verified, setting `site_config/booking.callable_booking_required` to `true` closes both client fallbacks and direct Guest `bookings` creation at the Firestore Rules boundary.
- The Functions service account must retain read/write access to Bookings, Published rate/config documents, Activity subcollections, quote documents when enabled, and the coordination-lock collection.

## Deployment order

1. Deploy the website and `firestore.rules` safely at any time while `site_config/booking.callable_booking_required` is absent or `false`.
2. When enabling Cloud Functions (Blaze), deploy `firestore.indexes.json` first and wait until the bounded-overlap composite index (`accommodation`, `check_out`, `check_in`) is ready.
3. Deploy the callable Functions (`firebase deploy --only functions:bookingAvailability,functions:submitBooking,functions:attestQuote`), verify a test projection and submission, and then set `site_config/booking.callable_booking_required = true` (and `quotes_required = true` when enforcing ADR-0019).
