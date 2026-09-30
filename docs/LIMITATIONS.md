# Verified limitations (do not inflate)

Read with `docs/VERIFICATION.md`: that page says what was executed and what the
results were; this one is the standing list of things the system does **not** do.

## Emulator / real Firebase

Rules are verified by **executing their text** with the in-repo evaluator
(`test/rules/engine.ts`) — 151 assertions, **supplemental** verification. The
Firebase Emulator Suite, which is the **canonical** verification, did **not** run
in this environment: no Java runtime, and the emulator JAR host
(`storage.googleapis.com`) is unreachable. `test/emulator/rules.emulator.test.ts`
(`npm run test:emulator`, 40 cases) is the canonical suite on a machine that has
both. A supplemental verdict is never reported as emulator-verified. No Firestore
or Storage **write** has ever been executed against the real services; the
end-to-end scenario ran the website's real modules on their offline adapters.

## OCR

There is **no image-to-text engine** (no Tesseract, no cloud Vision API). `runReceiptOcr` / `extractReceiptFields` parse **text sidecars and filename-like strings** with regex — and can mis-capture on prose (a receipt that says "Transaction Receipt" yields the word, not the number). Guests must confirm or type the reference and amount. **OCR never sets `payment_status` to verified** (`canAutoVerifyFromOcr()` returns `false`). A real pipeline would need: image → server-side function → OCR engine → text → reference + amount → user confirmation → payment submission → admin verification, with the API key in the function's secret store — never in web JS, the Flutter APK, public config, or Git. There is no `functions/` directory in this repository.

## Rate limiting

`src/lib/rateLimit.ts` is **client UX cooldowns** (login, reset, booking, payment, OCR, chat, review, lock command). Firestore rules do not count requests and there are no Cloud Functions or callables, so server-side rate limiting **cannot be enforced in this architecture** without new infrastructure. Firebase Auth's own brute-force protection and Firebase quotas still apply, but they are managed outside this repo and were not tested here. The cooldowns must not be described as security rate limiting.

## Payment references

The `payment_references` catalogue is Admin-only by rule, and `matchPaymentReference` detects a reference already used by another Booking (unit-tested and exercised in the E2E scenario). **No screen consumes it yet** — the Flutter app never queries the collection, so duplicate detection is a contract function plus a rule, not a wired workflow.

## Terms acceptance

The version is displayed and the checkbox is required by the UI, but acceptance is **not persisted** — no code writes `terms_version` / `terms_accepted_at`, and `recordAcceptance` / `isAcceptanceCurrent` are unused. There is no stored record of which version a Guest accepted.

## Pagination

**Chat is migrated; Guest bookings and the Admin's Bookings list are not.**

`conversations/*/messages` now uses a real Firestore cursor on both sides — the newest 40 on open, 30 older at a time behind `startAfter` / `startAfterDocument`, one bounded listener for live replies (`docs/MESSAGING.md` § 3). Guest bookings, the Admin's Bookings collection and the shared `Pager` still paginate **in memory after the data is loaded** (`src/lib/pagination.ts`, `MAX_PAGE_SIZE = 50`), and search/sort work because the whole (uid-scoped or admin) set is loaded. Migrating those is the same shape of work and is a plan of its own. Do not add Algolia.

## Live location

**The map is an OpenStreetMap raster tile, not an interactive map.** `google_maps_flutter` is *not* a dependency of the Admin app: it needs a second API key, a billing account and a per-app entitlement to ship, and this feature's hard requirement is *see where a Guest is now, without storing where they were*. The panel draws the position on a tile refreshed no more than once every ten seconds and always prints the coordinates, accuracy and age beside it, so a tile that will not load costs the picture and not the information. The Guest's side has no map at all.

**Realtime Database has no per-node TTL, so nothing deletes a position for us.** This was wrong here until 2026-09-30: the feature claimed the server expired every fix at `expires_at_ms`, and it sent a `'.ttl'` field to ask. Two facts make that impossible — Realtime Database has no per-node TTL on any plan, and a key containing `.` is rejected by the Firebase client SDK before the write leaves the browser, so every fix threw `contains an invalid key (.ttl)` and the feature never published a position at all. Expiry is now enforced by `database.rules.json`: the Admin's read sits on the leaf node and is refused once `expires_at_ms` is in the past, so an expired position is unreadable by the server itself. The node is removed on an explicit Stop and by `onDisconnect().remove()` when the connection drops. **The residual:** an abandoned node's bytes can still exist, and the Firebase console — which bypasses rules — will show the coordinate to the owner. Making that disappear too would need a card (Firestore TTL policies require billing) or a scheduled sweeper. The rules case is `test/emulator/realtime-rules.emulator.test.ts`; the payload case is in `test/web/live-location.test.ts`.

**The Admin-side role mirror needs a first run by an allowlisted Admin.** `firestore.rules` can read `profiles/{uid}.role`; Realtime Database rules cannot read Firestore, so a Profile-promoted Admin is admitted by `live_location_admins/{uid}`, which only an address on the bootstrap allowlist may write. Until an allowlisted Admin has opened the app once after deploying the database rules, a promoted Admin gets a refused read and the panel says so.

**Retention has no scheduler in this repository.** `messages_expires_at` is stamped and the policy is unit-tested, but Firestore Security Rules cannot delete on a schedule and there is no `functions/` directory here. The TTL policy and the `sweepMessages` function to deploy are written out in `docs/MESSAGING.md` § 4. Until they are deployed, the stamp is a schedule with nobody on it.

## Cache and cookies

- Cookie `hdl_tutorial_done`: the only cookie. Tour preference only; 180 days, `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (JS must read it). No auth or payment secrets.
- Hosting caches `**/*.js` and `**/*.css` for a year as `immutable`; Vite's content hashes make that safe. No service worker, no app-shell cache.
- Firebase Auth persistence (IndexedDB) is the session: ID token (~1h) + refresh token. Standard SDK behaviour, XSS-readable; there is **no CSP header** (a hardening gap). Sign-out clears it.
- localStorage (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:review:{bookingId}`, local auth store) is the **demo fallback when Firebase is not configured**. No payment credentials, card data or API keys — ever.

## Chat / reviews without Firebase

If `VITE_FIREBASE_*` is unset, chat and reviews persist in **this browser only**. Rules exist for cloud; the UI writes to Firestore when configured.

## Reviews

- **The emulator suite did not run** (no Java), so the new `reviews`,
  `public_reviews` and Activity-action-list cases in
  `test/emulator/rules.emulator.test.ts` are **written, not executed**. The
  `test/rules/` verdicts are the supplemental in-repo evaluator, never reported
  as emulator-verified.
- **The Dart was not compiled** (no Flutter SDK): `lib/services/review_policy.dart`,
  `lib/models/review_model.dart`, `lib/services/review_service.dart`,
  `lib/views/reviews/*.dart` and `test/review_policy_test.dart` are **written and
  reviewed, not compiled**.
- **No push notification.** The "How was your stay?" prompt is the entry point on
  `/account`. There is no FCM infrastructure in this system and none was added for
  a review; introducing one would be a new trust boundary, not a feature.
- **The public average is published by the Admin.** In the cloud the website
  reads `site_config/review_summary`, which an Admin has to write for a number to
  appear. Nothing computes it automatically, and no Cloud Function was added.
  In demo mode it is computed from what is published.
- **The Admin's review search is a prefix match**, not full text: Firestore has
  no `contains` operator without an index, so a range on `text` is used and only
  Reviews whose words *begin* with the query are found.
- **Reviews are never deleted by the system.** `hidden` keeps the document and
  the decision; a purge would need a Firestore TTL policy and an Admin decision
  about how long a Guest's words are kept. Neither is deployed.
- **The public testimonial is an editorial act.** The Admin chooses which words
  are quoted and under whose name. That is the point — a Guest cannot put their
  own words in front of strangers — but it does mean the website's quotes are
  chosen, not sampled.
- **Two review numbers exist, deliberately.** The website's average counts only
  published testimonials; the Admin app's counts every Review they can moderate.
  They are different questions and the UI labels them.
- **The curated Airbnb quotes are separate and stay that way.** They are
  transcribed from the listing under `src/config/site.ts`'s rule that reviews
  come only from the listing itself. On-site Reviews appear in their own block.

## Firestore rules findings — resolved, with the limits of that word

The six gaps recorded by the first verification pass (Guest-forged
`payment_status`; `Reserved` from `Payment Pending` with money unverified; an
unverified `actor_id`; posting into a conversation one does not own; Reviews with
no rule-level eligibility; a Guest labelling a message as an Admin's) were fixed
on 2026-09-24 (ADR-0010), plus two the audit turned up: an unreachable refund
settlement for Guests (now bounded and allowed) and `create` accepting a claimed
`verified` / `approved` state. Each finding's `FINDING:` test is now an asserted
refusal, with the application half covered in
`test/web/authorization-regressions.test.ts` and the canonical cases in the
emulator suite.

"Resolved" here means **the rule text refuses it and the module refuses it** —
verified by the supplemental evaluator, not by the emulator. It does not mean the
behaviour has been observed against a running Firebase project.

The invariants themselves are deliberate, and so is their limit: they are about
money and identity (who may set what value, whose name a record carries), not a
copy of the booking state machine. The state machine still lives once, in
`src/lib/booking/` and `lib/services/booking_lifecycle.dart`.

Things that remain **outside** the rules' reach, unchanged by the pass:

- OCR (`runReceiptOcr`, regex over text) is a convenience; it never sets a
  payment state, and the rules do not care whether a human or a regex filled the
  form in.
- The `payment_references` catalogue is Admin-only and now void-only once used,
  but no screen consumes it (see above), so duplicate detection is still a
  contract function rather than a workflow.
- Nothing server-side can count requests, throttle a client, or reverse a bad
  write; the rules can only decide per write.


## Flutter

This environment has **no Flutter SDK**. `flutter analyze`, `flutter test` and `flutter build apk` were **not executed** — including for `test/chat_limits_test.dart`, `lib/services/live_location_service.dart`, `lib/services/chat_retention.dart` and `lib/views/inbox/live_location_panel.dart`, which are written and reviewed but **unverified by a compiler**. No Admin workflow has been verified on a device or emulator.

## Guest mobile app

ADR-0007: Guest = website, Admin = Flutter. A Guest-facing mobile app is **not in this repository**. If the thesis requires a Guest APK, that remains a product gap.

## The retired tracking module

`tracking_sessions` (ADR-0009) still denies read, create and update to every caller; the Admin keeps `delete` so a leftover session from before the withdrawal can be erased. It is **not** what live location uses today — see [Live location](#live-location) above and ADR-0013. Access logs and Booking timestamps are untouched.
