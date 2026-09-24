# PROPERTY MANAGEMENT, SMART LOCK (RFID + MOBILE KEY / ESP32) & TRACKING SYSTEM
### Corrected Flow Chart Spec v3.0 — fixes: refund hole, dangling ENDs, double-booking race, missing KYC, tracking consent, offline/tamper handling; v2.1 added the implementation status (§12); **v3.0 collapses the actors to two roles — Customer (Guest) on the website, Admin on the mobile app — and removes Staff and Super Admin (ADR-0007)**

> Paste-ready textual spec, same structure as the original export.
> **Global Conventions (render as a legend/annotation box):**
>
> - **G1 — No dangling ENDs.** Every terminal path must: (1) set a final booking status, (2) release held dates (if any), (3) notify the customer, (4) write to the Activity Log.
> - **G2 — Availability is enforced by the system, not the eyeball.** Date-overlap is re-checked by the database at submit **and** at approval — not only at search.
> - **G3 — Money last.** The booking is *approved before* payment is collected. Verified money is only ever touched via the Refund pipeline.
> - **G4 — 24h TTL.** Any booking sitting in a pending stage for 24h auto-expires: `EXPIRED` → release dates → notify customer.
> - **G5 — One credential pipeline.** Credential = RFID card **or** in-app Mobile Key (BLE). Same verification checklist for both.
> - **G6 — Tracking is consent-based.** No consent = no GPS tracking (access logs only). Location history auto-purges N days after check-out (Data Privacy Act / RA 10173).
> - **G7 — Every state change** saves to Central DB with timestamp + Updated By (Booking Tracking / Activity Log).
> - **G8 — Two roles, two apps.** Customer = the **Website**; Admin = the **Mobile App**. There is no Staff role and no Super Admin: every operator action in this chart is the Admin's, done in the mobile app. Access control is between the two roles only, never among operators.

---

## 1. Initial Authentication & Role Routing

1. START → Open the **Website** (Customer) or the **Mobile App** (Admin) — G8
2. **Website:** Input: Register or Login
   - Register → Role = **CUSTOMER** (the only role a sign-up can create) → Account = ACTIVE
   - Login as Customer → Customer Dashboard (`/account`)
   - Login with an Admin account → Website says: "This website is for Guests — the Admin uses the mobile app" → END (website has no Admin screens)
3. **Mobile App:** Input: Login (Google or email + password)
   - Decision: Is this account the Admin? *(bootstrap allowlist **or** `profiles/{uid}.role == 'admin'`)*
     - [No] → Signed out → Notify: "Not authorized — Guests book on the website" → END
     - [Yes] → Admin Dashboard
4. Roles in the whole system: **CUSTOMER** and **ADMIN**. No Staff, no Super Admin, no role hierarchy among operators.

---

## 2. Customer / User Module Flow  *(reordered: approve first, pay after — kills the refund hole)*

1. Customer Dashboard → View Properties
2. Decision: Property Available? *(system date-overlap check)*
   - [No] → Return to Search → View Properties
   - [Yes] → Input: Select Check-in, Check-out, and Guests
3. Decision: Dates valid & Guests ≤ Capacity?
   - [No] → Notify Customer: adjust dates/guests → back to Input
   - [Yes] → Submit Booking
4. Sets Booking = **PENDING** → System places **24h TTL hold** on dates (G4) → Save to Central DB → Notify Admin (mobile app): "New booking for review"
5. Upload Valid Government ID (KYC) → Sets KYC = **SUBMITTED** → Save to Central DB
6. **Booking Review** (Admin, in the mobile app):
   - 6a. System auto re-check: dates still free? (G2)
     - [No] → Suggest Alternative Dates → Notify Customer
       - Decision: Customer rebooks?
         - [Yes] → back to Input (step 2)
         - [No] → Sets Booking = **REJECTED** → Release Dates → Notify Customer → END
   - 6b. Decision: ID Valid?
     - [No] → Notify Customer: re-upload ID → Decision: Resubmit?
       - [Yes] → back to Upload ID (step 5, within TTL)
       - [No] → Sets Booking = **REJECTED** → Release Dates → Notify Customer → END
     - [Yes] → Sets Booking = **APPROVED** (dates firmly held) → Notify Customer: "Proceed to payment"
7. Decision: Payment Option?
   - [50% Down Payment + Refundable Security Deposit] or [Full Payment + Refundable Security Deposit]
   - → Upload Payment Proof → Sets Payment = **PENDING**
8. Admin Verifies Payment (mobile app)
9. Decision: Payment Valid?
   - [No] → Reject Payment → Notify Customer → Decision: Resubmit Proof?
     - [Yes] → Loop back to Upload Payment Proof
     - [No] → Sets Booking = **CANCELLED** → Release Dates → Notify Customer → END *(no verified money yet — nothing to refund)*
   - [Yes] → Sets Payment = **VERIFIED** → Sets Booking = **RESERVED** → Save to Central DB → Notify Customer: "Reservation confirmed"
10. Create Booking Tracking Record (→ Booking Tracking & Central DB)
11. **Customer Cancellation branches** (available anytime from the dashboard):
    - Cancel while PENDING/APPROVED (nothing verified) → Sets Booking = **CANCELLED** → Release Dates → Notify Admin → END
    - Cancel while RESERVED (money verified) → Sets Booking = **CANCELLED** → Release Dates → **Refund Initiated** (settled by the Published rates' cancellation policy stamped on the Booking: refund tier by days before check-in, deposit percentage, verified damage deduction) → Admin returns the money → Admin marks **REFUNDED** → Notify Customer → END
12. TTL Expiry (any pending stage, 24h — G4): → Sets Booking = **EXPIRED** → Release Dates → Notify Customer & Admin → END
13. Assign Credential → proceed to CHECK-IN (Module 3)

---

## 3. RFID / Mobile Key Smart Lock + ESP32 Module Flow

1. CHECK-IN (from Check-in time, e.g. 2:00 PM) → Customer presents **RFID Card/Tag** *or* taps **Mobile Key** in app (G5)
2. RFID Reader scans UID / ESP32 receives signed Mobile Key token
3. Send Credential to System (Logs to Central DB)
   - *Offline mode:* verify against cached credential list on ESP32 → buffer access logs → sync to Central DB when back online
4. Decision: Verify Credential + Customer + Booking + Property + Payment + Account + Dates + Credential Status
   - [No] → Deny Access → Save Failed Access Log
     - Decision: ≥3 failures within 10 minutes?
       - [Yes] → Alert Admin → 15-minute lockout cooldown → END ACCESS
       - [No] → END ACCESS
   - [Yes] → ESP32 Unlocks Door
5. Save Successful Access Log
6. **First successful unlock on check-in day → Sets Booking = CHECKED-IN** *(defined trigger — separates CHECKED-IN from STAYING)* → Notify Admin: "Guest has arrived"
7. Sets Booking = **STAYING**
8. Start Authorized Location Tracking → Module 4
9. Customer Stay Begins

---

## 4. Guest Location Tracking Module Flow *(consent-gated)*

1. Decision: Guest consented to Location Tracking? *(consent screen with Data Privacy notice, shown at booking/check-in)*
   - [No] → Tracking = **DISABLED** (RFID/access logs only) → skip to step 7
   - [Yes] → Tracking = ENABLED (during stay only)
2. Customer Stay → Get Guest Location
3. Input / Record: Province, City/Municipality, GPS, Accuracy, Date/Time
4. Save Location History (Central DB, encrypted at rest)
5. Admin views the authorized location on the mobile app's Radar (Admin-only; read by rule)
6. Decision: Guest Still Staying?
   - [Yes] → Loop back to Get Guest Location
   - [No] → Proceed to CHECK-OUT
7. Stop Location Tracking → Save Final Location
8. **Retention rule (as built, §12):** the session forgets itself — a session not updated for 30 days reads as nonexistent (read-time expiry, no backend worker), and the Guest's own delete (stop sharing) is the physical erasure (G6)
9. Disable Guest Credential (RFID + Mobile Key)

---

## 5. Check-out, Damage, Cleaning & Inspection Flow

1. CHECK-OUT (e.g. 12:00 NN) → Sets Credential = INACTIVE
2. ESP32 Locks Door
3. Save Check-out Access Log → Sets Booking = **CHECKED-OUT** → Notify Customer: check-out recorded
4. Admin inspects the property (or has it cleaned — cleaners are not system users; the Admin records the outcome)
5. Decision: Damage Found? *(Admin inspection or guest declaration)*
   - [No] → Proceed to Cleaning (step 6)
   - [Yes] → Admin records the damage (item, description, evidence) → **Security Deposit Settlement: deduct verified repair cost → refund deposit remainder** → Repair or Replace Item → Proceed to Cleaning (step 6)
6. Cleaning
7. Decision: Clean and Ready?
   - [No] → Maintenance Repair → Re-inspection
   - [Yes] → Admin sets Property = **AVAILABLE** in the app's Rooms screen *(dates rejoin the pool only now)*
8. Save Cleaning, Maintenance, and Inspection Records (Central Database)
9. Admin sets Booking = **COMPLETED** (mobile app) → Notify Customer: thank-you + deposit/deposit-refund receipt
10. Admin purges the government ID and receipt from Storage (RA 10173) → Activity Log
11. Reports (Analytics screen) → END *(all states final, logs written — G1 satisfied)*

---

## 6. Customer Module — the Website (summary of what the Customer can do)

1. Browse properties, rates and availability (public)
2. Submit a Booking (§2) — an anonymous Guest identity is attached at submit so the Booking can be claimed only from that browser / account (ADR-0004)
3. Sign up / sign in (Customer only) → `/account`:
   - See own Bookings, exact status, Date hold countdown, Activity log
   - Upload government ID + receipt (KYC) → **KYC SUBMITTED**
   - After **APPROVED**: choose Payment plan (50 % down payment or full, plus refundable Security deposit) from the Published rates → **PAYMENT PENDING**; upload Payment proof
   - Withdraw own Booking (PENDING / KYC SUBMITTED / APPROVED / PAYMENT PENDING / RESERVED → **CANCELLED**)
   - Share live location during the stay (consent = the share click; G6)
4. (Restriction: the Customer cannot approve, verify, refund, read other Bookings, or reach any management screen. `/admin` and `/app` on the website only point at the mobile app.)

---

## 7. Admin Module — the Mobile App

1. Admin Dashboard (after the gate in §1 step 3)
2. Modules managed — all in one app, one role:
   - **Bookings:** every Booking; approve / reject (availability re-checked by the system — G2); refuse an ID for resubmission
   - **KYC / ID Verification:** view the uploaded ID and receipt; purge after the stay (RA 10173)
   - **Payments & Refunds:** verify or reject Payment proof; cancel; Refund settled per the stamped policy; mark REFUNDED
   - **Stays:** CHECK-IN → STAYING → CHECKED-OUT → COMPLETED
   - **Rates & Cancellation Policy:** publish nightly rates, Security deposit, down-payment %, refund tiers (`site_config/rates`) — the website quotes from these
   - **Credentials / ESP32:** revoke a Credential; read the Access log (RFID / Mobile Key events, denials, lockouts)
   - **Guest Location:** Radar of consented sessions, distance and ETA
   - **Properties:** availability status and pricing (Rooms)
   - **Guest CRM & History**, **Analytics & Reports**
3. All operations write the Booking patch and the Activity Log entry in one write → Central Database (G7).
4. Adding a second operator = giving another account the Admin role (allowlist or Profile) — not a new role.

---

## 8. Account Management

- **Provisioning:**
  1. Public Register (website) → Customer role only
  2. The Admin role is granted in Firestore — bootstrap allowlist (`adminEmails()`) or `profiles/{uid}.role = 'admin'`; nothing a client sends can grant it
- **Customer accounts:** a Customer may delete their own account through Firebase Auth; Bookings keep their Activity history. Active bookings? → [Yes] → resolve / cancel first (G1).
- **Admin account:** cannot demote itself in the rules (`profiles` update never changes one's own role) — the hacienda can never be left with nobody able to act.
- There is no Staff module, no Super Admin module, no archive / restore hierarchy: with one operator role there is nobody to provision, disable or restore but the Admin's own second account.

---

## 9. (Reserved)

Section numbers 10–12 below are kept stable for cross-references from the thesis text.

---

## 10. Booking Tracking Flow & Status Lifecycle *(updated)*

- Tracking Data Captured: Tracking ID, Booking ID, Customer, Property, Location, Booking Date, Check-in, Check-out, KYC Status, Payment Status, Booking Status, Last Update, Updated By, History Log.
- **Main lifecycle:**

  `PENDING → KYC SUBMITTED → APPROVED → PAYMENT PENDING → PAYMENT VERIFIED → RESERVED → CHECKED-IN → STAYING → CHECKED-OUT → COMPLETED`

- **Terminal branches (all release dates + notify — G1):**
  - `REJECTED` — Admin denies ID/availability at review (no money involved)
  - `CANCELLED` — Customer withdraws (website) or Admin cancels (app)
    - money already verified → `REFUND INITIATED → REFUNDED` before terminal
  - `EXPIRED` — 24h TTL passed in any pending stage (G4)
- **Trigger definitions:**
  - `CHECKED-IN` = first successful unlock on check-in day
  - `STAYING` = after first unlock until check-out
  - `CHECKED-OUT` = credential deactivated at check-out
  - `COMPLETED` = cleaning + inspection passed, property back to AVAILABLE
- The Admin views the complete tracking history in the app (Booking detail → Activity log); the Customer sees their own Booking's history on `/account`.

---

## 11. Central Database Entity Coverage

The Central Database stores and interconnects:

- Users (Customers) and their **Profiles** (role: customer | admin), **ID/KYC Verification Records**
- Properties & Availability, **Date Holds (TTL)**, **Published Rates & Cancellation Policy** (`site_config/rates`)
- Bookings, Payments, Payment Proofs, **Refunds & Security Deposits**, Booking Tracking
- Credentials (RFID Cards/Tags, UIDs, Mobile Key Tokens), Credential Status, ESP32 Controls, Access Logs, **Offline Log Buffer**, **Lockout/Alert Events**
- Guest Locations & Location History, **Consent Records**, **Retention/Purge Log**
- Damage Reports, Photo/Video Evidence, Maintenance, Cleaning, Inspections
- System Activity Logs (per-Booking `activity` sub-collection), Notifications, Reports.

---

## 12. Implementation status (v3.0, 2026-09-24)

Where each convention lives in code, and where the build is deliberately short of the chart.

- **G1 — no dangling ENDs.** `src/lib/booking/actions.ts` (Customer actions, website) and `lib/services/booking_lifecycle.dart` (Admin and system actions, mobile app) are the two places a Booking's state changes — the same status table and transition whitelist on both sides — and every accepted action returns the Activity log entry it owes — a transition cannot happen unlogged, and a terminal status releases the dates because `holdsDates` is false for Rejected, Cancelled, Expired and Completed. The one clause not yet built is **(3) notify the customer**: the system has no notification channel, so the Guest sees the terminal status in their own dashboard / app instead of a message arriving at them.
- **G2 — the system enforces availability.** Overlap is re-checked at submit (the website's create path, against the stored Bookings) and at approval in the Admin app (`applyAdminAction` → `findDateConflicts` against the latest Bookings snapshot, committed statuses only — ADR-0003). ADR-0006's transactional Approve describes the web protocol; moving the app's approval write into a transaction is the open follow-up.
- **G3 — money last.** ADR-0001: the Admin approves before any money moves, `VerifyPayment` (app) refuses less than what was asked, and `settleRefund` (`src/lib/booking/money.ts` and its Dart port) is the only path money leaves.
- **G4 — 24h TTL.** The hold is stored data (`hold_expires_at`), and expiry is a read-time rule (ADR-0002) — no timer, no worker: a Booking that sat 24 hours reads as Expired, and Expired holds no dates. The two stages that expire are the two pre-approval ones, Pending and KYC Submitted; once the Admin approves, the hold becomes firm. The Admin app records a run-out hold as `Expired` in the system's name.
- **G6 — consent-based tracking.** Live location no longer rides on the Booking: it is the `tracking_sessions/{bookingId}` session, created by the traveller's own device, with `tracking_consent_at` written in the same write as the first ping (the Share click is the consent — a session without a consent cannot exist). Retention as built: 30 days from the last update, at read time; the Guest's own delete is the physical erasure. The Admin reads sessions on the app's Radar.
- **G7 — every state change is logged.** Same contract as G1: `applyAction` / `applyAdminAction` owe their log entries, and `firestore.rules` keeps `bookings/{id}/activity` append-only, written in the writer's own role (`guest`, `admin`, or `system` written by the Admin app).
- **G8 — two roles, two apps (v3.0).** `firestore.rules` knows `guest` and `admin` only (`role()`, `isAdmin()`); the website's `src/lib/auth` has the same two roles and no management pages (`/admin/*`, `/app/*` signpost to the app); the mobile app's `AuthStore.isAdmin` is the only gate and it has no Guest screens. See ADR-0007.
- **Payment plans and the policy stamp (v2.1).** The Admin publishes figures from the app's Rates screen — the `site_config/rates` document, `FIREBASE_SETUP.md` step 6 — and `ChoosePaymentPlan` (website) quotes the stay from them (or from the recorded total, when the quote is a phone call rather than a card), stamping the policy version and effective date on the Booking at choice time. Republishing changes the terms of future choices only, never of a stay already promised; a Booking stamped with nothing refunds nothing.
- **Charted, not yet built:** the customer notifications at every terminal path (§2, §3, §5); the credential pipeline of Module 3 (RFID / Mobile Key / ESP32) in code — the app reads and simulates `access_logs`, it does not yet drive a lock; damage reports and cleaning records as documents (§5 is recorded through the Booking's completion and the deposit settlement only); moving the full lifecycle table into `firestore.rules` (the rules enforce the terminal, KYC and payment guards today).

---

## Changelog vs. original chart

| # | Fix | Where |
|---|---|---|
| 1 | **Refund hole closed** — booking approves *before* payment; refund pipeline for post-payment cancellations (G3) | §2 steps 6–9, 11; §10 |
| 2 | **No dangling ENDs** — every terminal sets final status + releases dates + notifies + logs (G1) | all END paths |
| 3 | **Double-booking race closed** — system overlap re-check at approval + 24h TTL auto-expiry (G2, G4) | §2 steps 3, 4, 6a, 12 |
| 4 | **KYC/ID verification added** to the customer flow (was only a DB entity) | §2 steps 5–6b |
| 5 | **Tracking consent + retention/purge** — Data Privacy compliant (G6) | §4; §11 |
| 6 | **Mobile Key as co-credential** with RFID, one pipeline (G5); offline mode, failure lockout, alerting | §3 |
| 7 | **CHECKED-IN vs STAYING defined** — trigger = first successful unlock | §3 step 6; §10 |
| 8 | **Security deposit + damage settlement** wired into the flow | §2 step 7; §5 step 5 |
| 9 | **Account provisioning** — register = Customer only; the Admin role is granted in Firestore, never by a client | §1; §8 |
| 10 | **Notifications everywhere**, not just payment rejection | §2, §3, §5 |
| 11 | **Archive checks active bookings first** (G1) | §9 |
| 12 | **(v2.1) Implementation status** — where each G lives in code, the G6 retention rule corrected to what is built, the policy stamp added, and the not-yet-built clauses named | §4 step 8; §12 |
| 13 | **(v3.0) Two roles, two apps** — Staff and Super Admin modules removed; Customer = website, Admin = mobile app; every operator step re-attributed to the Admin; G8 added | §1, §5–§9, §11, §12 |
