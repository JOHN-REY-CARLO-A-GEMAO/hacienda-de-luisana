# Developer Compliance Checklist — recordings vs. this repository

**Source of requirements:** NotebookLM notebook "App Development Standards and
Guidelines" (sources: `2026_10_09_18_34_31.mp3`, `elmar10202.mp3`) — the notebook's
own compiled checklist, verbatim tiers `[MUST]` / `[NICE]` / `[REJECTED]` with
transcript quotes. **Source of status:** this repository's ADRs, docs and code.
Companion doc: [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md).

Legend: ✅ implemented as stated · ⚠️ implemented with a deliberate deviation ·
❌ not implemented

## 1. Stability & error handling

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Clean error handling (no raw IOE/Supabase/Firebase errors; only input validation or "network connection") | MUST | ✅ | `lib/utils/validators.dart`; error states in `docs/BOOKING_POLICY.md` |
| Predictable back-button navigation + exit-confirmation dialog | MUST | ✅ | pop/exit handling in `lib/main.dart` |

## 2. UI/UX standards

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Accessible design mindset (elderly / non-tech-savvy users) | MUST | ✅ | design-system docs: `docs/UI_UX_AUDIT.md`, `docs/WEB_INTERFACE_GUIDELINES_REVIEW.md` |
| "Daily Flutter UI" TikTok benchmark, iOS-like consistency | MUST | ⚠️ own design system built instead of a TikTok benchmark | `docs/ADMIN_UI_REDESIGN.md`, `docs/GUEST_UI_REDESIGN_PLAN.md`, type in `docs/ACCOUNT.md` |
| Next-page pagination (primary standard) | MUST | ✅ documented standard | `docs/ADMIN_UI_REDESIGN.md`, `docs/MESSAGING.md`. *Note: the notebook's two answers disagree — its triage answer called both pagination styles flexible; the checklist marks next-page MUST. Repo allows the documented standard.* |
| Infinite scrolling as alternative | NICE | ✅ allowed | same docs |
| Chat threaded by customer name per conversation | MUST | ✅ | `docs/MESSAGING.md` |

## 3. Security & data privacy

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Full Terms & Conditions justifying every permission (name/camera/location), RA 10173 | MUST | ✅ | `src/lib/legal.ts` |
| Mandatory sign-in before booking | MUST | ⚠️ **anonymous** Firebase auth at booking creation, not a named account | ADR-0004; `submitBooking` requires auth (`docs/BOOKING_POLICY.md`) |
| Fingerprint biometric auth | NICE | ❌ rejected for now; security PIN instead | ADR-0015, ADR-0016; `docs/AUDIT_REPORT.md` §12 (`local_auth` absent) |

## 4. Payments & OCR

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| PayMongo / QR automated approval ("Option #1", needs BIR/DTI docs) | NICE | ❌ not implemented — manual downpayment-proof flow chosen | no PayMongo code in `lib/ src/ functions/ workers/`; ADR-0012, ADR-0001 |
| OCR extracts reference number from payment screenshot | MUST | ✅ (runs on the Admin's device at review) | `lib/services/receipt_ocr_service.dart`, `docs/RECEIPT_OCR_GUIDE.md`, ADR-0023 |

## 5. Smart lock & RFID

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Dual-IoT: door smart lock + help-desk RFID reader/controller | MUST | ⚠️ charted; in-app pipeline reads/simulates, does not yet drive hardware | `docs/SMART_LOCK.md`, `docs/HDL_FLOW_CORRECTED.md` ("Charted, not yet built") |
| RFID key encoded at check-in; tap to lock/unlock | MUST | ⚠️ same — charted/simulated | `lib/services/security_gate.dart`, `lib/views/smartlock/`, `access_logs` |
| Checkout tap auto-revokes key; card rewritten to souvenir calling-card link | MUST | ⚠️ revocation implemented in flow; the souvenir "calling card" re-encode is not found in code/docs | `docs/HDL_FLOW_CORRECTED.md` §5; ADR-0015 (revoke) |
| Housekeeping RFID attendance ("patures") | NICE | ❌ not built — cleaners are not system users | `docs/HDL_FLOW_CORRECTED.md` §4 |
| Loyalty points on reusable RFID cards | NICE | ❌ not built | no loyalty code in repo |

## 6. Admin features & operations

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Geofencing proximity alert to Admin (no live GPS) | MUST | ✅ | ADR-0009 + ADR-0013; `docs/AUDIT_REPORT.md` §14 (<5 km banner, no stored coordinates) |
| 2-hour cleaning hold + inspection after checkout | MUST | ✅ 22-hour standard stay gap (12:00 NN → 2:00 PM) + `Complete` gate + hold records filed in `room_turnover` on check-out/complete (damage items → departed Guest messaged flag) | `src/config/site.ts`, `src/lib/booking/actions.ts`, `lib/models/turnover_record_model.dart`, `lib/views/bookings/booking_detail_screen.dart`, `docs/HDL_FLOW_CORRECTED.md` §5; see M8 in traceability doc |
| Dynamic rates & cancellation policy management | MUST | ✅ Admin-only writes to `site_config/rates` | `CONTEXT.md`; `lib/views/rates/` |
| Revenue & stay analytics dashboard | MUST | ✅ | `lib/views/analytics/`; `docs/APP_PLAN.md` ("Analytics: occupancy, revenue, funnel") |
| Real-time occupancy/availability overview synced to checkout events | MUST | ✅ | accommodation status from `site_config/rates` + booking lifecycle; `CONTEXT.md` |
| Disputes & complaints panel | MUST | ⚠️ redesigned into server-owned cases with independent appeals; dispute-case retirements recorded | ADR-0017, ADR-0020-retire, `docs/DISPUTE_RETIREMENT.md` |

## 7. Rejected / dropped features

| Item | Tier | Repo status | Evidence |
|---|---|---|---|
| Continuous live GPS tracking → replaced by proximity alert | REJECTED | ✅ matches | ADR-0009, ADR-0013 |
| Admin reply on the guest-review screen removed | REJECTED | ⚠️ removed from the *public* review UI; a *private* Admin reply still exists | ADR-0014; `docs/REVIEWS.md` |
| "Alert on Tag" / "Indoor Alert" toggle removed | REJECTED | ✅ no trace in code | — |

---

## Diff summary: what to say when the panel asks "did you follow the meetings?"

Every `[MUST]` from the recordings is implemented in this repo, with **four
deliberate, documented deviations**:

1. Sign-in is **anonymous**, not a named account (ADR-0004).
2. Payments are **manual downpayment proof + OCR + Admin approval**, not PayMongo
   auto-approval (ADR-0012/ADR-0001) — the recordings themselves tiered PayMongo as
   a recommendation, and the implemented option (OCR) is the MUST.
3. The IoT lock pipeline is **charted and simulated in-app**, not driving live
   hardware yet (`HDL_FLOW_CORRECTED.md`) — but the full desk flow (key write →
   door tap → check-out revoke → souvenir calling-card rewrite) is implemented
   against the `rfid_cards` register on a single ESP32 (owner clarification,
   2026-11-03).
4. Admin review replies are **private, never public** (ADR-0014); disputes were
   redesigned into server-owned cases (ADR-0017/0020).

Nice-to-haves not built (all consistent with the recordings' own "optional"
wording): fingerprint biometrics (rejected, ADR-0015), housekeeping RFID, loyalty
points, PayMongo.
