# Local vs cloud data

| Record | Source of truth | Local |
| --- | --- | --- |
| Users / profiles | Cloud Firestore `profiles` | Session cookie / Firebase Auth persistence |
| Bookings | Cloud Firestore `bookings`; private Guest records are the sole availability authority. Website creates use the regional `submitBooking` callable; direct client creates are Admin-only. | localStorage fallback only when Firebase is not configured (demo) |
| Availability projection | Regional `bookingAvailability` callable derives aggregate `available` / `pending` / `booked` / `unknown` days from private Bookings and Published inventory; it stores no projection documents. | ≤60-second validated browser cache; demo mode derives from local demo Bookings with the same pure function |
| Booking submit coordination | Cloud Firestore `booking_inventory_locks/{accommodation}` contains only `{ revision, updated_at }`, is server-only, and serializes empty-query/last-unit races. It is not inventory or an availability source. | none |
| Payment proofs | Cloud Storage `payments/{uid}/…` | none |
| Payment reference catalog | Cloud `payment_references` | Admin app may keep a working copy on device |
| Access logs | Cloud `access_logs` | none |
| Admin Security PIN record (ADR-0015) | Cloud `admin_security/{uid}` — PBKDF2 hash, salt, rounds, lockout counters; own-doc-only in the rules; **not deletable by any client** since ADR-0027, which moved the forgotten-PIN reset to the `admin-pin-reset` function | Admin app cache in SharedPreferences (same record shape) so the check works offline; Firestore is the source of truth |
| PIN reset code (ADR-0027) | Cloud `admin_security_resets/{uid}` — only the salted SHA-256 of six digits (`code_hash`, `code_salt`), plus `attempts`, `issued_at`, `expires_at`, `consumed_at` and the send-pace counters; written and read exclusively by `admin-pin-reset` with the Admin SDK, and refused to every client by the rules | none — a code is typed, never stored on the phone |
| PIN reset trail (ADR-0016, ADR-0027) | Cloud `admin_security_events/{eventId}` — `{ uid, action: 'PinReset', at }`, append-only (`update`/`delete` refused for everyone); written by `admin-pin-reset` in the same batch as the delete it records, so the evidence outlives the record. `create` is refused to clients: the server is the only writer | none |
| Chat | Cloud `conversations` (≤1,000 chars a message, read a page at a time) | website demo cache `hdl:chat` when offline, paginated the same way |
| Review | Cloud `reviews` | website demo cache `hdl:review:{bookingId}` |
| Testimonial (public) | Cloud `public_reviews` | website demo cache `hdl:public-reviews` |
| Public review average | Cloud `site_config/review_summary` | computed from the published testimonials |
| UI tutorial | Cookie `hdl_tutorial_done` (SameSite=Lax, not HttpOnly — UI preference only) | same |
| Live location — consent | Cloud Firestore `location_sessions/{convoId}` (no coordinate; ADR-0013) | none |
| Live location — position | Cloud **Realtime Database** `live_location/{convoId}/{guestUid}`, deleted server-side at the session's expiry | none — nothing is stored on the device |
| Live location (retired module) | `tracking_sessions` stays closed to every reader and writer (Admin delete only) | none |

Never store secret API keys, PayMongo secrets, or Firebase Admin credentials in the website or mobile bundle.
