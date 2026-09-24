# Verified limitations (do not inflate)

Read with `docs/VERIFICATION.md`: that page says what was executed and what the
results were; this one is the standing list of things the system does **not** do.

## Emulator / real Firebase

Rules are verified by **executing their text** with the in-repo evaluator
(`test/rules/engine.ts`) — 135 assertions. The Firebase Emulator Suite did **not**
run in this environment: no Java runtime, and the emulator JAR host
(`storage.googleapis.com`) is unreachable. `test/emulator/rules.emulator.test.ts`
(`npm run test:emulator`) is the canonical check on a machine that has both. No
Firestore or Storage **write** has ever been executed against the real services;
the end-to-end scenario ran the website's real modules on their offline adapters.

## OCR

There is **no image-to-text engine** (no Tesseract, no cloud Vision API). `runReceiptOcr` / `extractReceiptFields` parse **text sidecars and filename-like strings** with regex — and can mis-capture on prose (a receipt that says "Transaction Receipt" yields the word, not the number). Guests must confirm or type the reference and amount. **OCR never sets `payment_status` to verified** (`canAutoVerifyFromOcr()` returns `false`). A real pipeline would need: image → server-side function → OCR engine → text → reference + amount → user confirmation → payment submission → admin verification, with the API key in the function's secret store — never in web JS, the Flutter APK, public config, or Git. There is no `functions/` directory in this repository.

## Rate limiting

`src/lib/rateLimit.ts` is **client UX cooldowns** (login, reset, booking, payment, OCR, chat, review, lock command). Firestore rules do not count requests and there are no Cloud Functions or callables, so server-side rate limiting **cannot be enforced in this architecture** without new infrastructure. Firebase Auth's own brute-force protection and Firebase quotas still apply, but they are managed outside this repo and were not tested here. The cooldowns must not be described as security rate limiting.

## Payment references

The `payment_references` catalogue is Admin-only by rule, and `matchPaymentReference` detects a reference already used by another Booking (unit-tested and exercised in the E2E scenario). **No screen consumes it yet** — the Flutter app never queries the collection, so duplicate detection is a contract function plus a rule, not a wired workflow.

## Terms acceptance

The version is displayed and the checkbox is required by the UI, but acceptance is **not persisted** — no code writes `terms_version` / `terms_accepted_at`, and `recordAcceptance` / `isAcceptanceCurrent` are unused. There is no stored record of which version a Guest accepted.

## Pagination

Guest bookings, chat and the `Pager` paginate **in memory after the data is loaded** (`src/lib/pagination.ts`, `MAX_PAGE_SIZE = 50`); the Admin app streams the whole Bookings collection. There is no Firestore `startAfter` cursor. Search/sort/filter currently work because the whole (uid-scoped or admin) set is loaded; a cursor migration would move search/sort to the server and needs a plan of its own. Do not add Algolia.

## Cache and cookies

- Cookie `hdl_tutorial_done`: the only cookie. Tour preference only; 180 days, `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (JS must read it). No auth or payment secrets.
- Hosting caches `**/*.js` and `**/*.css` for a year as `immutable`; Vite's content hashes make that safe. No service worker, no app-shell cache.
- Firebase Auth persistence (IndexedDB) is the session: ID token (~1h) + refresh token. Standard SDK behaviour, XSS-readable; there is **no CSP header** (a hardening gap). Sign-out clears it.
- localStorage (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:review:{bookingId}`, local auth store) is the **demo fallback when Firebase is not configured**. No payment credentials, card data or API keys — ever.

## Chat / reviews without Firebase

If `VITE_FIREBASE_*` is unset, chat and reviews persist in **this browser only**. Rules exist for cloud; the UI writes to Firestore when configured.

## Firestore rules findings

Six recorded gaps (Guest-forged `payment_status`; `Reserved` from `Payment Pending` with money unverified; unverified `actor_id`; posting into a conversation one does not own; Reviews with no rule-level eligibility; a Guest labelling a message as an Admin's) plus one semantics question about anonymous Guests writing Activity entries. Each is an executable `FINDING:` test in `test/rules/firestore-rules.test.ts` and is listed in `docs/VERIFICATION.md` §3.3.

## Flutter

This environment has **no Flutter SDK**. `flutter analyze`, `flutter test` and `flutter build apk` were **not executed**; the Admin app's Dart only parses cleanly (44 files). No Admin workflow has been verified on a device or emulator.

## Guest mobile app

ADR-0007: Guest = website, Admin = Flutter. A Guest-facing mobile app is **not in this repository**. If the thesis requires a Guest APK, that remains a product gap.

## Live location

Removed (ADR-0009). `tracking_sessions` denies read, create and update to every caller; the Admin keeps `delete` so a leftover session can be erased. Access logs and Booking timestamps are untouched.
