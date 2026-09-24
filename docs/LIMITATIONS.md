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

Guest bookings, chat and the `Pager` paginate **in memory after the data is loaded** (`src/lib/pagination.ts`, `MAX_PAGE_SIZE = 50`); the Admin app streams the whole Bookings collection. There is no Firestore `startAfter` cursor. Search/sort/filter currently work because the whole (uid-scoped or admin) set is loaded; a cursor migration would move search/sort to the server and needs a plan of its own. Do not add Algolia.

## Cache and cookies

- Cookie `hdl_tutorial_done`: the only cookie. Tour preference only; 180 days, `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (JS must read it). No auth or payment secrets.
- Hosting caches `**/*.js` and `**/*.css` for a year as `immutable`; Vite's content hashes make that safe. No service worker, no app-shell cache.
- Firebase Auth persistence (IndexedDB) is the session: ID token (~1h) + refresh token. Standard SDK behaviour, XSS-readable; there is **no CSP header** (a hardening gap). Sign-out clears it.
- localStorage (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:review:{bookingId}`, local auth store) is the **demo fallback when Firebase is not configured**. No payment credentials, card data or API keys — ever.

## Chat / reviews without Firebase

If `VITE_FIREBASE_*` is unset, chat and reviews persist in **this browser only**. Rules exist for cloud; the UI writes to Firestore when configured.

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

This environment has **no Flutter SDK**. `flutter analyze`, `flutter test` and `flutter build apk` were **not executed**; the Admin app's Dart only parses cleanly (44 files). No Admin workflow has been verified on a device or emulator.

## Guest mobile app

ADR-0007: Guest = website, Admin = Flutter. A Guest-facing mobile app is **not in this repository**. If the thesis requires a Guest APK, that remains a product gap.

## Live location

Removed (ADR-0009). `tracking_sessions` denies read, create and update to every caller; the Admin keeps `delete` so a leftover session can be erased. Access logs and Booking timestamps are untouched.
