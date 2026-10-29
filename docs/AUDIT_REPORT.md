# Hacienda de LuisAna — Comprehensive Repository & IoT Readiness Audit Report

**Date:** October 2026
**Auditor:** Senior Software Architect, Full-Stack Engineer, Firebase Security Specialist, & IoT Systems Engineer
**Repository Baseline:** `hacienda-de-luisana`
**Architecture:** React Guest Web App (`src/`), Flutter Admin Mobile App (`lib/`), Firebase (Auth, Cloud Firestore, Realtime Database, Storage), Supabase Storage (`supabase/`).
**Last reconciled:** 2026-10-30 against `main@0393a29`. Findings are left as written on the
day they were raised — the reconciliation section below is the only place a verdict is updated,
so the audit still reads as an audit and the corrections can be seen rather than inferred.

---

## 0. Reconciliation — what is still true, and what has been fixed since

This section was added on **2026-10-30**, after the findings below were re-checked against the
code at `main@0393a29`. Nothing above it was rewritten: a finding keeps the words it was raised
with, and its verdict lives here and in the `Status` line under its heading.

### Executed while reconciling

| Check | Result |
| --- | --- |
| `npm run lint` (`tsc -b`) | clean |
| `npm test` (vitest, jsdom) | **81 files / 1169 tests pass** |
| `npm run test:rules` (in-repo evaluator) | **330 / 330** (6 files) — supplemental, not emulator-verified |
| `npm run test:e2e` | **44 / 44** |
| `npm --prefix functions test` | **51 / 51** (after installing `functions/` deps) |
| `npm run build` | clean; 14 pages prerendered |
| `npm run test:safety` | 44 / 44 |
| `npm run test:invariants` | **18 fail / 13 pass** — all of them the pre-existing `DESIRED` set; none is a regression |
| `npm run test:emulator` | **not run** (no JVM in this environment) |
| `flutter test` / `flutter analyze` | **not run** — no Flutter SDK here, so §6's Dart numbers remain the auditor's and are re-stated as unverified |

### Finding-by-finding

| # | Finding | Status today | Evidence |
| --- | --- | --- | --- |
| P0-01 | Double-booking approval race | ✅ **Fixed** | every Admin Booking action runs in one `runTransaction` that re-reads every Booking for the same Accommodation inside it (`lib/services/firestore_service.dart:347`); a rival approval that commits first aborts and reruns. Rescheduling does the same (`:615`) |
| P0-02 | Forged `granted` Access-log rows | ✅ **Fixed** (rules half) | `firestore.rules:1326-1334`: `create` requires `isAdmin()` when `result == 'granted'`, and `uid == request.auth.uid` always; reads are Admin-only. The rule moved from the line the audit cited (620–628) when the file was reorganised |
| P0-02 | Static RFID UID is cloneable | ⚪ **Out of scope — no firmware exists** | there is no ESP32 code in this repository to harden; `docs/SMART_LOCK.md` carries the requirement (dynamic credential, not a static UID), and the Flutter screen is an Access-log viewer, not a lock |
| P0-03 | Supabase anonymous upload is unbound | ⛔ **Accepted by design, not a defect** | `supabase/01-storage.sql` argues it in its header: `anon` is insert-only under `payments/`, there is deliberately **no** `select` policy, and writing a file grants nobody anything — verification is the Admin's, in Firestore. Residual that is real: unlinked objects accumulate |
| P1-01 | Price rules could fail to evaluate | ✅ **Superseded in the document itself** | corrected in place on 2026-10-21 (ADR-0018/0019); `validAuthoritativeMoney` is gone and `quoteBooking` attests prices. **Activation is still off** — `site_config/booking.quotes_required` defaults absent and the functions are not deployed |
| P1-02 | Anonymous identity replaced on registration | 🔴 **Open, narrowed** | the Support page can link an anonymous session to Google or a password (`src/pages/SupportPage.tsx:29-30`), which preserves the uid. The **sign-up form does not link**, so a Guest who booked anonymously and then registered on `/guest/auth` still loses the Booking in `/account` |
| P2-01 | Live-location lease mismatch | ✅ **Fixed** | the Guest is offered 15/30/60 minutes and the rules cap at `now + 3600000` (`database.rules.json`); the two invariants (`F21 DESIRED`, `F21 LEASE`) pass |
| P2-02 | No revocation to offline locks | ⚪ **Out of scope — no firmware** | unchanged, and unchangeable from this repository |
| P3-01 | `withOpacity` deprecations | 🔴 **Open** | **39** occurrences in `lib/` today (the 61 was measured at a different commit). Mechanical, and only worth doing with a Flutter toolchain present to re-run `flutter test` |
| §3 #13 | "Analytics rendered via FL Chart" | ⚠️ **Stale claim, corrected below** | `fl_chart` is a declared dependency and is **imported nowhere**; the Analytics screen draws its bars by hand (`lib/views/analytics/analytics_screen.dart:236`, `_StayBar`) |

### Two things found while reconciling, neither fixed here

1. **The Access log is not append-only against the Admin.** `firestore.rules:1333` allows
   `update, delete: if isAdmin()`, and `CONTEXT.md` calls the Access log an *append-only record*.
   No screen deletes a row (`lib/views/smartlock/` has no delete path), so the permission is
   unused. Making it `allow update, delete: if false` is a two-line change — but it is a rules
   change, and rules changes are verified by the emulator suite, which has not run here. Do it
   after that run, not before a defence.
2. **Two numbers in this document were measured at an older commit** and drift: the
   `withOpacity` count (§ above) and the same claim appearing in `docs/README.md`'s dependency
   list, which describes `fl_chart` as used.

---

## 1. Executive Summary

This comprehensive audit evaluates the **Hacienda de LuisAna** repository against the technical assessment requirements, business domain rules, security standards, and proposed IoT/smart-lock integrations.

### Key Architectural Baseline
The system adheres to a strict **Two-Role, Two-Application Architecture** ([ADR-0007](docs/adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)):
1. **Guest Website** (`src/`): Built with React 18, Vite, TypeScript, and Tailwind CSS. Deployed to Vercel and Firebase Hosting. Serves public visitors and registered guests (`/book`, `/account`, `/messages`, `/status`). Has no management or operational administration UI.
2. **Admin Mobile App** (`lib/`): Built with Flutter / Dart. Admin-only management suite (`dashboard`, `bookings`, `stays`, `analytics`, `smartlock`, `rooms`, `crm`, `rates`, `inbox`).
3. **Roles & Authority**: Exactly two roles exist: `guest` and `admin` ([ADR-0005](docs/adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md)). There is no Staff, Host, or Cleaner role. Role assignment is enforced at the database level via `firestore.rules` and `storage.rules`.

### Audit Findings Summary
- **Core Booking & Financial Security**: Strong mathematical invariants and strict verification guards exist in `firestore.rules`. Booking creates require standard 22-hour stays, minimum 30-day lead time ([BOOKING_POLICY.md](docs/BOOKING_POLICY.md)), and strict downpayment calculations. Admin verification enforces payment verification markers (`amount_verified`, `payment_verified_at`, `payment_verified_by`).
- **IoT & Hardware Readiness**: **NO physical ESP32 firmware, C++/Arduino code, or hardware drivers exist in the repository.** The "Smart Lock" feature in the Flutter app (`lib/views/smartlock/smart_lock_screen.dart`) is purely an in-app audit log viewer and simulated event generator writing to the `access_logs` Firestore collection.
- **Critical Security Risks**:
  - **Double-Booking Race Condition (F06)**: Concurrent approvals on single-capacity accommodation units (e.g., Main House, Annex) can create overlapping approved bookings if not handled inside Firestore transactions.
  - **Insecure Static RFID UID Assumption**: Plain RFID UID reading is inherently insecure against cloning (e.g., via Flipper Zero). Static UIDs must not be trusted as sole unlock credentials without cryptographic challenge-response or dynamic tokens.
  - **Supabase Storage Anonymous Upload Gap (F05)**: Anonymous guests can upload arbitrary files to Supabase Storage `payments/{uid}/` paths without binding to an active Firestore booking reference.

---

## 2. Verified Architecture & Repository Inventory

```
hacienda-de-luisana/
├── src/                      # Guest React Web App (Vite + TypeScript + Tailwind)
│   ├── pages/                # Landing, Booking, Account, Messages, Rates, HouseRules, Status
│   ├── lib/                  # Booking lifecycle (actions, availability, rates, money, holds)
│   ├── context/              # AuthContext (Guest authentication session)
│   └── tutorial/             # Guest interactive guided tour engine
├── lib/                      # Admin Flutter Mobile App (Dart)
│   ├── main.dart             # App entry, theme, routes
│   ├── models/               # Booking, SmartLockEvent, Review, GuestCRM, Room models
│   ├── services/             # Pure Dart lifecycle (booking_lifecycle.dart), Firestore, PIN Store
│   ├── views/                # Dashboard, Bookings, Stays, Analytics, SmartLock, Rooms, CRM, Rates
│   └── tutorial/             # Admin interactive guided tour
├── firestore.rules           # Cloud Firestore Security Rules (Security enforcement layer)
├── storage.rules             # Firebase Storage Security Rules
├── database.rules.json       # Realtime Database Rules (Live Location stream)
├── supabase/                 # Supabase Storage RLS policies & Edge Functions
└── docs/                     # Architecture Decision Records (ADRs 0001-0016), setup guides
```

### Verified Build & Execution Status
- **Flutter Test Suite**: Executed 228 unit and widget tests across 12 test files (`test/*_test.dart`). **100% Pass Rate** (`+228 -0`).
- **Flutter Analysis**: Executed `flutter analyze`. 65 lints found (0 errors, 4 warnings, 61 informational deprecation warnings for `withOpacity`).
- **Web & Rules Test Harness**: Synthetically verified via Vitest offline harness (`test/web/`, `test/rules/`, `test/phase0/`).

---

## 3. Feature-by-Feature Implementation Matrix

| Domain / Feature | Status | Repository Evidence / Implementation File | Audit Notes & Gaps |
|---|---|---|---|
| **1. Booking Lifecycle & Date Validation** | **Implemented** | `src/lib/booking/validation.ts`, `lib/services/booking_lifecycle.dart`, `firestore.rules` | 11 canonical statuses. Minimum 30-day lead time enforced in `firestore.rules` (`meetsMinimumBookingLeadTime`) and UI (`src/lib/booking/leadTime.ts`). 24-hour date hold expiry. |
| **2. Payment Verification & Downpayment** | **Implemented** | `src/lib/booking/money.ts`, `lib/services/payment_proof_service.dart`, `firestore.rules` | 50/50 downpayment split. `validAuthoritativeMoney` enforces stay totals. Proof required before `Pending` status ([ADR-0012](docs/adr/0012-downpayment-proof-before-pending.md)). |
| **3. RFID Card Assignment & Expiration** | **Missing** | `lib/models/smart_lock_event_model.dart` | No database schema or UI exists to assign an RFID UID to a guest/booking or set card expiration timestamps. |
| **4. ESP32 Firmware & Hardware Actuation** | **Missing** | N/A (No firmware files in repo) | No C++/Arduino firmware, no hardware driver, no MQTT/HTTP hardware gateway. Hardware integration is strictly simulated. |
| **5. Offline Smart Lock Access** | **Missing** | N/A | No local flash storage cache, offline sync engine, or local challenge-response logic for ESP32. |
| **6. Cleaner RFID Workflows & Housekeeping** | **Missing** | `lib/views/rooms/rooms_screen.dart` | No Cleaner role exists ([ADR-0007](docs/adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)). `rooms` screen is an operational status register for Admins (`available`, `occupied`, `maintenance`). |
| **7. Admin Security & PIN Gate** | **Implemented** | `lib/services/pin_store.dart`, `lib/views/security/pin_gate_screen.dart`, `firestore.rules` | Security PIN gate with PBKDF2-SHA256, lockout ladder (5 fails → 30s delay up to 5 min cap), server ratchet in `admin_security/{uid}`, and 24h reset cooldown ([ADR-0016](docs/adr/0016-a-forgotten-security-pin-is-reset-by-disposing-of-the-record.md)). |
| **8. Access Logs & Security Monitoring** | **Implemented (Simulated)** | `lib/views/smartlock/smart_lock_screen.dart`, `firestore.rules` | Reads/writes `access_logs` collection (`timestamp`, `uid`, `ref_id`, `result`, `reason`). App provides an RFID swipe simulator. |
| **9. Accommodation Rates & Cancellation Policy** | **Implemented** | `site_config/rates`, `lib/views/rates/rates_screen.dart`, `src/lib/booking/rates.ts` | Configurable weekday/weekend pricing schedules, holiday dates, pet fees, late checkout fees, and tiered cancellation refund rules. |
| **10. Payment Reference Search** | **Implemented** | `payment_references` collection, `lib/views/payments/` | Ref search by code, status tracking (`available`, `used`, `void`), enforced in `firestore.rules`. |
| **11. Messaging Grouped by Conversation** | **Implemented** | `conversations/{id}/messages/{id}`, `messageAttachments/{conversationId}/{messageId}`, `src/pages/MessagesPage.tsx`, `lib/views/inbox/` | Optional captions and private JPEG/PNG/WebP images up to 5 MiB. Membership, exact path binding, MIME and size limits are enforced in Firestore/Storage rules. |
| **12. Biometric Authentication** | **Missing** | `lib/services/pin_store.dart` | Biometrics (Fingerprint/Face ID) not implemented (`local_auth` package not in `pubspec.yaml`). Security PIN sheet is used instead. |
| **13. Occupancy & Revenue Analytics** | **Implemented** | `lib/views/analytics/analytics_screen.dart` | Revenue breakdown, conversion rates, average length of stay, top accommodations. **Corrected 2026-10-30:** not FL Chart — `fl_chart` is declared in `pubspec.yaml` and imported nowhere; the bars are hand-drawn (`lib/views/analytics/analytics_screen.dart:236`). |
| **14. Live Location & Proximity Alerts** | **Implemented** | `database.rules.json`, `src/lib/liveLocation.ts`, `lib/services/live_location_service.dart` | Realtime Database stream ([ADR-0013](docs/adr/0013-live-location-as-a-stream.md)), max 1h session, stream secret token. Proximity banner on Admin dashboard when guest < 5km away. No coordinates saved to Firestore ([ADR-0009](docs/adr/0009-no-live-location-tracking.md)). |
| **15. Disputes & Complaints** | **Retired 2026-10-24** | `docs/adr/0020-retire-dispute-cases-for-private-message-images.md` | Active case management was replaced by ordinary private message images. Historical data is retained under default-deny rules pending separately approved archival/deletion. |
| **16. Guest Reviews & Moderation** | **Implemented** | `reviews/{bookingId}`, `public_reviews/{id}`, `src/pages/AccountPage.tsx`, `lib/views/reviews/` | 14-day guest edit window, 1-5 star categories, Admin moderation & response, curated public testimonials ([ADR-0014](docs/adr/0014-a-review-is-private-and-a-testimonial-is-a-separate-document.md)). |

---

## 4. Security & Reliability Findings Ranked by Severity

### Critical Severity (P0)

#### [P0-01] Double-Booking Approval Race Condition (F06)
**Status (2026-10-30): ✅ Fixed.** The recommendation below was implemented: approval re-reads and re-checks inside a Firestore transaction (`lib/services/firestore_service.dart:347`). One caveat on the *word* fixed: the `F06 DESIRED` invariant in `npm run test:invariants` still fails, because that probe exercises the pure lifecycle function against a stale list — the transaction is what serialises approval, not the pure function.

- **Status / Behavior**: If two admin sessions or near-simultaneous client requests attempt to approve two pending bookings for the same accommodation unit and overlapping dates, both writes can succeed if executed outside a Firestore transaction.
- **Location**: `lib/services/booking_lifecycle.dart`, `src/lib/booking/actions.ts`.
- **Impact**: Operational failure, guest displacement, refund disputes, loss of revenue.
- **Recommended Fix**: Ensure all status transitions to `Approved` or `Reserved` execute inside a Firestore transaction (`runTransaction`) that re-queries existing committed bookings for date overlap before writing.

#### [P0-02] IoT Insecure Static RFID UID Assumption & Access Log Rule Flaw (F19, F20)
**Status (2026-10-30): ✅ rules half fixed; ⚪ cloning half out of scope.** Recommended fix 2 is in `firestore.rules:1326-1334` (a `granted` row needs `isAdmin()`, and a row always names its own writer). Recommended fix 1 has nothing to attach to: there is no firmware in this repository, so the requirement is recorded in `docs/SMART_LOCK.md` rather than implemented.

- **Status / Behavior**: The proposed smart-lock design assumes reading a static RFID card UID is sufficient for room unlock. Plain 125kHz or 13.56MHz RFID UIDs can be easily sniffed and cloned using handheld copiers or Flipper Zero devices. Furthermore, `firestore.rules` under `access_logs/{logId}` allows *any* signed-in user (including anonymous guest tokens) to create a row with `result: "granted"` under their own UID.
- **Location**: `docs/SMART_LOCK.md`, `firestore.rules` (lines 620–628), `lib/views/smartlock/smart_lock_screen.dart`.
- **Impact**: Physical break-in risk, unauthorized access, forged audit logs.
- **Recommended Fix**:
  1. Do not rely solely on static RFID UIDs; require encrypted dynamic payload verification (e.g., MIFARE DESFire AES authentication or HMAC-SHA256 tokens over NFC/BLE).
  2. Restrict `access_logs` creation in `firestore.rules` so that only verified hardware gateway accounts or admin UIDs can record `granted` events.

#### [P0-03] Supabase Storage Anonymous Upload Unbound Policy (F05)
**Status (2026-10-30): ⛔ Accepted by design.** The asymmetry is deliberate and argued in `supabase/01-storage.sql` — anonymous insert, no anonymous read, and a write that grants nobody anything. The storage-exhaustion part of the impact is real and unfixed; the bucket has a 5 MB per-object ceiling but no per-caller quota, and quotas would need a signed-in caller the Guest flow does not have.

- **Status / Behavior**: `supabase/01-storage.sql` permits anonymous upload of payment proof files into `payments/{uid}/...` without verifying that an active booking exists for that `uid`.
- **Location**: `supabase/01-storage.sql`, `src/lib/supabase.ts`.
- **Impact**: Storage exhaustion (DoS), unlinked file accumulation, potential submission of fake payment proofs.
- **Recommended Fix**: Enforce booking reference checks in Supabase Storage policies or process uploads through an authenticated Edge Function that validates booking ownership before storing files.

---

### High Severity (P1)

#### [P1-01] Unauthenticated Public Booking Creation Bypass Boundaries (F01, F02)
- **Status / Behavior**: Unauthenticated guests can create `Pending` bookings via `firestore.rules`. While standard 1-night stay pricing is strictly validated by `validAuthoritativeMoney`, multi-night or custom bookings constructed directly via Firestore client calls could create inconsistent state if rate rules fail to evaluate.
- **Location**: `firestore.rules` (`validGuestCreate`, `validAuthoritativeMoney`), `src/lib/booking/submit.ts`.
- **Correction, 2026-10-21**: this finding's conditional — "if rate rules fail to
  evaluate" — is what actually happened. On 2026-10-14 the derivation crossed
  Firestore's 1,000-expression budget, every evaluation became an error reported as
  `permission-denied`, and no Guest booking could be created at all. The derivation
  is gone, `validAuthoritativeMoney` and its helpers are deleted, and what the rule
  layer does and does not decide is now written down in
  [ADR-0018](./adr/0018-the-rule-layer-checks-coherence-not-price-and-the-gap-that-opens.md).
  `src/lib/booking/submit.ts` is now `src/lib/firestoreBookings.ts`.
- **Impact**: Mismatched booking totals, corrupted financial snapshots.
- **Recommended Fix**: Re-verify all booking pricing snapshots on the Admin app during the `Approve` step before confirming dates.

#### [P1-02] Anonymous Identity Replacement on Guest Registration (F16)
**Status (2026-10-30): 🔴 Open.** Narrowed, not closed: `src/pages/SupportPage.tsx:29-30` links an anonymous session to a real credential, which keeps the uid and therefore the Booking. The sign-up form still creates a fresh identity without linking, so the finding survives for that path.

- **Status / Behavior**: When an anonymous guest submits a booking and later registers or signs in with Google/Email, Firebase Auth assigns a new UID. The previous booking remains tied to the old anonymous UID, severing the guest's ownership view in `/account`.
- **Location**: `src/lib/auth/profile.ts`, `src/lib/guestAuth.ts`.
- **Impact**: Guest loses access to their booking timeline and payment status on `/account`.
- **Recommended Fix**: Link anonymous credentials to permanent accounts upon sign-up or re-assign booking ownership (`uid` field update) during account upgrading.

---

### Medium Severity (P2)

#### [P2-01] Live Location Stream Expiry Mismatch (F21)
**Status (2026-10-30): ✅ Fixed.** The client no longer defaults to a lease the rules would refuse: it offers 15/30/60 minutes against a `now + 3600000` ceiling, and both invariants (`F21 DESIRED`, `F21 LEASE`) pass in `npm run test:invariants`.

- **Status / Behavior**: The web client transport (`src/lib/liveLocation.ts`) defaults to a 30-minute location lease, whereas Realtime Database rules (`database.rules.json`) enforce an `expires_at_ms` limit capped at 1 hour (`now + 3600000`).
- **Location**: `src/lib/liveLocation.ts`, `database.rules.json`.
- **Impact**: Discrepancies between UI countdown and database enforcement, causing premature stream disconnection.
- **Recommended Fix**: Align client lease duration constants strictly with Realtime Database rule limits.

#### [P2-02] Lack of Physical Hardware Sync & Offline Credential Revocation List
**Status (2026-10-30): ⚪ Out of scope.** Nothing in this repository can push a revocation to a device that this repository does not program. Unchanged.

- **Status / Behavior**: No mechanism exists to push credential revocation commands to physical ESP32 devices when an Admin revokes access or cancels a booking.
- **Location**: `lib/services/booking_lifecycle.dart`, `docs/SMART_LOCK.md`.
- **Impact**: Revoked cards might still unlock doors if the smart lock is offline.
- **Recommended Fix**: Implement a local flash storage revocation blacklist on the ESP32 synchronized via MQTT / Realtime Database delta updates.

---

### Low Severity (P3)

#### [P3-01] Deprecated Flutter Method Calls
**Status (2026-10-30): 🔴 Open — 39 occurrences**, not 61, measured on `lib/` at this commit. Still mechanical, still worth doing only where `flutter analyze` can be re-run to prove nothing broke.

- **Status / Behavior**: 61 occurrences of `withOpacity(...)` in Flutter UI components trigger deprecation warnings in Flutter SDK 3.27+.
- **Location**: `lib/views/`, `lib/widgets/`, `lib/tutorial/`.
- **Impact**: Potential future SDK breakage upon Flutter upgrade.
- **Recommended Fix**: Replace `.withOpacity(val)` with `.withValues(alpha: val)`.

---

## 5. NotebookLM Recommendation Validation

The original NotebookLM report recommendations were evaluated against the codebase reality:

| Proposal / Recommendation | Validation Result | Architectural Reality & Explanation |
|---|---|---|
| **1. "Use RFID Card UID for Instant Lock Unlocking"** | **INCORRECT / INSECURE** | Static RFID UIDs (e.g. EM4100 or MIFARE CSN) can be cloned in seconds using handheld copiers or Flipper Zero. Relying solely on UID reading without mutual cryptographic challenge-response exposes guest rooms to physical security bypass. |
| **2. "Store Room Capacity and Price Per Night in `rooms/{id}`"** | **INCORRECT** | Direct violation of repository design decision ([ADR-0007](docs/adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md), F29). `rooms/{id}` is strictly a status register (`available`, `occupied`, `maintenance`). Capacity and pricing live authoritatively in `site_config/rates` and are enforced by `firestore.rules`. |
| **3. "Implement Continuous Background GPS Tracking for Guests"** | **INCORRECT / PRIVACY RISK** | Continuous background tracking was explicitly evaluated and **removed** in [ADR-0009](docs/adr/0009-no-live-location-tracking.md) due to legal liabilities and privacy intrusion. Replaced by [ADR-0013](docs/adr/0013-live-location-as-a-stream.md): an opt-in, ephemeral Realtime Database live stream with max 1-hour session duration and explicit guest consent. |
| **4. "Add a Staff / Cleaner Role to the App"** | **INCORRECT** | Contradicts two-role architecture ([ADR-0005](docs/adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md), [ADR-0007](docs/adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)). There is no Staff or Host role in the system. The Admin performs all operational tasks directly from the Flutter app. |
| **5. "Store Payment Proof Images directly in Firestore"** | **INCORRECT** | Storing base64 image strings in Firestore bloats document size, increases read costs, and hits document size caps (1MB). Payment proofs belong in Supabase Storage or Firebase Storage (`storage.rules`), with only URLs and OCR metadata recorded in Firestore. |

---

## 6. Test Results & Reproducible Defects

### Verified Execution Results
1. **Flutter Unit & Widget Test Suite**:
   - Command: `flutter test`
   - Results: **228 Passed, 0 Failed** across 12 test files (`booking_lifecycle_test.dart`, `published_rates_test.dart`, `pin_policy_test.dart`, `security_gate_test.dart`, `review_policy_test.dart`, `canonical_accommodations_test.dart`, `tutorial_controller_test.dart`, `validators_age_test.dart`, `booking_model_test.dart`, `pin_gate_screen_test.dart`, `pin_layout_test.dart`, `pin_sheet_widget_test.dart`).
2. **Flutter Static Analysis**:
   - Command: `flutter analyze`
   - Results: 65 lints (0 errors, 4 warnings for unused fields/imports, 61 informational deprecation warnings).
3. **Web & Firestore Security Rule Characterization Harness**:
   - Web unit tests, rules mirror, and Phase 0 characterization tests pass in hermetic test mode.

> **Re-stated 2026-10-30.** Items 1–2 above are the auditor's run on a machine with the Flutter
> SDK; they have **not** been reproduced since, because the environment this reconciliation ran in
> has no Flutter toolchain and the repository ships no APK. Treat them as reported, not verified.
> Item 3 was re-run and now has numbers: **1169 web tests**, **330 rules assertions**, **44
> end-to-end steps**, **51 callable tests**, clean `tsc -b` and a clean `npm run build`. The
> `DESIRED` invariants remain **18 failed / 13 passed**, unchanged from the baseline this document
> was written against — those are the audit's own open findings, not new breakage.

---

## 7. Prioritized Remediation Roadmap

```
                    +---------------------------------------+
                    |  P0: Critical Security & Integrity    |
                    |  - Double-booking transaction fix     |
                    |  - Secure IoT credential architecture |
                    |  - Supabase Storage RLS lockdown      |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |  P1: Booking Lifecycle & Identity     |
                    |  - Anonymous UID re-binding on sign-up|
                    |  - Atomic Activity log batch writes   |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |  P2: IoT & ESP32 Hardware Integration |
                    |  - ESP32 C++ firmware development     |
                    |  - Encrypted credential sync engine   |
                    |  - Offline flash revocation cache     |
                    +-------------------+-------------------+
                                        |
                                        v
                    +---------------------------------------+
                    |  P3: Admin UX, Lints & Polish         |
                    |  - Flutter withValues migration       |
                    |  - Local biometrics integration       |
                    +---------------------------------------+
```

### Phase P0 (Critical Security & Core Integrity)
- **P0-1**: Wrap all Admin booking approval actions in Firestore transactions to prevent double-booking race conditions (**Large**, Dependencies: `lib/services/booking_lifecycle.dart`).
- **P0-2**: Lock down `access_logs` Firestore security rules so that guests cannot write `granted` events (**Small**, Dependencies: `firestore.rules`).
- **P0-3**: Update Supabase Storage RLS policies to require authenticated user bindings (**Small**, Dependencies: `supabase/01-storage.sql`).

### Phase P1 (Reliable Booking Lifecycle & Identity)
- **P1-1**: Re-bind anonymous booking ownership when a guest registers an account on the web app (**Medium**, Dependencies: `src/lib/auth/profile.ts`).
- **P1-2**: Align client live location stream lease duration constants with RTDB rules (**Small**, Dependencies: `src/lib/liveLocation.ts`).

### Phase P2 (IoT Architecture & Smart Lock Integration)
- **P2-1**: Develop production ESP32 firmware supporting Wi-Fi/MQTT, TLS security, and AES-128/HMAC credential verification (**Large**, Dependencies: ESP32 Hardware, `docs/SMART_LOCK.md`).
- **P2-2**: Build Firestore `credentials/{id}` collection for mapping active booking references to encrypted keycards (**Medium**, Dependencies: `firestore.rules`).
- **P2-3**: Build offline sync engine on ESP32 using SPIFFS/LittleFS for storing local credential caches (**Large**, Dependencies: ESP32 Firmware).

### Phase P3 (Admin UX, Analytics & Polish)
- **P3-1**: Update deprecated Flutter `withOpacity` calls to `.withValues(alpha: ...)` (**Small**, Dependencies: `lib/views/`).
- **P3-2**: Integrate `local_auth` package for optional biometric unlocking on Admin mobile app (**Medium**, Dependencies: `pubspec.yaml`, `lib/services/pin_store.dart`).

---

## 8. Unresolved Questions for Property Owner, Developers, & Hardware Team

1. **Physical Smart Lock Hardware Specifications**: What specific microcontroller (e.g., ESP32-S3, ESP32-WROOM-32), RFID/NFC module (e.g., PN532, RC522), and locking mechanism (solenoid, magnetic lock, motor deadbolt) are intended for physical installation?
2. **Network Topology & Offline Resilience**: Will the smart lock hardware at the hacienda have access to stable, uninterrupted Wi-Fi/Internet, or must offline local network / BLE operation be the primary mode?
3. **Automated Payment Gateway Integration**: Is manual GCash / bank transfer receipt verification intended to remain permanent, or is an automated payment gateway (e.g., PayMongo, Xendit webhooks) planned for future phases?
4. **Hardware Provisioning & Pairing Workflow**: How should initial ESP32 smart lock devices be provisioned and paired with specific accommodation units (Main House, Annex, A-House) by the Admin?
