# Minimum advance booking — Hacienda de LuisAna

Hacienda de Luisiana requires Guests to create Bookings at least **30 calendar days before the intended check-in date**.

| Setting | Value |
| --- | --- |
| Minimum booking lead time | **30 calendar days** by default |
| Business timezone | **Asia/Manila** |
| Earliest guest check-in | Manila's today + the configured lead time |
| Enforcement | Frontend + authoritative Firestore booking-create validation |

On October 1, 2026 in Manila, October 30 is rejected and **October 31 is allowed**. This is a calendar-date comparison, not a requirement to leave exactly 720 elapsed hours. Browser timezone, submitted timestamps and claimed actor/source fields do not select the server's business date.

## Architecture inspected and preserved

The website (`src/`) is Guest-only; the Flutter app (`lib/`) is Admin-only (ADR-0007). There is no booking API/Cloud Function tier to insert a validator into. The authoritative backend write boundary is **Firestore Security Rules**.

The existing flow remains:

1. `/book`: stay/date/party/contact/terms validation and availability feedback.
2. Stay details saved as a session draft, not a Booking.
3. `/book/pay`: validate claimed amount and required screenshot, hold the claim against the figures the screenshot prints (ADR-0012), re-check availability, attach the existing Guest identity, upload proof through the existing Supabase/demo adapter.
4. `cloudBookingsDB.add`: proof gate, Pending/unverified payment, 24-hour Date hold, Firestore or labelled demo persistence, Submit Activity entry.
5. Admin review/approval, availability re-check, verification, stay progression, historical payment/resend flow and refunds are unchanged.

The lead-time constraint is additive. No Booking schema, status, payment reference/amount/OCR fields, proof path, storage policy, authentication flow, availability function or Flutter screen was replaced.

## One deployed configuration

Use the existing `site_config` collection, separate from `site_config/rates`:

```text
Document: site_config/booking
Field:    minimumBookingLeadTimeDays (positive integer)
Default:  30
```

For example, an authenticated Admin can write:

```json
{ "minimumBookingLeadTimeDays": 45 }
```

The native date minimum, error copy and server constraint then use 45; no booking logic needs to be rewritten. No new Admin settings UI is introduced. Guests cannot modify/delete the policy. Other Admin-owned settings/metadata on the document remain writable; only the new field is constrained. Deleting the document as Admin restores the default.

`MINIMUM_BOOKING_LEAD_TIME_DAYS` in the pure booking module is the client/demo default. The rules language cannot import TypeScript, so its single `defaultDays` fallback mirrors that constant; a regression test checks their parity. **The deployed Firestore document is authoritative**, not a Vite environment variable or browser/localStorage preference.

## Enforcement points

### Pure calculation and frontend

`src/lib/booking/leadTime.ts`, exported through the existing booking module, resolves today's date with `Intl.DateTimeFormat` explicitly set to **Asia/Manila**. It performs arithmetic on that calendar date in UTC and strictly validates `YYYY-MM-DD` without normalizing impossible dates.

`BookingPage` uses the computed date as the existing native check-in input's `min`; earlier days are visibly disabled by the browser. It shows the required notice and earliest date, checks the constraint on submission even though the form uses `noValidate`, and does not report room availability for a lead-time-invalid date. Existing check-out, stay-length, guest/contact and terms checks remain.

`useBookingPolicy` subscribes to the shared setting, refreshes at Manila midnight, and refreshes suspended tabs on focus/visibility changes. No browser-local midnight calculation is used.

### Before proof and booking writes

`DownpaymentPage.submit` checks the current policy/date **before** its existing validations/upload, and checks again after asynchronous availability/auth work immediately before uploading. A tampered or overnight-stale draft that is invalid at these checks creates no proof, Booking, payment or Activity record.

`cloudBookingsDB.add` repeats the constraint before its existing proof gate and before any Booking/Activity write, using a fresh clock rather than `actor.now`. Cloud preflights fetch the setting from the server, not an offline cache, and fail closed if that fetch fails.

A Firestore `permission-denied`/`unauthenticated` create is **not replayed as a local Booking**. This is necessary because trusted server time/policy can reject a stale or manipulated client preflight. A known boundary/policy error uses the clear domain message; other refusals use safe wording that includes the current minimum. The draft remains available. Non-policy infrastructure failures retain the existing labelled local fallback.

### Authoritative backend and Admin boundary

`firestore.rules` adds the constraint to the existing `bookings/{bookingId}` **create** permission, alongside all existing shape, Pending status and proof/payment gates. It parses the calendar date and compares it with:

```text
(request.time + UTC+08:00).date() + duration(configured lead time, days)
```

Asia/Manila has no daylight saving; shifting trusted server time **before** truncation gives Manila's calendar date. Neither `created_at`, a submitted minimum, `uid`, `source`, nor a claimed actor overrides this calculation.

Only `isAdmin()` resolved from the authenticated token/Profile can exempt a manual create. The public website's guest submission method does not grant an exemption based on its actor argument. No lead-time condition is added to update/read/delete or to Admin lifecycle actions; historical/previously created near-term Bookings remain reviewable, payable, cancellable and actionable. Guests still cannot edit Booking dates through the existing update whitelist.

### Storage integrity boundary — not a cross-store transaction

The existing Supabase bucket and Firestore are independent stores (ADR-0011). All tested invalid drafts/action calls are rejected before an upload/write, and a server-refused create leaves no Booking/payment/Activity record.

However, **a blanket zero-orphan-proof guarantee is not provided by this architecture**: an upload begun under a valid date/policy could finish after Manila midnight or a policy increase, after which booking creation is rejected. Direct anonymous writes to the existing Supabase bucket are also independent of Firestore. Preventing/cleaning these objects would require a trusted upload/cleanup workflow and a storage-policy change. This implementation intentionally preserves existing storage behavior rather than introducing a parallel booking system or silently changing proof retention/access.

## Verification (2026-10-01)

Before edits: **613 web tests and 193 offline rules tests passed**. The existing 44-test E2E scenario had two pre-existing failures: a stale proof-path assertion (missing the required upload attempt) and its downstream record-count assertion.

After implementation, run:

```bash
npm test
npm run test:rules
npm run test:e2e
npm run lint                     # repository lint script = tsc -b
npx tsc --noEmit -p tsconfig.test.json
npm run build
npm run test:emulator              # canonical Google rules runtime, Java 21+
flutter test                      # existing Admin tests, requires Flutter SDK
```

The additional strict test-source compilation was also run:

```bash
npx tsc --noEmit --strict --target ES2020 --module ESNext --moduleResolution bundler \
  --skipLibCheck --types vitest/globals --jsx react-jsx \
  src/vite-env.d.ts test/emulator/rules.emulator.test.ts \
  test/rules/booking-lead-time.rules.test.ts test/e2e/final-scenario.e2e.test.ts
```

For real-browser checks, follow the installation/run instructions at the top of `docs/qa/booking-lead-time-browser-test.mjs`. It refuses non-demo Firebase/Supabase deployments, pins October 1, 2026, and repeats the picker, injected form date, direct action, tampered payment draft and full day-30 flow in **America/Los_Angeles**, **Pacific/Kiritimati (UTC+14)** and **Asia/Manila**. OCR's external worker is deliberately offline; actual demo proof storage and the existing payment/booking modules run.

Results:

| Check | Result |
| --- | --- |
| Existing web tests + new unit/cloud/UI tests | PASS — 676 tests (613 existing + 63 new) |
| Offline rules suites | PASS — 236 tests (193 existing + 43 new) |
| Existing module/rules E2E scenario | PASS — 44 tests |
| New Playwright browser coverage | PASS — 15 checks across 3 browser timezones |
| App typecheck / repository lint (`tsc -b`) | PASS |
| Web-test typecheck (`tsconfig.test.json`) | PASS |
| Additional strict typecheck of rules/emulator/E2E test sources | PASS |
| Production build | PASS — existing large Firebase-chunk warning only |
| Canonical Firebase emulator suite | BLOCKED / NOT RUN — Java 21 was provisioned, but Google's emulator JAR host is unreachable; 25 new direct-SDK cases are written and typechecked, not emulator-verified |
| Flutter tests | NOT AVAILABLE — Flutter SDK is absent; no Dart code was changed |

New tests reject day 0/1/7/29, accept day 30/31/60, cover Manila midnight, UTC/date-line differences, leap/month/year transitions, malformed dates, configurable 45/60-day requirements, forged request fields, no-write refusals, midnight/policy changes between preflight and write, native min updates, guest/contact/payment/availability regressions, and authenticated Admin/legacy exemptions.

Existing assertions were retained. Creation fixtures now use lead-time-valid dates; the tutorial's day-30 fixture uses Manila rather than UTC. The existing E2E clock is pinned so its original stay dates remain valid, and its proof-path assertion now correctly checks the existing immutable `proof-1` contract. The supplemental evaluator gained only the v2 calendar/int/let constructs needed by the rules, with semantic tests; type-only harness fixes allow the additional strict check.

## Deployment and remaining verification

Deploy **both** the website and `firestore.rules` through the existing deployment workflow. For the configured Firebase project, the rules step is:

```bash
npx firebase deploy --only firestore:rules
```

**No production rules/data or Supabase policies were deployed/changed during this work.** A frontend-only deployment is not sufficient. Run `npm run test:emulator` where the Google JAR download is reachable before treating the rules as canonically emulator-verified. Flutter verification and the cross-store orphan-proof guarantee remain explicit limits, not reported successes.


## Files changed and why

| File | Purpose |
| --- | --- |
| `firestore.rules` | Trusted Manila/server-time guest-create guard, Admin exemption and Admin-only field validation for the shared policy. Existing Booking update/status/payment rules are unchanged. |
| `src/lib/booking/leadTime.ts` | Central default, calendar/timezone calculation, strict date check and domain result/error wording. |
| `src/lib/booking/index.ts` | Export the new policy helpers through the existing pure booking interface. |
| `src/lib/bookingPolicyDB.ts` | Read/subscribe to the existing `site_config` mechanism; server preflights do not use an offline policy cache. |
| `src/hooks/useBookingPolicy.ts` | Live policy and midnight/focus refresh for the date minimum. |
| `src/lib/validation.ts` | Use Manila's today in the existing stay/past-date validation; retain all other field/stay checks. |
| `src/lib/firestoreBookings.ts` | Validate the public creation path before writes and do not replay server security refusals into local Bookings. |
| `src/pages/BookingPage.tsx` | Native picker minimum, clear notice/error and lead-time validation before availability/draft progression. |
| `src/pages/DownpaymentPage.tsx` | Re-check the current policy/date before the existing payment checks and before proof upload. |
| `test/web/booking-lead-time.test.ts` | 41 pure-boundary/timezone/configuration/direct-local-creation cases. |
| `test/web/booking-lead-time-cloud.test.ts` | 9 cloud-adapter/config/refusal/no-local-fallback cases, including policy/midnight changes. |
| `test/web/booking-lead-time-ui.test.tsx` | 13 rendered picker/payment-flow/tampering/midnight and validation-regression cases. |
| `test/web/activity-log.test.ts` | Move only guest creation fixture dates into the valid future; retain all audit assertions. |
| `test/web/auth-authz.test.ts` | Move only guest creation fixture dates into the valid future; retain all role/action assertions. |
| `test/web/auth-firestore-rules.test.ts` | Assert the strengthened, still-Admin-only policy write permission. |
| `test/web/tutorial.test.tsx` | Use Manila calendar days for the existing tutorial's day-30 fixture. |
| `test/rules/booking-lead-time.rules.test.ts` | 36 supplemental executions of the actual rule text, including forged requests, timezone boundaries, configuration and Admin/legacy behavior. |
| `test/rules/context.ts` | Lead-time-valid default create fixture at the existing fixed rules request clock. |
| `test/rules/engine.ts` | Model the required v2 calendar/int/let primitives; type-only annotations/narrowing for strict compilation. It remains supplemental, not Google's runtime. |
| `test/rules/engine.test.ts` | Pin seven new primitive semantics; retain the fail-loud test using a still-unknown stdlib member. |
| `test/emulator/rules.emulator.test.ts` | 25 new canonical direct-SDK cases and lead-time-valid existing create fixtures; written/typechecked, blocked from execution by the JAR download. |
| `test/e2e/final-scenario.e2e.test.ts` | Pin its creation clock, correct the existing immutable proof-attempt assertion, and admit its existing composite verification label in the type. No assertions were deleted. |
| `docs/qa/booking-lead-time-browser-test.mjs` | New real-browser, three-timezone picker/tampering/full-flow coverage with demo-only safety checks. |
| `docs/qa/site-browser-test.mjs` | Keep existing future-date fixtures in Manila calendar days. |
| `docs/qa/tutorial-browser-test.mjs` | Keep existing tutorial day-30 fixtures in Manila calendar days. |
| `CONTEXT.md` | Document the domain rule, timezone, configuration and create-time/Admin boundary. |
| `docs/README.md` | Surface the requirement and link this policy/verification/deployment guide. |
| `docs/BOOKING_POLICY.md` | Policy, architecture, enforcement/configuration, verified results, file-by-file report and explicit remaining limits. |
