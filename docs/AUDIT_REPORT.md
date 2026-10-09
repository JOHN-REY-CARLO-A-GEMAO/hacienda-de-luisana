# Hacienda de LuisAna — Comprehensive Repository & IoT Readiness Audit Report

**Date:** October 2026
**Auditor:** Senior Software Architect, Full-Stack Engineer, Firebase Security Specialist, & IoT Systems Engineer
**Repository Baseline:** `hacienda-de-luisana`
**Architecture:** React Guest Web App (`src/`), Flutter Admin Mobile App (`lib/`), Firebase (Auth, Cloud Firestore, Realtime Database, Storage), Supabase Storage (`supabase/`).

---

## 1. Executive Summary

This comprehensive audit evaluates the **Hacienda de LuisAna** repository against the technical assessment requirements, business domain rules, security standards, and proposed IoT/smart-lock integrations.

### Key Architectural Baseline
The system adheres to a strict **Two-Role, Two-Application Architecture** ([ADR-0007](docs/adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)):
1. **Guest Website** (`src/`): Built with React 18, Vite, TypeScript, and Tailwind CSS. Deployed to Vercel and Firebase Hosting. Serves public visitors and registered guests (`/book`, `/account`, `/messages`, `/status`). Has no management or operational administration UI.
2. **Admin Mobile App** (`lib/`): Built with Flutter / Dart. Admin-only management suite (`dashboard`, `bookings`, `stays`, `analytics`, `smartlock`, `rooms`, `crm`, `rates`, `disputes`, `inbox`).
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
│   ├── models/               # Booking, SmartLockEvent, Review, Dispute, GuestCRM, Room models
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
| **11. Messaging Grouped by Conversation** | **Implemented** | `conversations/{id}/messages/{id}`, `src/pages/MessagesPage.tsx`, `lib/views/inbox/` | 1,000 character limit enforced in rules and UI (`MESSAGE_MAX`). Guest membership validation in `firestore.rules`. |
| **12. Biometric Authentication** | **Missing** | `lib/services/pin_store.dart` | Biometrics (Fingerprint/Face ID) not implemented (`local_auth` package not in `pubspec.yaml`). Security PIN sheet is used instead. |
| **13. Occupancy & Revenue Analytics** | **Implemented** | `lib/views/analytics/analytics_screen.dart` | Revenue breakdown, conversion rates, average length of stay, top accommodations rendered via FL Chart. |
| **14. Live Location & Proximity Alerts** | **Implemented** | `database.rules.json`, `src/lib/liveLocation.ts`, `lib/services/live_location_service.dart` | Realtime Database stream ([ADR-0013](docs/adr/0013-live-location-as-a-stream.md)), max 1h session, stream secret token. Proximity banner on Admin dashboard when guest < 5km away. No coordinates saved to Firestore ([ADR-0009](docs/adr/0009-no-live-location-tracking.md)). |
| **15. Disputes & Complaints** | **Implemented** | `disputes/{id}`, `src/components/DisputeForm.tsx`, `lib/services/dispute_service.dart` | Category, description (max 2000 chars), evidence URLs, status tracking (`open`, `under_review`, `resolved`, `rejected`). |
| **16. Guest Reviews & Moderation** | **Implemented** | `reviews/{bookingId}`, `public_reviews/{id}`, `src/pages/AccountPage.tsx`, `lib/views/reviews/` | 14-day guest edit window, 1-5 star categories, Admin moderation & response, curated public testimonials ([ADR-0014](docs/adr/0014-a-review-is-private-and-a-testimonial-is-a-separate-document.md)). |

---

## 4. Security & Reliability Findings Ranked by Severity

### Critical Severity (P0)

#### [P0-01] Double-Booking Approval Race Condition (F06)
- **Status / Behavior**: If two admin sessions or near-simultaneous client requests attempt to approve two pending bookings for the same accommodation unit and overlapping dates, both writes can succeed if executed outside a Firestore transaction.
- **Location**: `lib/services/booking_lifecycle.dart`, `src/lib/booking/actions.ts`.
- **Impact**: Operational failure, guest displacement, refund disputes, loss of revenue.
- **Recommended Fix**: Ensure all status transitions to `Approved` or `Reserved` execute inside a Firestore transaction (`runTransaction`) that re-queries existing committed bookings for date overlap before writing.

#### [P0-02] IoT Insecure Static RFID UID Assumption & Access Log Rule Flaw (F19, F20)
- **Status / Behavior**: The proposed smart-lock design assumes reading a static RFID card UID is sufficient for room unlock. Plain 125kHz or 13.56MHz RFID UIDs can be easily sniffed and cloned using handheld copiers or Flipper Zero devices. Furthermore, `firestore.rules` under `access_logs/{logId}` allows *any* signed-in user (including anonymous guest tokens) to create a row with `result: "granted"` under their own UID.
- **Location**: `docs/SMART_LOCK.md`, `firestore.rules` (lines 620–628), `lib/views/smartlock/smart_lock_screen.dart`.
- **Impact**: Physical break-in risk, unauthorized access, forged audit logs.
- **Recommended Fix**:
  1. Do not rely solely on static RFID UIDs; require encrypted dynamic payload verification (e.g., MIFARE DESFire AES authentication or HMAC-SHA256 tokens over NFC/BLE).
  2. Restrict `access_logs` creation in `firestore.rules` so that only verified hardware gateway accounts or admin UIDs can record `granted` events.

#### [P0-03] Supabase Storage Anonymous Upload Unbound Policy (F05)
- **Status / Behavior**: `supabase/01-storage.sql` permits anonymous upload of payment proof files into `payments/{uid}/...` without verifying that an active booking exists for that `uid`.
- **Location**: `supabase/01-storage.sql`, `src/lib/supabase.ts`.
- **Impact**: Storage exhaustion (DoS), unlinked file accumulation, potential submission of fake payment proofs.
- **Recommended Fix**: Enforce booking reference checks in Supabase Storage policies or process uploads through an authenticated Edge Function that validates booking ownership before storing files.

---

### High Severity (P1)

#### [P1-01] Unauthenticated Public Booking Creation Bypass Boundaries (F01, F02)
- **Status / Behavior**: Unauthenticated guests can create `Pending` bookings via `firestore.rules`. While standard 1-night stay pricing is strictly validated by `validAuthoritativeMoney`, multi-night or custom bookings constructed directly via Firestore client calls could create inconsistent state if rate rules fail to evaluate.
- **Location**: `firestore.rules` (`validGuestCreate`, `validAuthoritativeMoney`), `src/lib/booking/submit.ts`.
- **Impact**: Mismatched booking totals, corrupted financial snapshots.
- **Recommended Fix**: Re-verify all booking pricing snapshots on the Admin app during the `Approve` step before confirming dates.

#### [P1-02] Anonymous Identity Replacement on Guest Registration (F16)
- **Status / Behavior**: When an anonymous guest submits a booking and later registers or signs in with Google/Email, Firebase Auth assigns a new UID. The previous booking remains tied to the old anonymous UID, severing the guest's ownership view in `/account`.
- **Location**: `src/lib/auth/profile.ts`, `src/lib/guestAuth.ts`.
- **Impact**: Guest loses access to their booking timeline and payment status on `/account`.
- **Recommended Fix**: Link anonymous credentials to permanent accounts upon sign-up or re-assign booking ownership (`uid` field update) during account upgrading.

---

### Medium Severity (P2)

#### [P2-01] Live Location Stream Expiry Mismatch (F21)
- **Status / Behavior**: The web client transport (`src/lib/liveLocation.ts`) defaults to a 30-minute location lease, whereas Realtime Database rules (`database.rules.json`) enforce an `expires_at_ms` limit capped at 1 hour (`now + 3600000`).
- **Location**: `src/lib/liveLocation.ts`, `database.rules.json`.
- **Impact**: Discrepancies between UI countdown and database enforcement, causing premature stream disconnection.
- **Recommended Fix**: Align client lease duration constants strictly with Realtime Database rule limits.

#### [P2-02] Lack of Physical Hardware Sync & Offline Credential Revocation List
- **Status / Behavior**: No mechanism exists to push credential revocation commands to physical ESP32 devices when an Admin revokes access or cancels a booking.
- **Location**: `lib/services/booking_lifecycle.dart`, `docs/SMART_LOCK.md`.
- **Impact**: Revoked cards might still unlock doors if the smart lock is offline.
- **Recommended Fix**: Implement a local flash storage revocation blacklist on the ESP32 synchronized via MQTT / Realtime Database delta updates.

---

### Low Severity (P3)

#### [P3-01] Deprecated Flutter Method Calls
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
