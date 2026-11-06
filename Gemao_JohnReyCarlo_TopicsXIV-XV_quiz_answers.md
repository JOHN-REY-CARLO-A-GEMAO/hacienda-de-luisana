# Hacienda de LuisAna — Topics XIV & XV: Individual Design Quiz (UI/UX Design Principles and Database Design)

**Candidate:** John Rey Carlo A. Gemao
**Section / Group:** ______________________
**Approved Thesis Title:** Property Management, Smart Lock (RFID + Mobile Key / ESP32) & Tracking System for Hacienda de LuisAna — Luisiana, Laguna, Philippines
**Date:** November 6, 2026
**Deliverable:** `SECTION_Gemao_JohnReyCarlo_TopicsXIV-XV_IndividualQuiz` (Google Slides / PPTX, 15 slides). All wireframes and diagrams are native, individually editable shapes, text boxes, tables, lines and connectors. This document is the written companion; the same explanations appear on the slides.

**Filename note:** replace `SECTION` with your section (e.g., `BSIT4A_Gemao_JohnReyCarlo_TopicsXIV-XV_IndividualQuiz`) before submitting, and type your section on Slide 1.

**One major workflow used in Questions 1, 2, 4 and 5:** A Guest submits a Booking with downpayment proof — Guest website `/book` (stay + contact) → `/book/pay` (downpayment screenshot) → Review → `submitBooking` (Cloud Function) → `/booking/status` output (Pending — not yet confirmed) → Admin review.

**Assumptions (labeled, applied throughout):**
1. Scope stays inside the approved system: two roles only — Guest (website) and Admin (mobile app) — booking lifecycle, 50% downpayment proof, published rates, smart-lock access log.
2. Wireframes are low-fidelity and drawn with editable shapes; labels use the system's own vocabulary (Booking, Pending — Hindi pa kumpirmado, Downpayment proof, Date hold).
3. **Question 3** inspects the current Guest website build of this system (routes `/book`, `/book/pay`, `/booking/status`) in its repository source at commit `5cd6fca` (Nov 6, 2026), **without performing a real transaction**. If the instructor assigns a common interface, the same method applies unchanged and the findings would be replaced.
4. **Question 4** expresses the same entities the production system stores in Cloud Firestore (`bookings`, payment proofs, activity/audit events) as a relational physical schema so keys, types and constraints can be stated precisely.
5. Where the quiz wireframes improve on the current build (e.g., an error summary), they are labeled as **proposed changes**.

---

# Question 1 — Design a User-Centered Input Form (20 pts)

**Chosen input task:** *Submit a Booking* — a Guest requests one Accommodation over a date range and attaches the 50% downpayment proof so the Admin can review the request.

## 1.1 Required drawing (Slide 2) — low-fidelity input-form wireframe

Manually constructed with editable shapes: browser frame, screen title, form sections (Stay details / Contact / Downpayment proof), persistent labels, required `*` markers + `(optional)` text, one validation-error example on Check-in date (red outline + "✕" + a sentence with the exact fix), one primary action ("Continue to downpayment") and one secondary action ("← Back to calendar"), plus a text legend.

*Assumption note (on the slide):* the deployed build splits this input across `/book` and `/book/pay`; the quiz wireframe shows the complete input task in one low-fidelity form, per the 90-minute scope.

## 1.2 Required explanation

**1. What user goal does the form support?**
One goal: a Guest requests to stay at one Accommodation over a date range and proves the 50% downpayment so the Admin can review the request. The task ends with a **Pending** Booking request — the copy under the actions states plainly that no booking exists yet and that submission is "Pending — hinihintay ang approval", never a confirmed reservation.

**2. Why are the selected fields and controls appropriate?**
- **Accommodation\*** — a Select restricted to the three canonical units (`main-house`, `annex`, `house-a-camping`): free text cannot invent a unit.
- **Check-in / Check-out\*** — date pickers: valid formats always, and dates before the earliest allowed check-in can be disabled to match the 30-day lead-time rule shown beside them (today + 30 days, Asia/Manila).
- **Guests\*** — numeric stepper bounded by the per-unit cap (10 Main House / 6 Annex / 3 per A-House) instead of free text.
- **Name / Mobile / Email\*** — the contact data the Admin needs to verify the booking; prefilled from the signed-in Profile so the Guest edits instead of retyping.
- **Upload downpayment screenshot\*** — required because a new Booking is born Pending only with a downpayment screenshot (policy). **Amount claimed\*** is prefilled with the computed 50% downpayment but editable, because the peso figure printed on the screenshot is the claim (OCR is only a hint).
- **Payment reference (optional)** — speeds verification but is not required. **Special requests (optional)** — free text for anything the structured add-ons (pets, bonfire sets, late checkout, event purpose) do not cover.
- Every label is **persistent** (above the control, always visible), so context survives typing on small screens.

**3. What validation rules apply?**
1. Check-in ≥ today + 30 calendar days, Asia/Manila (client hint; the `submitBooking` Cloud Function re-enforces with **server time** — authoritative).
2. Check-out after check-in; stay length 1–20 nights.
3. Guests within the per-unit cap for the chosen Accommodation.
4. Accommodation within the canonical set, published and active.
5. Name required; PH mobile format (09XX XXX XXXX); valid email — validated on blur and again on submit.
6. Screenshot required (PNG/JPG ≤ 5 MB); claimed amount must be one of the peso figures printed on the screenshot unless the Guest deliberately claims another figure (flagged for the Admin, who reads the screenshot); a claim below the computed downpayment is refused.
7. Terms must be accepted.
Errors appear as text under the offending field (the Check-in example) and are summarized at the top on submit (**proposed improvement** — see Question 3).

**4. Three accessibility decisions (+ the testing caveat)**
1. **Persistent visible labels + text required markers** ("*" with a legend, plus screen-reader text "required") — never placeholder-only labels.
2. **Logical keyboard order equals visual order** (accommodation → dates → guests → contact → proof → terms → actions); all controls are native (select, `input[type=date]`, `input[type=file]`, button) so Tab, Enter and Space work; the date picker is keyboard-operable; focus is visible on every control.
3. **Errors are text + icon + outline together** — never colour alone — placed under the field and linked with `aria-describedby` / `aria-invalid`; on submit, focus moves to the first invalid control and an error summary is announced.
4. **Contrast:** body and error text target ≥ 4.5:1 in both light and dark themes.

**Requires implementation testing (the wireframe proves none of it):** real screen-reader announcement (aria-live / role=alert with NVDA and VoiceOver), the true focus order and visible focus ring (including inside the mobile bottom sheet and the date picker), measured contrast ratios in both themes, that status/required information survives greyscale, and touch targets ≥ 44×44 px. Method: keyboard-only walkthrough, NVDA/VoiceOver pass, contrast checker — recorded before sign-off.

---

# Question 2 — Design the Review and Output Screens (20 pts)

Continues the same workflow. Slides 4–5 hold the two wireframes, with labeled connectors/annotations for the sequence (Continue: form → review; Submit: review → output; Edit/Back: review → form, values preserved) and a return-and-correct path on the output.

## 2.1 Review screen (Slide 4)
Read-only summary rows (each with an **Edit ↩** link back to the owning section): Accommodation · Check-in → Check-out (+ nights) · Guests · Rate classification + stay total · Downpayment due (50%) · Amount claimed · Payment reference · Proof thumbnail. A warning strip states "Submitting sends your request for Admin review. Your stay is NOT confirmed yet." Primary: **Submit booking request**; secondary: **← Back to payment step**.

## 2.2 Output screen (Slide 5)
Status banner "🕐 PENDING — Hindi pa kumpirmado · Booking request received", booking reference `HDL-2026-0042`, **date-hold countdown** ("Expires in 23:59:12"), a "What happens next" timeline (Admin reviews the screenshot → Approved / needs correction / expires), and actions (View my bookings · Back to home · Save/print). A failure variant shows a red banner naming the exact problem ("those dates were just taken… your details and screenshot are saved") with recovery actions.

## 2.3 Required explanation

**What information should users verify?**
The stay (accommodation, dates, nights, guests), the money (rate classification, stay total, 50% downpayment due, claimed amount against the screenshot figure, payment reference), the proof itself, and the contact details — every row shows the exact value that will be stored.

**What happens when they select the primary action?**
The server-side `submitBooking` transaction runs: re-checks the lead time with server time, re-reads availability, recomputes the quote from published rates, binds the Booking to the caller's uid, writes the **Pending** Booking + payment-proof record + first audit event in one transaction, and starts the 24-hour date hold. The output screen then shows the reference. **Approval is not part of this action.**

**How does the output distinguish success, pending, and failure?**
By banner text + icon + explicit next step — never colour alone. PENDING: amber 🕐 "Pending — Hindi pa kumpirmado" + hold countdown + review timeline. APPROVED (later state): green ✓ "Approved — dates held" + balance due at check-in. FAILURE: red ✕ banner naming the exact problem + recovery actions + "your details and screenshot are saved." A pending-rate case blocks payment with "Do not send payment yet."

**Three UI/UX principles applied across the screens**
1. **Visibility of system status** — flow steps, "submitting…" button state, hold countdown, status badge.
2. **Error prevention & user control** — review with per-row Edit before the irreversible commit; Back/Edit paths always exist.
3. **Consistency & standards** — one primary action per screen; shared vocabulary (Booking reference, Pending — Hindi pa kumpirmado, Downpayment proof); identical labels from form → review → output.
4. *(bonus)* **Recognition rather than recall** — every value is repeated on the review; the reference and next steps are repeated on the output.

**Main stored information needed to produce the output**
Booking record (reference, guest uid, accommodation id, dates, guests, rate classification, stay total, downpayment amount, amount claimed, policy stamp, status, hold expiry, created_at) · payment-proof record (screenshot path, claimed amount, reference number, verification status, OCR read as evidence) · the audit event written at submission. The "what happens next" text is derived from status — no extra storage.

**Reminder honored:** the acknowledgement never claims final approval; both the review warning and the output banner say "not yet confirmed / Hindi pa kumpirmado."

---

# Question 3 — Perform a Heuristic Evaluation (20 pts)

**Interface inspected:** the Hacienda de LuisAna **Guest website** — the approved system's own interface — pages `/book` (stay + contact) and `/book/pay` (downpayment proof), task "submit a booking with downpayment proof", inspected in the repository build at commit `5cd6fca` (Nov 6, 2026) **without performing any real transaction**. Assumption: no common instructor interface was provided; if one is assigned, the same procedure (run the task, record what happens, map to heuristics, rate severity) replaces the findings below.

## 3.1 Required evaluation table (Slide 7)

| Screen / task | Observed problem (evidence) | Relevant heuristic | Severity 0–4 | Specific improvement |
|---|---|---|---|---|
| `/book` — mobile viewport. Task: start a Booking (stay details). | With invalid stay fields, tapping "Continue to downpayment" produces **no visible response**: validation only writes per-field error messages — no error summary, no focus move, no scroll (the page has no `focus()`/`scrollIntoView()` calls) — and on phones the stay fields live in the collapsed "Maghanap" bottom sheet (rendered `max-lg:invisible` when closed), so their red error messages render **off-screen inside the still-collapsed sheet**. | Nielsen #5 — Help users recognize, diagnose, and recover from errors (also #1 — Visibility of system status) | **3** | On failed submit: a persistent error summary at the top ("Please fix 3 items") with a link per item, auto-open the bottom sheet, move focus to the first invalid control, and put an "errors" badge on the summary bar; announce the summary assertively (aria-live). |
| `/book/pay` — task: claim the downpayment amount against the uploaded screenshot. | The claimed-amount rule ("the figure your screenshot prints wins; you may deliberately claim another figure") is spread over up to **five stacked message surfaces** around one input: the top "dates are not held" alert, the OCR note line, the multi-figure chooser alert, the off-receipt danger alert with its checkbox and "Use ₱…" links, and the underpayment block alert. Which figure to enter — and why the state changed — must be assembled from state-dependent prose. | Nielsen #2 — Match between system and the real world (also #8 — Aesthetic and minimalist design) | 2 | One consolidated "Claimed amount" component: detected figures as selectable chips, one current status sentence, one checkbox for a deliberate off-receipt claim; print the policy sentence once under the field. |
| `/book` — task: choose alternative dates after a conflict. | The conflict message instructs "Choose a **green** check-in date" and explains "A booked date can still be the previous Guest's checkout boundary" — guidance that depends on perceiving the calendar's colour and on understanding internal stay semantics (`[check-in, check-out)` intervals). | Nielsen #2 — Match between system and the real world (also #6 — Recognition rather than recall) | 2 | Name the blocking dates in text ("Dec 12–15 are held") and offer the concrete alternative ("You can check in on Dec 16"); give calendar cells a text state name and a legend pattern — not colour alone. |

## 3.2 Required drawing (Slide 8) — "Observed layout" vs "Proposed improvement" (Finding 1)

Both phone frames are hand-reconstructed from editable shapes. **Observed:** tapping Continue leaves the screen unchanged while the red field errors sit inside the dashed-outline "collapsed bottom sheet — INVISIBLE when closed." **Proposed:** a red error summary panel ("Please fix 3 items…" with per-item links and the exact fix), the sheet auto-opened with a visible focus ring on Check-in and the same message text under the field, and a "3 errors" badge on the summary bar.

## 3.3 Required explanation

**How each issue affects the user**
1. A Guest on a phone taps Continue and **nothing appears to happen** — the fixable problems are printed inside an invisible sheet. The user cannot tell whether the tap registered, retries, or abandons the booking.
2. The Guest must reconstruct the payment-claim rule from several state-dependent messages around one field; hesitation and wrong claims lead to rejected submissions and re-uploads.
3. The conflict message asks users to "choose a green date" and to understand checkout-boundary semantics; users who cannot see the colour, or who do not know a checkout day is reusable, wrongly conclude the whole period is unavailable and book elsewhere.

**Severity justification (most serious = Finding 1, Severity 3 — Major)**
Severity 3 rather than 4: the task is not permanently blocked — a user who realizes the "Maghanap" bar opens the sheet can find the red fields and continue. But it is far from cosmetic: the feedback channel for **every** stay-detail error is invisible at the moment of failure, on the primary device of the audience, and the screen offers no evidence that validation ran. By the guide, an issue that makes a required step appear to do nothing and pushes users to abandon or misinterpret the flow is *major*. Findings 2–3 rate 2 (Minor): they slow or mislead but leave a visible path to success.

**How the redesigned area addresses the finding**
(1) *Recognition* — the error summary names each problem in plain language with a link to its field. (2) *Recovery* — the sheet opens automatically and focus moves to the first invalid control; the summary bar keeps a context badge. (3) *Consistency & accessibility* — identical message text in summary and field, assertive announcement, errors remain text + icon + outline for greyscale. This restores Nielsen #5 and #1 exactly where the current build loses them.

**Evidence trail (not invented findings):** each finding records an observable action → interface response → consequence, grounded in the interface's construction (no focus/scroll calls + invisible closed sheet; five message surfaces around one input; the conflict message's own wording). None is a colour preference.

---

# Question 4 — Translate the Workflow into a Physical Schema (20 pts)

## 4.1 Required drawing (Slide 10) — three related tables

**bookings** (central entity): `booking_id VARCHAR(20) PK` (e.g. `HDL-2026-0042`) · `guest_uid VARCHAR(64) NN` (Firebase Auth user) · `accommodation_id VARCHAR(20) NN` · `check_in DATE NN` · `check_out DATE NN` · `guests SMALLINT NN` · `status VARCHAR(16) NN` · `rate_classification VARCHAR(16) NN` · `stay_total NUMERIC(10,2) NN` · `downpayment_amount NUMERIC(10,2) NN` · `amount_claimed NUMERIC(10,2) NN` · `policy_stamp JSONB` · `hold_expires_at TIMESTAMP` · `created_at TIMESTAMP NN`.

**payment_proofs** (weak entity, 1:N from bookings): `proof_id UUID PK` · `booking_id VARCHAR(20) FK→bookings NN` · `file_path VARCHAR(255) NN` · `amount_claimed NUMERIC(10,2) NN` · `reference_no VARCHAR(64) UQ` · `verification_status VARCHAR(12) NN` · `uploaded_at TIMESTAMP NN`.

**audit_events** (append-only, 1:N from bookings): `event_id UUID PK` · `event_time TIMESTAMPTZ NN` · `actor_uid / actor_role NN` · `action VARCHAR(40) NN` · `booking_id VARCHAR(20) FK→bookings (nullable)` · `affected_record VARCHAR(64) NN` · `outcome VARCHAR(10) NN` · `request_id VARCHAR(64) NN`.

Relationships labeled with cardinality: **bookings 1 : N payment_proofs** (re-uploads after a rejection) and **bookings 1 : N audit_events** (`ON DELETE SET NULL`).

## 4.2 Required specification (Slide 11)

| Business rule | Table / column | Proposed constraint or enforcement |
|---|---|---|
| Every booking must belong to a signed-in Guest. | `bookings.guest_uid` | **NOT NULL** (bound server-side to the caller's Firebase uid at creation). |
| A payment reference may back only one booking claim. | `payment_proofs.reference_no` | **UNIQUE** (business UNIQUE rule; NULL allowed when the receipt prints no reference). |
| Check-out after check-in; stay 1–20 nights. | `bookings.check_in, check_out` | **CHECK** (check_out > check_in AND check_out − check_in ≤ 20). |
| Status stays inside the lifecycle. | `bookings.status` | **CHECK** (status IN ('Pending','Approved','Checked-In','Staying','Checked-Out','Completed','Rejected','Cancelled','Expired')). |
| Guest count respects per-unit caps (10/6/3). | `bookings.accommodation_id, guests` | **CHECK** ((main-house ⇒ ≤10) OR (annex ⇒ ≤6) OR (house-a-camping ⇒ ≤3)). |
| Deleting a booking (privacy erasure) removes its proof rows with it. | `payment_proofs.booking_id` | **FK ON DELETE CASCADE — justified:** a proof row exists only as evidence of its booking and must not outlive it; audit history is preserved separately. |
| Audit history outlives the record it describes. | `audit_events.booking_id` | **FK ON DELETE SET NULL** + `affected_record` keeps the text snapshot ("bookings/HDL-2026-0042"); the append-only row keeps actor, action, outcome, time. |
| The availability query must stay fast as bookings grow. | `bookings (accommodation_id, check_in, check_out)` | **INDEX** `idx_bookings_overlap` (partial: WHERE status IN active set) — supports *"which dates are blocked for a property"* (`check_in < :out AND check_out > :in`). |

## 4.3 Required explanation

**1. Logical → physical.** Guest (identity) makes one Booking for one Accommodation; each Booking carries 1..N Payment proofs (evidence, including re-uploads); every lifecycle act is an Audit event. `bookings` is the central row; `payment_proofs` is the weak entity (FK NOT NULL + CASCADE); `audit_events` references a booking optionally (SET NULL) so history survives erasures. `guest_uid` stands for the Guest–Booking relation to the external identity store (Firebase Auth), so no fourth table is needed.

**2. Three+ mappings from Questions 1–2.** (a) Form "Check-in / Check-out" + review rows → `bookings.check_in/check_out`. (b) Form "Accommodation" select (3 canonical units) → `bookings.accommodation_id` + its CHECK vocabulary. (c) Form "Upload screenshot / Amount claimed / Reference no." → one `payment_proofs` row (`file_path`, `amount_claimed`, `reference_no`, status 'unverified'). (d) Review "Rate & stay total / Downpayment due" → `rate_classification`, `stay_total`, `downpayment_amount`, `policy_stamp` (frozen quote). (e) Output "reference / Pending / hold countdown" → `booking_id`, `status='Pending'`, `hold_expires_at`.

**3. One rule simple constraints cannot enforce.** The **no-overlap rule** (one unit cannot host two stays whose `[check_in, check_out)` ranges overlap): row-level CHECK/UNIQUE cannot see other rows, and EXCLUDE/GIST is not portable to the live stack (Firestore). It is enforced by the `submitBooking` Cloud Function: one Firestore transaction serialized through `booking_inventory_locks`, with direct client creates closed by rules. (Sibling gap: the 30-day lead time depends on "today" — also kept server-side.)

**4. One storage consideration.** Proof screenshots are binary evidence — `file_path` points to object storage (Cloud Storage `payments/{uid}/…`), not database rows; the row stores only the path, figures and status. Growth/recovery: `audit_events` is append-only and grows with every lifecycle act — monthly partitions, a retention window (e.g., 13 months online + archived export), nightly encrypted backups with restore drills, and object-storage lifecycle rules so deleted bookings also drop their proof files (matching the CASCADE).

SQL DDL sketch appears on Slide 12 (optional; marks depend on the schema and specification, not extra code).

---

# Question 5 — Design Security Controls and an Audit Trail (20 pts)

## 5.1 Two specific threats (Slide 13)

| Threat and affected asset | Design weakness | Proposed control | How the control would be tested |
|---|---|---|---|
| **1. Broken object-level authorization (IDOR)** — one Guest reads/edits another Guest's booking or downpayment screenshot. *Asset:* booking PII + payment evidence. | Predictable record ids (`HDL-2026-0042`) invite probing; client-side route guards and hidden buttons are not authorization; a naïve "signed-in users may read bookings" rule would expose every guest's dates, phone and screenshot. | Server binds `guest_uid` to the authenticated caller at creation; guests read/update **only their own** records; the same ownership/role checks enforced at the data layer (Firestore rules / SQL grants); Storage confined to `payments/{uid}/**`; Admin access needs the Admin role **and** the Security PIN gate (PBKDF2) for lifecycle actions. | Rules unit tests in the emulator on every change (guest A's token must be denied on guest B's booking and proof path — pinned in CI); manual two-account probe of the reference lookup and direct document URLs; negative tests for Storage paths. |
| **2. Forged/replayed submission & last-unit double-booking** — a tampered client claims the final A-House unit or submits below the computed downpayment. *Asset:* booking inventory + rate/payment snapshot. | Trusting client-computed totals, dates or lead time; direct creates on `bookings`; check-then-act race so two Guests both hold the last unit. | Direct client creates closed by rules; every submission goes through `submitBooking`, which revalidates with server time (30-day lead, Asia/Manila), recomputes the quote from `site_config/rates`, requires the proof, and writes Pending booking + first audit event in **one transaction** serialized with `booking_inventory_locks`; parameterized/typed queries only; server-SDK-only writes. | Race test: two concurrent submits for the last unit → exactly one lands Pending, the other gets the explicit failure. Fuzz tests: tampered totals/lead-time payloads rejected or recomputed. Rules test: direct `addDoc(bookings)` by a Guest fails; snapshot tests pin the audit event per submission. |

## 5.2 Required drawing (Slide 14) — control-flow diagram

`Client app → (1) Firebase Auth verifies credentials, issues ID token → (2) submitBooking verifies the token (signature + expiry) — AUTHENTICATION ✓ → (3) Permission check: role + record ownership — AUTHORIZATION ✓ → (4) Validate + recompute (server time, availability, quote) → (5) one parameterized transaction: INSERT booking + proof + audit event → (6) Response (reference + Pending + hold expiry)`. A dashed red branch from the permission check leads to **DENY: 403 + audit_event(outcome='denied') — no DB write**. Order is strict: nothing reaches the database before both checkpoints.

## 5.3 Required audit specification (Slide 14)

One audit-event record (maps to `audit_events`): **event identifier** (UUID `evt_9c4f2a7e-…`) · **event time** (ISO-8601, stored UTC — `2026-11-06T13:05:41+08:00`) · **actor** (`uid g-8f21c4`, role `guest`, "Juan D.") · **action** (`booking.submitted`) · **affected record** (`bookings/HDL-2026-0042`) · **outcome** (`success`) · **request/reference id** (`req_01HQ7M3V9K2E`).

**Fictional sample event (on the slide):**
```
event_id:    evt_9c4f2a7e-6b31-4f2d-9a55-2f6c8b1d0e44
event_time:  2026-11-06 13:05:41 +08:00 (Asia/Manila)
actor:       guest g-8f21c4 ("Juan D.")
action:      booking.submitted
affected:    bookings/HDL-2026-0042
outcome:     success
request_id:  req_01HQ7M3V9K2E
```
Written in the **same transaction** as the booking; failed writes log `outcome=failure`; denied calls log `outcome=denied`.

**Who may review:** only the Admin role (read-only view), because events carry guest identifiers; an outside reviewer (e.g., the adviser during an audit) gets a read-only export or temporary read-only account — never write access.
**How unauthorized alteration is restricted** (the table is *not* automatically tamper-proof): append-only by rules/grants (INSERT only — update and delete denied for everyone, including the Admin, like the live `admin_security_events` trail); writes only inside server transactions that also write the event; daily export to a locked/immutable storage location.
**What must NOT be logged:** passwords/hashes, the Admin Security PIN or its hash, OTP codes, full bank/GCash account numbers (masked hints only), government-ID images/numbers, chat contents — and the downpayment screenshot itself (store the storage path + figures only; the image is payment evidence under the Data Privacy Act).

## 5.4 Authentication / Authorization / Database protection (Slide 15)

- **Authentication:** Firebase Auth (email link/password for Guests; Google for Admins); the ID token is verified server-side (signature, issuer, expiry) on every sensitive call; anonymous sessions are upgraded and bound to a durable uid at creation (ADR-0004); Admin lifecycle/money actions add the Security PIN gate (PBKDF2 + salt + lockout counters, ADR-0015).
- **Authorization:** exactly two roles in `profiles/{uid}`; Guests create bookings only through the callable and read/update only their own records; the reference lookup matches reference + the guest's own email; Admin permissions (review, verify, approve, publish rates, read access log) are enforced in the data layer — **a hidden button is a courtesy, never the control**.
- **Database protection:** least-privilege, parameterized access — only the Cloud Functions server SDK may write bookings and audit rows, all queries are typed/parameterized (prevents injection), TLS in transit + encryption at rest, restricted human access to production data; the relational mapping grants the app role INSERT-only on `audit_events` (no UPDATE/DELETE).

---

## Student self-check (mirrors the quiz checklist)

- [x] Name, approved title and date on Slide 1 (type the section before submitting)
- [x] Questions 1, 2, 4, 5 follow the same approved workflow (Submit a Booking with downpayment proof)
- [x] Input wireframe includes labels, actions, and an error state
- [x] Three accessibility decisions explained + implementation-testing caveat
- [x] Review and output screens support correction and clear feedback (no false approval claim)
- [x] Three UI/UX principles explained
- [x] Heuristic findings are observable problems with heuristics + severity
- [x] Manually reconstructed layout + proposed improvement (Finding 1)
- [x] Three-table schema with types, keys, relationships
- [x] Constraints (NOT NULL, UNIQUE, CHECK), deletion behavior, and a useful index
- [x] Forms/outputs map consistently to the schema
- [x] Authentication, authorization, and database protection addressed
- [x] Audit specification: actor, action, record, time, outcome + fictional sample
- [x] All drawings individually editable (native shapes/tables/connectors — no images)
- [x] Explanations included within the slides
- [ ] Verify instructor Editor access and submit before the closing time (student action)
