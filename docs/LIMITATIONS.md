# Verified limitations (do not inflate)

Read with `docs/VERIFICATION.md`: that page says what was executed and what the
results were; this one is the standing list of things the system does **not** do.

## Emulator / real Firebase

Rules are verified by **executing their text** with the in-repo evaluator
(`test/rules/engine.ts`) — 315 assertions as of 2026-10-21, **supplemental** verification. The
Firebase Emulator Suite, which is the **canonical** verification, did **not** run
in this environment: no Java runtime, and the emulator JAR host
(`storage.googleapis.com`) is unreachable. `test/emulator/rules.emulator.test.ts`
(`npm run test:emulator`, 40 cases) is the canonical suite on a machine that has
both. A supplemental verdict is never reported as emulator-verified. No Firestore
or Storage **write** has ever been executed against the real services; the
end-to-end scenario ran the website's real modules on their offline adapters.

## OCR

Receipt OCR runs **in the browser**: `src/lib/payments/ocr.ts` lazily imports
`tesseract.js` (`recognize`) so the bundle, the tests and the demo pages never pay
for it until a Guest actually uploads a screenshot, and `extractReceiptFields`
then parses whatever text comes back — a text sidecar or a filename-shaped string
parses the same way, and prose mis-captures (a receipt that says "Transaction
Receipt" yields the word, not the number). There is no cloud Vision API and no
function that reads the image: nothing that runs where a key could be kept. A
hosted pipeline would be image → function → engine → text → reference + amount →
confirmation → submission → Admin verification, with the key in the function's
secret store — never in web JS, the Flutter APK, public config, or Git.
`functions/` exists and holds the Booking quote, money-verification, availability
and submit callables; it holds no OCR. Guests confirm or type the reference and amount either way, and
**OCR never sets `payment_status` to verified**: `canAutoVerifyFromOcr()` returns
`false`.

## Rate limiting

**Server-side pacing exists now**, in two places.

The **contact form** is paced in its Cloudflare Worker
(`workers/contact-inquiry/src/kvRateLimit.ts`, ADR-0024): **5 requests per 10
minutes per IP**, keyed on `cf-connecting-ip`, answered with `429` and
`Retry-After: 600`. It is a KV counter, and KV has real limits — see below.

The **callables** are paced in `functions/src/security/rateLimit.ts` (ADR-0023):
`submitBooking` (8/min per caller), `quoteBooking`
(`QUOTE_RATE_LIMIT_PER_MINUTE`, default 12/min) and `verifyBookingMoney`. It is a
sliding-window log in Firestore, so it survives instance recycling and has no
minute boundary to step over. Keys are salted hashes; no address is stored raw.
**These cannot deploy on the Spark plan**, so today they describe the design
rather than live behaviour.

What it is **not**:

- **The contact limiter is not atomic, and the window is fixed.** KV has no
  compare-and-set: two simultaneous requests from one IP can both read the same
  count and both write the next one, so the limit can overshoot by roughly the
  concurrency. The window starts at the first request and is not slid, so a caller
  can send five at 09:59 and five at 10:00. Both are free-tier properties, both are
  stated in the worker README § 6, and the upgrade path (a Durable Object keyed by
  IP) is named there.
- **The contact limiter fails open.** A KV read that throws means the inquiry is
  accepted, with `X-RateLimit-Degraded: true` on the reply. Losing a real inquiry
  to a broken binding is the worse failure.
- **No per-email budget on the contact form.** The worker keys only on the real IP;
  the submitted address is unverified, so hashing it into a counter would key the
  limit on whatever an attacker types. Turnstile plus Resend's 100-a-day free tier
  are the backstop.
- **Not enforced for `bookingAvailability`.** That callable keeps a per-instance
  window on purpose (a calendar re-render must not cost a Firestore write), so its
  limit is per instance, not fleet-wide.
- **Not enforced for chat messages or Reviews.** Those are direct Firestore
  writes; `firestore.rules` is the boundary for their shape, author and window,
  and the app's cooldowns are UX only.
- **Not enforced for sign-in or sign-up.** Firebase Auth's brute-force protection
  and quotas apply, managed outside this repository; a function in front of Auth
  would be bypassable and was not added.
- **Not a spam classifier.** Shape, pace and a honeypot; a human still reads
  every inquiry.
- **Not verified against a deployed function or worker here.** No Java runtime, no
  Cloudflare account and no credentials in this environment. The worker's handler
  is exercised directly — fake KV, stubbed `fetch` — and the callables' arithmetic,
  schema and response parsing are unit-tested. The first live check is in
  `workers/contact-inquiry/README.md` § 2f.
- **Degraded when Firestore is unavailable.** The limiter falls back to the
  per-instance window, marks the reply `X-RateLimit-Degraded: true`, and logs it.
  That is a choice: losing real inquiries to a database blip is worse.
- **One read per check, one write per allowed request.** There is no Redis in
  this deployment, so the store is Firestore. A Firestore TTL policy on
  `rate_limits.expires_at` is recommended but **not deployed**, so the collection
  is only kept small by the writes themselves.

`src/lib/rateLimit.ts` is still **client UX cooldowns** (login, reset, contact,
booking, payment, OCR, chat, review, lock command) and must still not be
described as security rate limiting.

## The contact form (ADR-0024)

The form sends a real request to a **Cloudflare Worker** and the inquiry becomes an
**email**. Nothing is stored: no `inquiries` collection, no retention question, and
nothing to surface in the Admin app.

- **A second deployment exists.** The worker has its own KV namespace, its own
  secrets and its own README; `npx wrangler deploy` is a separate step from
  `firebase deploy`. If it is not deployed, the form cannot send.
- **Resend's free tier is the ceiling.** 100 emails a day, and
  `onboarding@resend.dev` only delivers to the Resend account owner until the
  estate's domain is verified. Deliverability beyond that is Resend's, not this
  code's.
- **Turnstile is required in production.** A missing `TURNSTILE_SECRET_KEY` is a
  `500 misconfigured`, not a silently unchecked form. Local development may set
  `TURNSTILE_SKIP_VERIFY`, which is honoured only when `ENVIRONMENT=development`.
- **Cloudflare outages fail open** unless `TURNSTILE_FAIL_CLOSED=true`.
- **The KV counter can overshoot and resets on a fixed window**, and it fails open
  — see *Rate limiting* above.
- **No test against a deployed worker.** See above.
- **CORS is an allowlist.** A preview domain must be added to `ALLOWED_ORIGIN` or
  the browser will be refused — and `npm run dev` against the deployed worker needs
  `http://localhost:5173` there (it is in the default).
- **The functions endpoint is gone.** `functions/src/contact.ts` was deleted with
  ADR-0024; the callables that remain still cannot deploy on the Spark plan.

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

**Retention has no scheduler in this repository.** `messages_expires_at` is stamped and the policy is unit-tested, but Firestore Security Rules cannot delete on a schedule, and the current `functions/` entry point has no messaging-retention scheduler — nothing is scheduled to run this sweep. The TTL policy and the `sweepMessages` function to deploy are written out in `docs/MESSAGING.md` § 4. Until they are deployed, the stamp is a schedule with nobody on it.

## Cache and cookies

- Cookie `hdl_tutorial_done`: the only cookie. Tour preference only; 180 days, `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (JS must read it). No auth or payment secrets.
- Hosting caches `**/*.js` and `**/*.css` for a year as `immutable`; Vite's content hashes make that safe. No service worker, no app-shell cache.
- Firebase Auth persistence (IndexedDB) is the session: ID token (~1h) + refresh token. Standard SDK behaviour, XSS-readable; there is **no CSP header** (a hardening gap). Sign-out clears it.
- localStorage (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:chat-images`, `hdl:review:{bookingId}`, local auth store) is the **demo fallback when Firebase is not configured**. No payment credentials, card data or API keys — ever.

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
- The `payment_references` catalogue is Admin-only. It was not, until
  2026-10-21: a **duplicate `match` block** in `firestore.rules` OR-ed
  `allow create: if isSignedIn()` into the collection, so any signed-in Guest
  could write a row into the catalogue the Admin verifies proofs against — the
  route by which a ₱500 receipt is made to look expected for a ₱32,000 stay.
  The duplicate is deleted, a spent row may now only be `void`-ed (never
  rewritten, never re-listed as `available`, never deleted), and the website no
  longer attempts its own catalogue write. The Admin's Payments screen
  (`lib/views/payments/payment_refs_screen.dart`) is the writer. Nothing marks a
  row spent automatically, so duplicate detection is still a contract function
  rather than a workflow. ADR-0018, *Corrections*, has the detail.
- **The rules do not price a Booking; the functions do, when the estate asks them to.**
  The rules hold a Booking's figures coherent with each other — a stay of 1–20
  nights (one standard stay per night), a
  known classification, the 50/50 split within one centavo, a claim not below the
  downpayment, counts that are counts — and they refuse a *rate document* whose shape
  cannot be priced. Re-deriving the money *inside* `firestore.rules` from
  `site_config/rates` was deleted on 2026-10-14: it crossed Firestore's
  1,000-expression budget, and an evaluation error arrives as the same bare
  `permission-denied` as a refusal. What replaced it (ADR-0019, 2026-10-21) is a
  quote the server attests into `booking_quotes/{id}` — a document no client can
  write — and a rule clause that compares the Booking against it field for field.
  **Enforcement is a switch, and it is currently off**: with
  `site_config/booking.quotes_required` absent or `false`, a Booking that is coherent
  and under-priced — ₱1,000 for a ₱32,000 stay, a zeroed deposit, an unpriced third
  pet, a fourth guest in a three-person unit, a refund policy the Guest typed — still
  passes the rule layer, and only the Admin reading the screenshot stands between it
  and a stay. It is also **not yet deployed**: the mechanism exists in this tree and
  in offline tests (both legs asserted per case in
  `test/rules/quote-attestation.rules.test.ts`), so ADR-0018's "accepted and interim"
  remains the accurate description of a live project today. The tripwire stays where
  it was: `GAP (recorded, 2026-10-14)` in `test/rules/firestore-rules.test.ts` runs
  un-enforced, and fails the day the clause stops refusing those five.
- **Nothing ages out `booking_quotes` documents.** An expired attestation is dead to
  the create path but is what `verifyBookingMoney` compares a Booking against
  afterwards, so it is evidence rather than cache and is deliberately kept. Growth is
  bounded by distinct (identity, stay, rates version) requests — a retry of the same
  stay returns the same document, un-extended — not by bookings, so an abandoned form
  costs one small row. Any future cleanup needs a separately approved scheduler,
  with a floor of never deleting an attestation a live Booking still points at.
- **The currency of a price is a convention, not a check.** Nothing in `firestore.rules` or
  `functions/src/pricing.ts` verifies that `rate_amount` and the totals are pesos; the published
  card is a single-currency document by agreement, and `down_payment_percent == 50` is pinned
  (`firestore.rules:464`) while currency is not. A card published in another currency prices
  correctly and means something else.
- **Turning enforcement off is a policy rollback, not a cost rollback.** `validGuestQuote` binds
  the quote lookup and the comparison in `let` bindings, which Firestore evaluates when declared —
  so with `site_config/booking.quotes_required` false the clause skips the *decision*, not the
  *work* (measured: the two paths are within 40 nodes of each other, `test/rules/firestore-rule-limits.test.ts`).
  Nobody is paying much; the point is that the number does not go back down, and the suite is what
  says so.
- **A stay below ₱1,000 total cannot be attested at all.** The rules' floor is not a policy the
  callable can price around, so `deriveQuote` refuses with `QUOTE_BELOW_RULE_FLOOR` rather than
  minting a quote the estate cannot write. If a legitimate rate card ever drops below that floor,
  the floor is the thing to change, on both sides at once.
- Nothing server-side can count requests, throttle a client, or reverse a bad
  write; the rules can only decide per write. A per-instance limiter does exist in
  `quoteBooking` (`MinuteBudget`, default 12 mints per identity per minute, pruned at 4,096 rows),
  and it is a brake on a runaway client, not a quota: it is per instance and resets on deploy.


## Flutter

**A Flutter SDK is now present** (Flutter 3.44.4 / Dart 3.12.2), where the original
pass of this document recorded that there was none. `flutter analyze` and
`flutter test` have both been executed since — see [VERIFICATION.md](./VERIFICATION.md)
for exactly which suites ran. `flutter build apk` still has not, and **no Admin
workflow has been verified on a device or emulator**; the widget suites drive a
test binding, not the app.

Note that this SDK is newer than the repository, so `flutter analyze` reports
`withOpacity` deprecation notices against code that predates it. They are `info`,
not warnings or errors, and they are the house idiom — do not "fix" them
file-by-file without a deliberate pass.

## Guest mobile app

ADR-0007: Guest = website, Admin = Flutter. A Guest-facing mobile app is **not in this repository**. If the thesis requires a Guest APK, that remains a product gap.

## The Security PIN reset (ADR-0016)

**A PIN reset is not an authentication factor, and it is not free.** Three things
this page has to say plainly, because ADR-0016 changed an invariant to get here:

- **It closes a lockout; it does not stop anybody.** The proof is a signed-in
  Admin session, which is why the door exists at the gate at all — the gate is
  behind Firebase sign-in. Anyone holding a signed-in, unlocked phone can wipe the
  record and set a new PIN. That was already true of the PIN itself (ADR-0015 §2:
  a guard rail, not a trust boundary), so this does not widen the threat; it
  removes the permanent lockout.
- **It costs the server lockout watermark.** `failed_attempts` and `locked_until`
  go with the record. That is precisely what ADR-0015 gave up ("a lockout record
  is evidence"), and the brake that replaces the live-lock check is a 24-hour
  cooldown keyed off `pin_updated_at` — a stamp only a real PIN change moves, so
  failed guesses cannot bring it forward.
- **The companion event does not prove the delete.** `admin_security_events` is
  refused `update`/`delete` so the trail is tamper-proof, but a rule evaluating a
  `create` has no pre-write `resource`, so it cannot bind the line to the record
  that was disposed of. The two are tied by the app writing them in one batch and
  by nothing else. An Admin could file a `PinReset` line without deleting
  anything — a noisy trail, not an escalation.

**Verification of this door is supplemental and partial.** `test:rules` executes
the rules under a Linux network namespace (`scripts/phase0/boundary.mjs`: *"no
weaker fallback is permitted"*), so it does not run on Windows or macOS at all. The
ADR-0016 cases were checked by driving `test/rules/engine.ts` directly — a pure
evaluator, no Firebase SDK and no network — but that is **not** the documented
suite and must not be reported as one. Two further gaps:

- **The emulator suite has no `admin_security` coverage at all**, so it has none
  for the new delete door either. That gap is ADR-0015's, not ADR-0016's: the
  collection was added with supplemental cases only and the canonical file was
  never extended. **The emulator has therefore never evaluated this rule.**
- **The fixture bug that sat next to these cases is fixed** (2026-10-21).
  `adminSecurityDoc()` in `test/rules/context.ts` supplied a 36-character
  `pin_hash` while `isAdminSecurityShape()` requires `size() >= 40`, so every
  `admin_security` case in the suite failed on an unmodified repository; the
  comment claimed 44. The fixture now pads to 44. The rotation case beside it
  was also passing vacuously — it wrote the same `pin_hash` and `pin_updated_at`
  back and expected a permission denial, which an *empty* diff grants; it now
  changes the salt as well, so the door is really exercised.

**An Admin locked out of Firebase is not helped by any of this.** The PIN gate
sits behind sign-in, so a forgotten *account password* is a different problem with
no answer in the app: `sendPasswordResetEmail` would fix it natively and free, but
it is a separate decision ([ADR-0016 § Consequences](#consequences)).

## The retired tracking module

`tracking_sessions` (ADR-0009) still denies read, create and update to every caller; the Admin keeps `delete` so a leftover session from before the withdrawal can be erased. It is **not** what live location uses today — see [Live location](#live-location) above and ADR-0013. Access logs and Booking timestamps are untouched.
