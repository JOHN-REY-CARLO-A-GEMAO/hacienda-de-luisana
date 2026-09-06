# PROPERTY MANAGEMENT, SMART LOCK (RFID + MOBILE KEY / ESP32) & TRACKING SYSTEM
### Corrected Flow Chart Spec v2 — fixes: refund hole, dangling ENDs, double-booking race, missing KYC, tracking consent, offline/tamper handling

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

---

## 1. Initial Authentication & Role Routing

1. START → Open System
2. Input: Register or Login
   - Register → Role = **CUSTOMER** (default; staff/admin accounts are provisioned, never self-registered) → Account = ACTIVE
3. Decision: Account Status ACTIVE?
   - [No — INACTIVE/ARCHIVED] → Login Not Allowed → Notify: "Contact administrator" → END
   - [Yes] → Identify Role:
     - → Customer / User → Customer Dashboard
     - → Staff → Staff Dashboard
     - → Admin → Admin Dashboard
     - → Super Admin → Super Admin Dashboard

---

## 2. Customer / User Module Flow  *(reordered: approve first, pay after — kills the refund hole)*

1. Customer Dashboard → View Properties
2. Decision: Property Available? *(system date-overlap check)*
   - [No] → Return to Search → View Properties
   - [Yes] → Input: Select Check-in, Check-out, and Guests
3. Decision: Dates valid & Guests ≤ Capacity?
   - [No] → Notify Customer: adjust dates/guests → back to Input
   - [Yes] → Submit Booking
4. Sets Booking = **PENDING** → System places **24h TTL hold** on dates (G4) → Save to Central DB → Notify Admin: "New booking for review"
5. Upload Valid Government ID (KYC) → Sets KYC = **SUBMITTED** → Save to Central DB
6. **Booking Review** (Admin / Super Admin):
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
8. Admin / Super Admin Verifies Payment
9. Decision: Payment Valid?
   - [No] → Reject Payment → Notify Customer → Decision: Resubmit Proof?
     - [Yes] → Loop back to Upload Payment Proof
     - [No] → Sets Booking = **CANCELLED** → Release Dates → Notify Customer → END *(no verified money yet — nothing to refund)*
   - [Yes] → Sets Payment = **VERIFIED** → Sets Booking = **RESERVED** → Save to Central DB → Notify Customer: "Reservation confirmed"
10. Create Booking Tracking Record (→ Booking Tracking & Central DB)
11. **Customer Cancellation branches** (available anytime from the dashboard):
    - Cancel while PENDING/APPROVED (nothing verified) → Sets Booking = **CANCELLED** → Release Dates → Notify Admin → END
    - Cancel while RESERVED (money verified) → Admin reviews per Cancellation Policy
      - [Approved] → Sets Booking = **CANCELLED** → Release Dates → **Refund Initiated** → Refund per Policy (deposit rules apply) → **REFUNDED** → Notify Customer → END
      - [Denied] → Booking stays RESERVED → Notify Customer: reason → END
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
5. Admin and Super Admin View Authorized Location (role-restricted; every view is logged)
6. Decision: Guest Still Staying?
   - [Yes] → Loop back to Get Guest Location
   - [No] → Proceed to CHECK-OUT
7. Stop Location Tracking → Save Final Location
8. **Retention rule:** auto-purge location history N days after check-out → Save Purge Log (G6)
9. Disable Guest Credential (RFID + Mobile Key)

---

## 5. Check-out, Damage, Cleaning & Inspection Flow

1. CHECK-OUT (e.g. 12:00 NN) → Sets Credential = INACTIVE
2. ESP32 Locks Door
3. Save Check-out Access Log → Sets Booking = **CHECKED-OUT** → Notify Customer: check-out recorded
4. Create Cleaning Task (auto-assign Staff / Caretaker)
5. Decision: Damage Reported? *(staff inspection or guest declaration)*
   - [No] → Proceed to Staff or Caretaker Cleans (step 6)
   - [Yes] → Select Damaged Item → Enter Description → Upload Evidence (Photo/Video) → Submit Damage Report (Central DB)
     - Admin / Super Admin View Report → Verify Damage:
       - Decision: Damage Verified?
         - [No] → Close Damage Report → Proceed to Cleans (step 6)
         - [Yes] → Sets Damage = **VERIFIED** → Create Maintenance Task → **Security Deposit Settlement: deduct repair cost → refund deposit remainder** → Repair or Replace Item → Update Maintenance → Proceed to Cleans (step 6)
6. Staff or Caretaker Cleans
7. Decision: Cleaning Complete?
   - [No] → Continue Cleaning
   - [Yes] → Property Inspection
8. Decision: Clean and Ready?
   - [No] → Maintenance Repair → Re-inspection → Re-evaluate Clean and Ready?
   - [Yes] → Sets Property = **AVAILABLE** *(dates rejoin the pool only now)*
9. Save Cleaning, Maintenance, and Inspection Records (Central Database)
10. Sets Booking = **COMPLETED** → Notify Customer: thank-you + deposit/deposit-refund receipt
11. Generate Reports → END *(all states final, logs written — G1 satisfied)*

---

## 6. Staff Module Flow

1. Staff Dashboard
2. Decision: Staff Account Active?
   - [No] → Login Not Allowed → END
   - [Yes] → Access Staff Dashboard:
     - View Assigned Bookings
     - Manage Cleaning
     - Manage Assigned Maintenance
     - Conduct Property Inspection
     - Submit Inspection
     - Save Staff Activity Log → END
3. (Restriction: Staff cannot manage accounts, verify payments, or approve bookings.)

---

## 7. Admin Module Flow

1. Admin Dashboard
2. Decision: Admin Account Active?
   - [No] → Login Not Allowed → END
   - [Yes] → Access Full Admin Dashboard:
     - Modules Managed: Users, Staff, Properties, Bookings, KYC/ID Verification, Payments & Refunds, Credentials (RFID/Mobile Key), ESP32, Damage, Maintenance, Cleaning, Inspection
     - Verify ID (KYC) and Payments; Approve/Reject Bookings *(availability re-checked by system — G2)*
     - Process Refunds per Policy
     - Register, Assign, Activate, and Deactivate Credentials
     - View Credential Logs, Booking Tracking, and Authorized Guest Locations (view-logged)
     - Track Activities and Generate Reports
     - Disable, Enable, Archive, or Restore Users and Staff
     - (Restriction: Cannot restore another Admin or modify Super Admin)
3. All operations write directly to Activity Log → Central Database.

---

## 8. Super Admin Module Flow

1. Super Admin Status = ALWAYS ACTIVE
2. Super Admin Dashboard:
   - All Admin Permissions
   - **Account Provisioning: creates Admin and Staff accounts** (only path to those roles)
   - Manage Admin Accounts (Disable, Enable, Archive, Delete, Restore Other Admins)
   - Restore User and Staff Accounts
   - View System-wide Logs, All Booking Tracking, Authorized Guest Locations, Payments, Refunds, Damage Reports, and RFID/ESP32 Logs
   - Generate System Reports
3. Self-Protection Checks:
   - Delete Self? → Action Denied
   - Archive Self? → Action Denied
   - Disable Self? → Action Denied
   - Restore Self? → Action Denied
   - No Self-action → Remain ACTIVE
4. All actions record to System-wide Activity Log → Central Database.

---

## 9. Account Management & Soft Archive Flow

- **Provisioning (new):**
  1. Public Register → Customer role only
  2. Admin creates Staff accounts; Super Admin creates Admin accounts
  3. All creations → Save Provisioning Log

- **User / Staff Accounts:**
  1. User/Staff Requests Account Deletion → Admin/Super Admin Review
  2. Soft Delete / Archive Account → Sets Status = ARCHIVED
  3. Login Not Allowed → Moved to Archived Accounts Database
  4. Active bookings? → [Yes] → Resolve/cancel bookings first (G1) → then archive
  5. Restore Selected?
     - [No] → Remain in Archived Accounts
     - [Yes] → Sets Status = ACTIVE → Login Allowed → Save Restore Log (Central DB)

- **Admin Accounts:**
  1. Super Admin Authorized Action → Archive/Delete Other Admin
  2. Sets Admin Status = ARCHIVED → Admin Login Not Allowed
  3. Keep in Archived Admins Database
  4. Restore Selected?
     - [No] → Keep Archived
     - [Yes] → Sets Admin Status = ACTIVE → Login Allowed → Save Restore Log (Central DB)

---

## 10. Booking Tracking Flow & Status Lifecycle *(updated)*

- Tracking Data Captured: Tracking ID, Booking ID, Customer, Property, Location, Booking Date, Check-in, Check-out, KYC Status, Payment Status, Booking Status, Last Update, Updated By, History Log.
- **Main lifecycle:**

  `PENDING → KYC SUBMITTED → APPROVED → PAYMENT PENDING → PAYMENT VERIFIED → RESERVED → CHECKED-IN → STAYING → CHECKED-OUT → COMPLETED`

- **Terminal branches (all release dates + notify — G1):**
  - `REJECTED` — Admin denies ID/availability at review (no money involved)
  - `CANCELLED` — Customer/host cancels
    - money already verified → `REFUND INITIATED → REFUNDED` before terminal
  - `EXPIRED` — 24h TTL passed in any pending stage (G4)
- **Trigger definitions:**
  - `CHECKED-IN` = first successful unlock on check-in day
  - `STAYING` = after first unlock until check-out
  - `CHECKED-OUT` = credential deactivated at check-out
  - `COMPLETED` = cleaning + inspection passed, property back to AVAILABLE
- Admin and Super Admin can view the complete tracking history.

---

## 11. Central Database Entity Coverage

The Central Database stores and interconnects:

- Users, **ID/KYC Verification Records**, Staff, Admins, Super Admin
- Properties & Availability, **Date Holds (TTL)**
- Bookings, Payments, Payment Proofs, **Refunds & Security Deposits**, Booking Tracking
- Credentials (RFID Cards/Tags, UIDs, Mobile Key Tokens), Credential Status, ESP32 Controls, Access Logs, **Offline Log Buffer**, **Lockout/Alert Events**
- Guest Locations & Location History, **Consent Records**, **Retention/Purge Log**
- Damage Reports, Photo/Video Evidence, Maintenance, Cleaning, Inspections
- Account Deletion Requests, Archived Accounts, **Provisioning Logs**, System Activity Logs, Notifications, Reports.

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
| 9 | **Account provisioning** — who creates Staff/Admins; register = Customer only | §1; §8; §9 |
| 10 | **Notifications everywhere**, not just payment rejection | §2, §3, §5 |
| 11 | **Archive checks active bookings first** (G1) | §9 |
