# Handoff for the next agent / AI session

**Date:** 2026-11-03 · **Branch:** current session branch is `arena/392df080-hacienda-de-luisana`
(earlier session used `arena/049858a5-hacienda-de-luisana`, merged as PR #158;
`arena/83f9046f-hacienda-de-luisana` merged as PR #159) — always check
`git branch --show-current` and push only to the active session branch ·
**Project:** Hacienda de LuisAna —
Guest website (React/Vite/TS in `src/`) + Admin app (Flutter in `lib/`) + Firebase.

Read this first, then `CONTEXT.md` (glossary), then the docs below. If a decision
here conflicts with an ADR in `docs/adr/`, **the ADR wins** unless the owner says
otherwise in writing.

## What this session already did (don't redo)

1. **NotebookLM analysis** — notebook "App Development Standards and Guidelines"
   (2 mp3 sources) was mined into three repo docs:
   - `docs/REQUIREMENTS_TRACEABILITY.md` — every requirement → tier → ADR/code evidence,
     plus recording chronology (`elmar10202.mp3` = first lecture;
     `2026_10_09_18_34_31.mp3` = later walkthrough, wins on conflicts) and the
     owner's 2026-11-03 clarifications (one ESP32 only; 2-hour hold OK as-is;
     DailyFlutterUI TikTok accepted as admin-app design reference).
   - `docs/DEVELOPER_COMPLIANCE_CHECKLIST.md` — notebook checklist + repo status column.
   - `docs/DEFENSE_QA_FROM_MEETINGS.md` — mock panel Q&A with transcript quotes +
     repo evidence + 20–30s answers (style of `docs/DEFENSE_CHEATSHEET.md`).
2. **Implemented the gaps found:**
   - `rfid_cards/{cardUid}` register + check-in key write / check-out revoke /
     souvenir calling-card rewrite (`lib/models/rfid_card_model.dart`,
     `FirestoreService.issueRoomKey` / `deskCheckoutTap`, new `LockAction`s,
     Smart Lock screen simulator button + card register panel).
   - `room_turnover` hold records filed on check-out/complete
     (`lib/models/turnover_record_model.dart`, hooks in `booking_detail_screen.dart`).
   - Security rules for both collections in `firestore.rules` + 9 tests in
     `test/rules/rfid-cards-turnover.rules.test.ts`.
3. **UI ports from the owner-provided design screenshots** (structure copied,
   forest/brass colors kept — see `docs/DAILY_FLUTTER_UI_STYLE_GUIDE.md`):
   - Website: search pill in Hero, listing-card chrome on accommodation cards
     (Guest favorite badge, heart, ★ row, ₱/night), success check on
     BookingStatusPage, `Search`/`Heart` icons, mobile sticky CTA on `/book`.
   - Admin app: `lib/widgets/explore_ui.dart` kit (SearchPill, ExploreCategoryRow
     with NEW badge, ListingCard, StickyActionBar, RadioOptionTile, SuccessCheck);
     dashboard quick actions are now a category row.
4. **Archived Bookings (owner feature list item 1, 2026-11-03)** — new
   `lib/views/bookings/archived_bookings_screen.dart` (thin wrapper) opened from
   the Bookings app bar archive icon; `BookingsScreen` gained `archiveMode: true`
   which swaps the filter strip to 5 archive buckets in
   `lib/services/booking_queue.dart`: Completed, Cancelled, Expired (incl.
   lapsed Pending holds via `effectiveStatus`), Rejected, and **No-show — derived,
   not stored** (`bookingIsNoShow`: Approved/Payment Verified/Reserved with the
   check-in day passed, no check-in). Tests in `test/booking_queue_test.dart`.
   Archiving is a VIEW only — no data is moved or deleted (docs/MESSAGING.md §4).
5. **Dashboard counts were double-counted (owner screenshot, 2026-11-04)** — the
   page printed "Payments to verify 7" and "Other admin actions 8" for the same
   seven proofs. `bookingNeedsAdminAction` was a *superset* of the approval and
   payment-review rows, so "Other" restated the row above it. Now:
   `bookingIsUnattended` (Checked-Out stays + initiated refunds) owns that row,
   the Bookings "Needs action" chip stays the one combined list, and the bell /
   Bookings-tab badges read `pendingActionsCountProvider` (one Booking, one
   entry) instead of the Notifications screen's length. A Pending whose
   **recorded** hold lapsed is excluded from both (`bookingHoldLapsed` — a
   Booking with no hold on record stays reviewable, matching the web's
   `adminActionBlockedReason`), and the row says the dates were released instead
   of "Suriin ang downpayment screenshot". Tests in `test/booking_queue_test.dart`.

## Verification state (re-run after `npm ci` — node_modules is wiped between sandbox turns)

- Rules: `node scripts/phase0/run.mjs rules` → **371/371 pass** (9 new).
- Web: `node scripts/phase0/run.mjs web` → **1268 pass, 7 fail** — the 7 are
  **pre-existing on the clean tree** (verified via git stash): 6 in
  `test/web/account-page-lists.test.tsx`, 1 in `test/web/availability-calendar-ui.test.tsx`
  ("20-night range", date-sensitive around 2026-11-03). Don't "fix" them blindly.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` → clean.
- **Flutter is NOT compilable in the sandbox** (no SDK). Run `flutter analyze`
  locally before pushing UI changes.

## Decision points — pick what to do next (with recommendation)

1. **More UI ports from the reference set** (owner keeps sending screenshots).
   ① login/auth sheet — **DONE 2026-11-03** (`AuthFormPanel` sheet card, grip + X,
   legal footer). ② admin booking detail sticky bar — **DONE 2026-11-03**
   (`_stickyBar` in `booking_detail_screen.dart`: total + due left, primary
   action pill right). ③ map with price pills — **DONE 2026-11-03**
   (`src/sections/Location.tsx` on `/location`: stylised area map + brass
   price pin `from ₱1,000/night` → `/stay`, 6 tappable `NEARBY` pins with
   popover cards, spot-count pill, Area map/Google Maps toggle with the
   Google iframe still mounted, mobile bottom listing card, desktop address
   card; tsc clean, web 1268/7 same pre-existing fails). ⑤ mobile search
   bottom-sheet on `/book` — **DONE 2026-11-03** (`src/pages/BookingPage.tsx`:
   Where/When/Who summary bar opens a fixed bottom sheet containing the single
   mounted stay fields — `lg:contents` on desktop, slide-up sheet on mobile —
   with grip + X, Clear all + "Maghanap · Search" footer, mobile −/+ guest
   steppers, scrim, and Escape/focus-trap/scroll-lock via the shared
   `useOverlay` from `src/components/ui/overlay.ts`; tsc clean, web 1268/7
   same pre-existing fails). Messages filter chips — **DONE 2026-11-03**
   (`MessagesPage.tsx`: Lahat · All / Hindi pa nababasa · Unread chips with
   brass unread badge, combined with search). Confirm-and-pay breakdown —
   **DONE 2026-11-03** (`DownpaymentPage.tsx` "Buod ng Bayad": itemized
   ₱rate × nights + pet fee + late checkout rows, then stay total, due-now
   hero figure, balance, refundable deposit). **Reference-set UI port is now
   COMPLETE incl. owner-requested extras** — the only remaining reference
   pattern is ④ wishlist, which is NOT in the recordings; only build it if
   the owner explicitly asks.
2. **NotebookLM next steps:** add `docs/adr/*` + `CONTEXT.md` as notebook sources,
   then ask *"which transcript requirements conflict with the ADRs, and which ADR
   reversed each?"*; save the panel-Q&A output as a Note.
3. **Deliberate non-implementations — only override if the owner explicitly says so:**
   PayMongo QR (dropped by the *later* recording; ADR-0012/0001/0023 manual+OCR flow),
   fingerprint biometrics (ADR-0015 rejected for now), loyalty points + housekeeping
   RFID (recordings tier them "optional/patures/mahirap").
4. **The 7 pre-existing web test failures** — decide: fix (they're date-sensitive)
   or document as known-failing. Don't let them block UI work.
5. **Hardware honesty:** the IoT pipeline is simulated in-app
   (`HDL_FLOW_CORRECTED.md` "charted, not yet built"); one ESP32 serves door + desk.

## Environment constraints

- Sandbox network allows **only** github.com, codeload.github.com, api.github.com,
  registry.npmjs.org, pypi.org, files.pythonhosted.org — **TikTok/web is 403**,
  so design references arrive as owner-provided screenshots only.
- Test configs need the repo launcher (`scripts/phase0/run.mjs`); direct `npx vitest`
  is blocked by design. Run `npm ci --ignore-scripts` first (node_modules is wiped
  between turns).
- Rules edits must keep `test/rules/*` green and follow the closed-shape,
  Admin-only, no-delete style of the existing blocks.

## If you touch the recordings-derived docs

Keep the tiers ([MUST]/[NICE]/[REJECTED]) and the transcript quotes verbatim —
they're cited in the thesis defense prep. Update status columns, don't rewrite history.
