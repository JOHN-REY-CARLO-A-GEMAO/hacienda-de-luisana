# Requirements Traceability: meeting recordings vs. implementation

**Purpose.** Maps every technical requirement discussed in the two project meeting
recordings (`2026_10_09_18_34_31.mp3`, `elmar10202.mp3`, summarized in NotebookLM
notebook "App Development Standards and Guidelines") to the decision records and code
that implement, amend, or reject it. Use this to defend "we followed the requirements"
in the thesis, and to show *why* a requirement looks different in the final system.

**Tiers** (as stated by the speakers in the recordings):

- **Must-have** — strict evaluation criterion or legal/operational necessity.
- **Nice-to-have** — recommended option, but developers were given flexibility.
- **Rejected / changed** — explicitly discarded or modified during discussion.

---

## 1. Must-haves

| # | Requirement (from recordings) | Status in repo | Evidence |
|---|---|---|---|
| M1 | Clean error handling — never show raw backend/framework/DB exceptions (IOE, Supabase, Firebase permission-denied, raw registration errors); only input validation or generic "network connection" messages | ✅ Implemented | `lib/utils/validators.dart`; error states in `docs/BOOKING_POLICY.md` ("permission failures, network failures… never represented as Available"; Refresh/retry offered) |
| M2 | UI/UX design standard with iOS-like consistency ("Daily Flutter UI" benchmark); front-end polish determines system valuation | ✅ Implemented as own design system | `docs/UI_UX_AUDIT.md`, `docs/WEB_INTERFACE_GUIDELINES_REVIEW.md`, `docs/ADMIN_UI_REDESIGN.md`, `docs/GUEST_UI_REDESIGN_PLAN.md` (Cormorant Garamond type per `docs/ACCOUNT.md`) |
| M3 | Back button returns to home (no crash / no forced re-login); explicit exit-confirmation dialog before closing | ✅ Implemented | Pop/exit handling in `lib/main.dart`; booking lifecycle guards in `lib/services/booking_lifecycle.dart` |
| M4 | Full Terms & Conditions justifying every requested permission/input (name, camera, location); one-sentence placeholders violate data privacy (RA 10173) | ✅ Implemented | `src/lib/legal.ts`; privacy copy in `docs/ACCOUNT.md` |
| M5 | OCR extracts the transaction reference number from an uploaded payment screenshot | ✅ Implemented (on the Admin's device at review time) | `lib/services/receipt_ocr_service.dart`, `lib/models/receipt_extraction.dart`, `docs/RECEIPT_OCR_GUIDE.md`, ADR-0023 |
| M6 | Sign-in required before booking / accessing accommodation features | ⚠️ Implemented as **anonymous** auth, not a named account | `submitBooking` callable requires Firebase auth and binds uid (`docs/BOOKING_POLICY.md`); website signs the Guest in anonymously at `/book` creation — ADR-0004 |
| M7 | Dual-IoT architecture: smart lock at the door + RFID reader/controller at the help desk; key written to RFID card at check-in, revoked at checkout | ✅ Implemented | `docs/SMART_LOCK.md`, `docs/HDL_FLOW_CORRECTED.md`, `lib/views/smartlock/smart_lock_screen.dart`, `lib/services/security_gate.dart`, `lib/models/smart_lock_event_model.dart` |
| M8 | 2-hour cleaning hold after checkout: automatic checkout notification to Admin, room held, inspected (missing/damaged items → message the departed Guest), cleaned, then released for the next Guest | ✅ Implemented as the standard-stay turnover window + a cleaning/inspection gate + filed hold records (no literal 2-hour timer; owner confirmed the window is fine as-is, 2026-11-03) | Check-out 12:00 NN → next check-in 2:00 PM = the 2-hour gap (`src/config/site.ts`); `Complete` gated on cleaning/inspection (`src/lib/booking/actions.ts`, `lib/services/booking_lifecycle.dart`); hold records filed on check-out/complete in `room_turnover` (`lib/models/turnover_record_model.dart`, `FirestoreService.fileTurnoverRecord`, hooks in `lib/views/bookings/booking_detail_screen.dart`); flow in `docs/HDL_FLOW_CORRECTED.md` §5 |

## 2. Nice-to-haves (recommendations, flexible)

| # | Suggestion (from recordings) | Status in repo | Evidence |
|---|---|---|---|
| N1 | PayMongo / QR payment with automatic approval ("Option #1"), OCR screenshot parsing as Option #2; heavy BIR/DTI documentation noted | ❌ Not implemented — OCR + manual Admin approval chosen instead | No PayMongo code in `lib/ src/ functions/ workers/`; ADR-0012 (downpayment proof before Pending), ADR-0001 (manual verification) |
| N2 | Pagination: "Next Page" preferred, infinite scroll allowed | ✅ Standard documented | `docs/ADMIN_UI_REDESIGN.md`, `docs/MESSAGING.md` |
| N3 | Fingerprint biometric unlock as an upgrade over security PIN | ❌ Not implemented — explicitly rejected for now | `docs/AUDIT_REPORT.md` §12 ("Missing", `local_auth` not in `pubspec.yaml`); ADR-0015 ("Biometrics — rejected for now"); PIN used via `lib/services/pin_store.dart` |
| N4 | Housekeeping RFID attendance (cleaners tap cards at door to log cleaning) — called a "cool feature" | ❌ Not implemented — cleaners are not system users; Admin records cleaning outcome | `docs/HDL_FLOW_CORRECTED.md` §4; cleaning status in `src/lib/booking/actions.ts`, `src/config/site.ts` |
| N5 | Loyalty points stored on reusable RFID cards (flagged as hard) | ❌ Not implemented | No loyalty code anywhere in `lib/ src/ docs/` |

## 3. Rejected / changed during discussion

| # | Recording decision | Status in repo | Evidence |
|---|---|---|---|
| R1 | Live GPS tracking rejected → replaced by geofencing proximity alert to Admin when a booked Guest enters the property range | ✅ Matches — tracking removed; proximity banner (< 5 km) on Admin dashboard, no coordinates stored | ADR-0009 (module removed), ADR-0013 (opt-in ephemeral stream, max 1 h), `docs/AUDIT_REPORT.md` §14, `src/hooks/useLiveLocation.ts`, `src/lib/liveLocationPolicy.ts` |
| R2 | Admin reply inside the guest-review screen ordered removed | ⚠️ Implemented as **private** Admin reply, never public | `docs/REVIEWS.md` (Admin may write a reply; `public_reviews` cannot contain a uid, Booking, or private reply); ADR-0014 |
| R3 | "Alert on Tag" / "Indoor Alert" settings toggle called useless and ordered removed | ✅ Removed — no trace in code | No `alertOnTag`/indoor-alert toggle in `lib/ src/` |

---

## Owner clarifications (2026-11-03)

Given directly by the project owner while reviewing this doc:

1. **One ESP32 only.** The smart lock is a single ESP32 that serves both the
   door and the desk tap; the recordings' "dalawang IoT" is one device in two
   roles, not two boards.
2. **The 2-hour post-checkout window is accepted as-is** — implemented via the
   22-hour standard stay (12:00 NN checkout → 2:00 PM next check-in) plus the
   `Complete` gate, no literal timer needed.
3. **"Daily Flutter UI" (TikTok @dailyflutterui) is accepted as the design
   reference for the Admin app** — iOS-like consistency, clean cards, applied
   when implementing/fetching data in the Admin app. Extracted into
   [DAILY_FLUTTER_UI_STYLE_GUIDE.md](DAILY_FLUTTER_UI_STYLE_GUIDE.md) from the
   owner-provided profile screenshot (the sandbox cannot open TikTok — only
   GitHub/npm/PyPI are reachable). First applied on the Smart Lock screen's new
   RFID card register panel.

## Recording chronology and requirement evolution

The two sources are ordered: **`elmar10202.mp3` is the first recording** (initial
classroom lecture — general guidelines, grading rubrics, UI standards, legal terms,
baseline requirements) and **`2026_10_09_18_34_31.mp3` is the later one**
(timestamped 2026-10-09 18:34 — hands-on walkthrough/review of the live build where
features are refined, trimmed, or modified in practice). Where the two disagree,
the later recording wins:

| Topic | First (`elmar10202.mp3`) | Later (`2026_10_09_18_34_31.mp3`) | Repo follows |
|---|---|---|---|
| Payments | PayMongo QR = top recommendation, automatic approval | PayMongo dropped from active enforcement; manual reference logs + OCR ("Search ang putik. Hirap. Daming number ng reference ah.") | ✅ later: downpayment proof + OCR + manual Admin approval (ADR-0012, ADR-0001, ADR-0023) |
| Location | justify location collection in privacy terms | live GPS explicitly rejected → proximity range alert only | ✅ later: ADR-0009 + ADR-0013, proximity banner, no stored coordinates |
| Review replies | polished UI per iOS/Daily-Flutter standard | Admin reply on review screen ordered removed ("Tanggalin mo 'yan") | ⚠️ removed from public UI; private Admin reply kept (ADR-0014) |
| "Alert on Tag" / Indoor Alert toggle | thorough security settings advised | toggle called useless, ordered removed | ✅ removed (no code trace) |
| Auth | basic sign-in / error handling rules | PIN softened → upgrade to fingerprint biometrics suggested | ❌ suggestion NOT adopted — biometrics rejected for now, PIN kept (ADR-0015, ADR-0016) |

## Divergences to be ready to explain (recording vs. final system)

1. **Payments:** not a deviation — the *later* recording moved away from PayMongo to
   manual reference logs + OCR, and that is exactly what the repo builds: downpayment
   screenshot + OCR reference extraction + manual Admin approval (ADR-0012, ADR-0001,
   ADR-0023). PayMongo remains unimplemented because the later instruction dropped it.
2. **Sign-in:** "must sign in before booking" is satisfied by **anonymous** Firebase
   auth attached at booking creation (ADR-0004), not a named email/password account.
3. **Admin review replies:** removed from the *public* review UI but kept as a
   *private* Admin response (ADR-0014, `docs/REVIEWS.md`).
4. **Biometrics:** suggested as an upgrade; explicitly rejected for now (ADR-0015),
   security PIN remains (ADR-0015, with the reset proved by an emailed code — ADR-0027).
5. **Housekeeping RFID & loyalty points:** both nice-to-haves; neither implemented.
6. **IoT hardware:** the lock pipeline is charted and **simulated in-app**, not driving
   live hardware (`HDL_FLOW_CORRECTED.md`); the check-in key write, check-out revoke,
   and souvenir calling-card rewrite are implemented against the `rfid_cards` register.
   Hardware is **one ESP32** serving door + desk tap (owner clarification above).

## Resolved open items

- **2-hour cleaning hold** (recording `2026_10_09_18_34_31.mp3` only; `elmar10202.mp3`
  never mentions app cleaning): realized as the gap between standard 12:00 NN
  check-out and 2:00 PM next-day check-in (the "22-hour standard stay"), enforced by
  the `Complete` lifecycle gate requiring cleaning + inspection to have passed, with
  each pass filed in `room_turnover`. See M8 above.
- **Souvenir calling-card rewrite** (previously no code trace): implemented —
  `FirestoreService.deskCheckoutTap` revokes the key and rewrites the card payload to
  `https://haciendadeluisana.com` (`rfid_cards/{cardUid}`, `payloadKind: landing_link`),
  logging `key_revoked` + `card_rewritten` to `access_logs`.

## Sources

- NotebookLM notebook "App Development Standards and Guidelines" (2 sources:
  `2026_10_09_18_34_31.mp3`, `elmar10202.mp3`) — requirement wording and tier triage.
- This repository: `docs/adr/*`, `CONTEXT.md`, `docs/AUDIT_REPORT.md`, and the files
  cited above — implementation evidence.
