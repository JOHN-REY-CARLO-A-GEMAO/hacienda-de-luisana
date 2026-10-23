# Hacienda de LuisAna — Topic XIII: Cloud Service Model Design Quiz

**Candidate:** John Rey Carlo A. Gemao  
**Section / Group:** ______________________  
**Approved Thesis Title:** Property Management, Smart Lock (RFID + Mobile Key / ESP32) & Tracking System for Hacienda de LuisAna — Luisiana, Laguna, Philippines  
**Date:** ______________________  

**Deliverable notes:** This document is the complete written companion to `Gemao_JohnReyCarlo.pptx` (10 editable slides, ready to upload to Google Slides). The deck and this document contain identical answers. All diagrams in the deck are native PowerPoint shapes/connectors (editable; not images).  
**Scope limit:** Limited to IaaS, PaaS, and SaaS. Provider names are optional; naming a provider alone does not identify a service model. SaaS means an existing provider-managed application — hosting your own app online does **not** automatically make it SaaS.

**Assumptions (apply to all answers):**
1. One cloud region: **asia-southeast1 (Singapore)**, close to Luisiana, Laguna.
2. "Provider" means the managed cloud behind each model; no single provider is named as the answer.
3. The system stays within approved scope: two roles (Guest website, Admin mobile app), booking lifecycle, downpayment proof, published rates, smart-lock access log, ESP32 lock gateway.
4. Direct ESP32 lock control is not exposed by PaaS/SaaS platforms, so it remains a separate integration operated by our team.
5. Cloud Functions are deployed on the Blaze plan in asia-southeast1 and `site_config/booking.callable_booking_required` is set so direct client writes to `bookings` are closed.

---

## Slide 1 — Candidate details (title slide)

Contains the quiz topic, total points (100), suggested time (90 min), candidate name, blank Section/Group and Date, the approved thesis title, and the scope limit.  
Deck also notes: Guest website = React + Vite + Firebase; Admin app = Flutter (Android); one Firebase project; deployed on Vercel and Firebase Hosting (`haciendadeluisana.com`).

---

# Question 1 — Compare the Three Cloud Service Models (20 pts)

## 1.1 Comparison table

| Model | Possible application to Hacienda de LuisAna | What our team manages | What the cloud provider manages | Main advantage and limitation |
|---|---|---|---|---|
| **IaaS** | Rent VMs (asia-southeast1) and self-install the Guest website, Admin app backend, database, Realtime Database, and the ESP32 lock gateway; we run and patch the OS, runtime, and web server ourselves. | OS patching & hardening, runtime (Node/Flutter server), web server (Nginx), application code deployment, database engine & indexes, backups, monitoring, security groups, Guest/Admin identity on the VMs. | Physical servers, storage, networking, virtualisation layer, hypervisor, data-centre power/cooling. | **Advantage:** full control to match the two-role, two-app architecture and the smart-lock gateway. **Limitation:** we operate everything above the hardware — high ops burden for a two-person team. |
| **PaaS** | Deploy the website on Firebase Hosting / Vercel and Admin app logic as Cloud Run / App Engine services; use managed Firestore, Firebase Auth, and Cloud Functions (asia-southeast1) for booking submission and availability. | Application code, data configuration (`site_config/rates`), user permissions & roles, Firestore Security Rules, Security PIN gate, OCR settings, deployment & CI/CD. | Servers, OS, runtime, scaling, load balancing, patching, underlying infrastructure and data-centre facilities. | **Advantage:** matches the existing Firebase/Vercel stack and small team; no server ops. **Limitation:** less control over the ESP32 lock gateway and exact database tuning. |
| **SaaS** | Subscribe to an existing property-management / booking SaaS and use its calendar, payments, and guest messaging as-is, keeping the smart-lock and custom refund policy only in spreadsheets or manual processes. | Subscription settings, user accounts & permissions within the SaaS, data entry, configuration of the offered features only. | Entire application, database, servers, OS, runtime, updates, security, and availability of the SaaS platform. | **Advantage:** near-zero build and ops work. **Limitation:** the approved system (RFID/Mobile Key via ESP32, custom 50% downpayment + refundable deposit, two-role split, Data Privacy Act handling of payment proofs) **cannot** be met by a generic SaaS — so a pure SaaS choice fails the requirements. |

## 1.2 Three user-access sketches

In the deck, Slide 3 shows three small labeled sketches (Guests + Admin on the left, HTTPS line to the right, provider-managed layer at the bottom, our-team layer on top):

- **IaaS sketch:** Users reach our VMs over HTTPS. Provider manages the physical server + hypervisor; our team manages the OS, runtime, and application code. Caption: *Team builds & runs the whole stack.*
- **PaaS sketch:** Users reach the managed platform over HTTPS. Provider manages servers, OS, runtime, and scaling; our team manages the application code and data configuration. Caption: *Team ships code; provider runs the platform.*
- **SaaS sketch:** Users reach the subscribed application over HTTPS. Provider manages the entire application + infrastructure; our team manages settings and data entry only. Caption: *Generic SaaS cannot meet RFID/lock & custom payment scope.*

## 1.3 Essay focus — easiest / hardest requirements per model

- **Easiest under IaaS:** full control over the ESP32 smart-lock gateway and the two-role split (Guest website vs Admin mobile app); we choose the OS, runtime, and database engine.
- **Hardest under IaaS:** operating everything above the hardware — patching, backups, monitoring, and availability fall on our small team, which has limited ops capacity.
- **Easiest under PaaS:** matches the existing Firebase Hosting / Vercel website and Cloud Functions stack; no server ops, with built-in scaling for the booking calendar.
- **Hardest under PaaS:** limited control over the ESP32 lock connection and exact Firestore tuning; the lock stays a separate integration we must manage.
- **Hardest under SaaS (a blocker):** an existing property-management SaaS cannot deliver the approved custom scope (RFID/Mobile Key via ESP32, 50% downpayment + refundable deposit, two-role split, Data Privacy Act handling of payment proofs), so **pure SaaS fails the requirements**.

---

# Question 2 — Select and Justify Your Cloud Service Model (20 pts)

## 2.1 Selected primary model: PaaS

**PaaS (Platform as a Service)** — the Guest website runs on Firebase Hosting / Vercel, and the Admin app logic runs as managed platform services (Cloud Run / App Engine) backed by managed Firestore, Firebase Auth, and Cloud Functions, in region asia-southeast1.

## 2.2 Justification

| Factor | Why PaaS fits |
|---|---|
| Approved functions & customization | The system needs a custom two-role split (Guest website, Admin mobile app), a booking lifecycle with 24-hour date holds, payment-proof upload, published rates, and an ESP32 smart-lock gateway. PaaS lets us write and deploy exactly that application code while the platform runs the servers. |
| Expected users & workload | Low-to-moderate, sporadic traffic (a countryside estate, not a hotel chain). PaaS scales to zero and scales up automatically — we pay for actual use, not idle VMs. |
| Team technical skills | The team already builds the React/Vite website and Flutter app on Firebase; no one is hired to operate Linux VMs, so removing server ops is a good fit. |
| Budget & maintenance capacity | Small operation — free/low-cost Firebase tiers plus pay-as-you-go functions suit a limited budget, and there is no dedicated sysadmin to patch OSes. |
| Security & access | Firebase Auth + Firestore Security Rules enforce the guest/admin split and payment invariants at the database layer; the Admin app adds a Security PIN gate (PBKDF2, ADR-0015). The provider handles physical security and server patching. |

## 2.3 Comparison with the two alternatives + trade-off

- **vs IaaS:** IaaS would give full control over the ESP32 lock gateway and the database engine, but we would have to patch OSes, run backups, and monitor servers ourselves — too much ops for our team and budget.
- **vs SaaS:** a generic property-management SaaS cannot meet the approved scope (RFID/Mobile Key via ESP32, custom 50% downpayment + deposit, two-role split). Pure SaaS fails the requirements.
- **Trade-off:** PaaS gives up direct control over the ESP32 lock connection and fine-grained database tuning — the lock stays a separate integration we manage, and we accept the platform's managed-service limits.
- **Addressing it:** keep the ESP32 lock gateway as a small integration we operate (it only writes access logs to Firestore), use Cloud Functions for the server-side transaction boundary (`submitBooking`), and verify provider SLAs/backups before launch.

## 2.4 Responsibility diagram (PaaS)

Slide 5 shows two labeled areas:

**"OUR TEAM MANAGES"** (left panel): application code (website + Admin app); Firestore data configuration (`site_config/rates`); user permissions & roles (guest/admin); Firestore Security Rules (authorization); Security PIN gate; OCR settings & payment-proof review; deployment & CI/CD (Vercel / Firebase Hosting); ESP32 lock-gateway integration; backup configuration & testing; monitoring & incident response.

**"CLOUD PROVIDER MANAGES"** (right panel): physical servers & data-centre facilities; operating systems & virtualisation; runtime environment & scaling; networking, load balancing & HTTPS termination; database engine, storage & replication; Firebase Auth identity service; server patching, uptime & physical security.

**Shared responsibility (band at bottom):** data protection (we configure backup rules & RPO/RTO targets; the provider durably stores & replicates the data), identity verification (we enforce roles in rules; the provider runs Auth), and security (we write the rules; the provider secures the platform).

---

# Question 3 — Cloud System Architecture (20 pts)

## 3.1 Architecture diagram (PaaS)

Slide 6 shows the architecture:

- **Users & client devices (left):** Guest on the website (browser) and Admin on the mobile app (Android). Guest books & pays on the website; Admin runs all operations from the mobile app.
- **Cloud platform boundary (centre, PaaS, asia-southeast1):**
  - *Provider-managed platform:* Managed Firestore (bookings, profiles, `site_config/rates`, `access_logs`); Firebase Auth (sign-in, ID tokens); Cloud Functions (`bookingAvailability`, `submitBooking`); Firebase Hosting / Vercel (website) + Cloud Run / App Engine (Admin app logic); Realtime Database (ephemeral live-location stream); Supabase Storage bucket (payment-proof files).
  - *Our team manages (application layer):* application code & deployment (React/Vite website, Flutter Admin app); Firestore Security Rules & roles (guest/admin); Security PIN gate & payment-proof verification; ESP32 lock-gateway integration (writes `access_logs`); backup configuration & RPO/RTO targets.
- **ESP32 smart lock (right):** RFID / Mobile Key verification; writes `access_logs` to Firestore (integration we operate).
- **Connections (HTTPS):** Guest → platform (HTTPS); Admin app → platform (HTTPS); platform → ESP32 (`access_logs`).
- **Access boundary:** guests reach only their own bookings; the Admin app reads all records via role-based rules.
- **Backup & monitoring strip:** managed Firestore backups (provider) + team-configured backup schedule & restore tests; monitoring & alerting on function errors and booking-submission failures (team/provider shared).

## 3.2 Transaction trace — Guest submits a booking

**Transaction:** Guest selects dates, uploads a downpayment screenshot, and submits a Pending booking.

1. **Browse & quote** — Guest opens the website (HTTPS). The calendar projection comes from `bookingAvailability` (a Cloud Function reading private Bookings + Published rates) — no other Guest's data is exposed.
2. **Sign in & pay offline** — Guest signs in (Firebase Auth, anonymous or linked account), chooses a payment plan, and transfers the downpayment manually to the published GCash/bank account.
3. **Upload proof** — Guest uploads the screenshot to Supabase Storage (`payments/{uid}/{ref}/proof.png`); client-side OCR pre-fills the reference number (OCR is a hint, not verification — `canAutoVerifyFromOcr()` returns `false`).
4. **Submit (server boundary)** — `submitBooking` callable binds the Booking to the caller's UID, validates dates, the 30-day Manila lead time, the quote, and the payment snapshot, then writes the Pending Booking and first Activity event in one Firestore transaction (serialized with `booking_inventory_locks` to prevent double-booking the last unit).
5. **Admin review** — Admin app re-checks date overlap and approves/rejects the screenshot under the Security PIN gate; approval sets `Approved` and firmly holds the dates.

**Design fit:** PaaS supports this scale and scope — low-volume, sporadic estate traffic; server-side transaction boundary (`submitBooking`) prevents double-booking the last unit; the two-role split and Security PIN gate run as application code we control; the ESP32 lock remains a separate integration we operate. *Assumption: Cloud Functions deployed on Blaze in asia-southeast1.*

---

# Question 4 — Physical DFD (20 pts)

## 4.1 Selected major process

**Process 1.0: "Submit Booking through Cloud Application"** — a Guest submits a Booking (website → PaaS backend → Firestore).

## 4.2 Physical DFD (Slide 8)

**External entities:** Guest (website, browser); Admin (mobile app).

**Process:** 1.0 Submit Booking through Cloud Application — deployed on PaaS (Cloud Function), asia-southeast1.

**Data stores (provider-managed repositories):**
- **DS1** `bookings` (Firestore) — Pending Booking + Activity event.
- **DS2** `site_config/rates` — Published rates + lead time.
- **DS3** `payment-proofs` (Supabase Storage) — screenshot file.

**Named, single-direction data flows:**
1. `stay dates, downpayment proof ref, claimed amount` → Guest → Process 1.0
2. `write Pending Booking + activity` → Process 1.0 → DS1
3. `read published rates + lead time` → Process 1.0 → DS2
4. `store payment-proof path` → Process 1.0 → DS3
5. `booking reference + Pending status` → Process 1.0 → Guest

**Deployment annotations:** processing occurs in the PaaS Cloud Function (asia-southeast1); storage occurs in provider-managed Firestore and Supabase Storage. Entity-to-store transfers route through process 1.0 (no direct entity-to-store flow), preserving the logical DFD.

## 4.3 Essay focus — how the PaaS model affects this process

- **Team configures/controls:** the `submitBooking` function code; validation (dates, 30-day Manila lead time, quote, payment snapshot); Firestore Security Rules; and the `booking_inventory_lock` that serializes competing submissions.
- **Provider manages:** the server, OS, runtime, scaling, the Firestore database engine and replication, and the Supabase Storage service; internal provider details are not exposed or invented.
- **Logical DFD preserved:** external inputs (stay dates, proof, claimed amount) and outputs (booking reference, Pending status) match the approved logical model.
- *Assumption:* Cloud Functions deployed on Blaze in asia-southeast1 and `site_config/booking.callable_booking_required` set so direct client writes are closed.

---

# Question 5 — Defend the Design During a Cloud Disruption (20 pts)

## 5.1 Scenario

The PaaS backend (Firestore / Cloud Functions) becomes unavailable during an important transaction (a Guest booking submission or an Admin payment verification). Selected model: **PaaS**.

**Affected users & functions:** Guests submitting or paying for bookings; the Admin verifying payments and approving bookings. Functions affected: booking submission (`submitBooking`), payment-proof verification, booking approval, and the ESP32 access-log path. Browsing published rates remains read-only where cached.

## 5.2 Recovery flowchart (Slide 9)

Six labeled boxes in order, with arrows:

1. **DETECT** — Monitoring/alerting on function errors & booking-submission failures (team-configured).
2. **IMPACT ASSESSMENT** — Identify affected users & functions: Guests booking/paying; Admin verifying payments & approving bookings. Pending holds at risk.
3. **TEAM / PROVIDER RESPONSE** — Team: verify own code & config, switch to fallback communication, log the incident. Provider (PaaS): restore platform per SLA; we verify.
4. **RECOVERY** — Restore from managed Firestore backup to the RPO target; replay incomplete transactions; re-issue holds where dates were released.
5. **VALIDATION** — Confirm booking statuses, payment proofs & access logs reconcile; run the booking-lifecycle transition checks before resuming.
6. **SERVICE RESUMPTION** — Reopen `submitBooking` / Admin functions; notify affected Guests & Admin; update the Activity log.

## 5.3 Team vs provider responsibilities (PaaS)

| Our team (PaaS) | Cloud provider (PaaS) |
|---|---|
| Detect via our monitoring & alerting | Restore the platform & managed database per SLA |
| Assess impact on bookings, payments & approvals | Durable storage & replication of Firestore data |
| Restore & validate from backups; replay incomplete transactions | Physical infrastructure, OS, runtime & patching |
| Verify provider SLA is met before claiming recovery | Backups (we configure schedule & test restore) |
| Communicate with affected Guests and the Admin | — |

## 5.4 RPO and RTO

**RPO (Recovery Point Objective):** as little data loss as practicable — target near-zero for completed bookings and verified payments; acceptable loss limited to in-flight submissions not yet written to Firestore.

**RTO (Recovery Time Objective):** restore booking & payment services within a few hours of a declared outage (target to be agreed with the provider SLA); manual fallback communication (email/phone) used meanwhile.

**Backup / recovery:** team configures the backup schedule and tests restores; incomplete transactions are re-checked against payment proofs and the append-only Activity log after recovery.

**Provider dependence & what must be verified:** managed Firestore backup frequency and point-in-time restore (provider capability); provider restoration time and SLA commitment for Firestore / Cloud Functions in asia-southeast1. Confirm backup schedule, PITR availability, and restore procedure with the provider before launch; obtain a written SLA with RTO commitment and test a restore drill before go-live; verify backup covers bookings, profiles, payment-proof paths, and `access_logs`, and that proof files are recoverable from Supabase Storage.

**Control available under PaaS (model-specific note):**
- We control our monitoring, backup schedule, restore tests, incident communication, and the application code; we **cannot** reach the provider's servers or OS.
- The provider is responsible for platform restoration per its SLA; we must verify the SLA, backup frequency, PITR, and restore procedure — these are **agreements to confirm, not guarantees we assume**.
- Records are protected by provider-managed durable storage and replication; incomplete transactions are checked against payment proofs and the append-only Activity log after recovery.

*A target is not a guarantee — provider capabilities and agreements must be verified before launch.*

---

## Submission checklist (self-check)

- [x] Complete approved thesis title written on Slide 1.
- [x] All answers use the actual approved system (Hacienda de LuisAna: two roles, two apps, booking lifecycle, payment proof, ESP32 smart lock).
- [x] IaaS / PaaS / SaaS compared accurately (Question 1 table + sketches).
- [x] One primary model selected and justified (PaaS), with alternatives and a trade-off (Question 2).
- [x] Team vs provider responsibilities distinguished (responsibility diagram, Question 2; DFD, Question 4; recovery, Question 5).
- [x] Architecture diagram matches the selected PaaS model (Question 3).
- [x] Physical DFD matches the architecture and logical process (Question 4).
- [x] Processes, stores, entities, and flows clearly labeled (Question 4).
- [x] Recovery plan reflects available PaaS controls (Question 5).
- [x] RPO and RTO defined correctly (Question 5).
- [x] Assumptions and unspecified provider details labeled throughout.
- [x] Drawings are readable, with clear arrows and minimal overlaps (native PPTX shapes).
- [x] All five questions answered in my own words.
