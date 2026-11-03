# DailyFlutterUI style guide — the Admin app's design reference

**Source.** The TikTok account `@dailyflutterui` (DailyFlutterUI, "App
Development — Premium Flutter Source Code", payhip.com/DailyFlutterUI) named in
the project recordings as the design benchmark ("Daily Flutter UI… gayahin yung
iOS consistency"). The sandbox cannot open TikTok (only GitHub/npm/PyPI are
reachable — the profile URL returns 403), so this guide is extracted from the
**owner-provided profile screenshot (2026-11-03)** showing the pinned videos,
cross-checked against the transcript quotes. Owner clarification 2026-11-03:
this benchmark is **accepted as the design reference when implementing the
Admin app**.

## What the pinned videos show

iPhone-mockup Flutter UIs with a consistent system:

- **Login / OTP screens** — centered logo/brand, large rounded input fields,
  a 6-box OTP code input with one box per digit, and a full-width pill primary
  button.
- **Dashboard screens** — dark navy header with greeting, a row of white stat
  tiles (value in large type, small caption, icon), then list cards.
- **List / detail screens** — white cards on a light background, 16 px corner
  radius, thin border instead of heavy shadow, avatar/icon tile on the left,
  status pill on the right.
- **Profile screens** — avatar header, name + handle, a stats row, then
  "Recently played"-style horizontal/vertical cards.
- **Bottom navigation** — simple icon tab bar, active tab tinted.

## Tokens as implemented in this app

| DailyFlutterUI pattern | Where it lives here |
|---|---|
| White card on light surface, radius ~16, thin border, no heavy shadow | `AppColors.cardBorder`, `AppColors.surfaceLight`; card pattern in `lib/views/smartlock/smart_lock_screen.dart` (`_buildCounterTile`, `_buildCardRegister`, `_buildLogCard`) |
| Stat tile: icon, big value, small caption | `_buildCounterTile` (Cinzel value, Inter caption) |
| Status pill (rounded-999, tinted background + colored label) | `_buildCardRegister` status pill; `lib/widgets/status_pill.dart` |
| Icon tile inside cards (rounded-12 tinted square) | `_buildCardRegister` icon tile |
| Headings in a display serif, body in Inter | `AppTheme.title` (Cinzel) + `GoogleFonts.inter` — already the house style (`docs/ACCOUNT.md` typography) |
| Pill primary buttons / FABs in the brand color | `AppColors.primaryForest` FABs on the Smart Lock screen |
| Filter strip as selectable chips | `AdminFilterStrip` on the Smart Lock screen |
| Empty states with icon + title + subtitle + retry | `lib/widgets/empty_state.dart` |
| Staggered entrance animation on list rows | `lib/widgets/staggered_entrance.dart` |

## Rules for new Admin-app screens

1. Cards: white, `BorderRadius.circular(16)`, `Border.all(cardBorder)` — never
   drop shadows over borders.
2. One accent color per state (success / alert / forest) used for icon tiles,
   pills and values; text stays `textDark` / `textMuted`.
3. Numbers use tabular figures (`FontFeature.tabularFigures()`).
4. Every list screen has an `EmptyState` with a retry, and rows animate in with
   `StaggeredEntrance` keyed by id.
5. OTP-style inputs: one rounded box per digit, centered, brand-colored focus.
6. Errors stay user-clean (input validation / generic network message only —
   MUST M1 from the recordings); never render backend exceptions.

## Applied in this change set (2026-11-03)

- Smart Lock screen: new **RFID card register** panel styled as a rounded card
  with icon tile + status pill (`ACTIVE (opens a room)` → `REVOKED (calling
  card)`), showing the live `rfid_cards/{cardUid}` payload — check-in key write
  and check-out souvenir rewrite are visible in the UI, not only in Firestore.
- Desk check-out simulation button added next to the RFID swipe simulator.

---

## Reference set 2 — guest booking UI (owner-provided screenshots, 2026-11-03)

Nine iPhone-mockup screenshots of a booking-app UI (explore home, services grid,
pro list, search bottom sheet with calendar + month dial + guest steppers, map
with price pills, listing detail with photo carousel + host card + amenities +
sticky Reserve bar, wishlists, trips, messages with filter chips, profile,
login sheet, payment-method radio list, confirm-and-pay breakdown, "You're
confirmed!" success screen). **Owner instruction: copy the UI structure, keep
the Hacienda's colors** ("just copy the ui, don't mind the colors") — applied to
**both the guest website and the Admin app**.

### Component map

| Reference pattern | Guest website (`src/`) | Admin app (`lib/`) |
|---|---|---|
| Search pill (icon circle + title + subtitle) | `Hero.tsx` "Start your search" pill → `#stay` | `SearchPill` in `lib/widgets/explore_ui.dart` |
| Category row with icon tiles + NEW badges | — (website uses top nav) | Dashboard quick actions → `ExploreCategoryRow` (Bookings / Chat / Stays / Smart lock [NEW] / More) |
| Listing card: media + badge pill + heart, title, ★ rating row, price line | `sections/Accommodations.tsx` cards: "Guest favorite" badge on Main House, heart, ★ `AIRBNB_RATING` row, `₱X / night` footer | `ListingCard` in `explore_ui.dart` |
| Section header with "See all ›" | `SceneHeader` (existing) | `SectionHeader` action (existing) |
| Sticky price + pill CTA bar | card footer Book button (existing) | `StickyActionBar` in `explore_ui.dart` |
| Radio option list (icon + label + radio) | — | `RadioOptionTile` in `explore_ui.dart` |
| Success check circle + headline + summary | `BookingStatusPage.tsx`: tinted check circle when a booking was just submitted | `SuccessCheck` in `explore_ui.dart` |
| NEW badge on category icon | — | `ExploreCategory.badge` (Smart lock = NEW) |

New shared icons: `Search`, `Heart` in `src/lib/icons.tsx`. Colors everywhere
remain forest/brass/cream (`AppColors` / `tailwind.config.js`) — the reference's
pink accent was deliberately not copied.

### Second pass (same day, owner re-sent the set)

- **Sticky mobile CTA on `/book`** (`src/pages/BookingPage.tsx`): fixed bottom
  bar (lg:hidden) with estimated total + "Magpatuloy" submitting `form#booking-form`
  — the reference's sticky Search/Reserve bar. Page container gets `pb-28 lg:pb-0`
  so the bar never covers the last field.
- **Payment plan choice** (`src/components/Booking/PaymentStep.tsx`) already
  matched the reference's radio-card list (border card + radio + label + sub-line);
  no change needed.
- **My Bookings stays a ledger** (`src/components/Account/StayEntry.tsx`) — the
  project deliberately chose the ledger over trip cards (see its doc comment);
  the reference's Trips screen was therefore *not* copied there on purpose.
- **Auth sheet** (`src/components/Auth/AuthShell.tsx`): `AuthFormPanel` now wears
  a rounded-[28px] white card with a **grip handle + X close** (reference's
  "Log in or sign up" bottom sheet), centered mode heading, and a
  Terms/Privacy footer row (`/legal`). Fields, pill submit (`btn-primary` is
  already `rounded-full`), the "or continue with" divider, and the Google row
  already matched the reference — untouched. `Close` icon reused from
  `src/lib/icons.tsx`.
- **Admin booking detail sticky bar** (`lib/views/bookings/booking_detail_screen.dart`):
  `bottomNavigationBar: _stickyBar(...)` — stay total + amount due on the left,
  the primary next action (Approve / Verify / Check-in / …) as the pill CTA on
  the right, disabled while busy; list gets extra bottom padding so the bar
  never covers the timeline. The reference's "$64 night · ★ 4.91 + [Reserve]".
- **Map with price pills on `/location`** (`src/sections/Location.tsx`, rendered by
  `src/pages/LocationPage.tsx`): the reference's map screen — the panel is now a
  stylised area map (cream/sage/forest SVG: Luisiana–Lucban Rd, town labels) with
  a brass **price pin** for the Hacienda (`from ₱1,000/night`, cheapest published
  `Accommodation.price`, links to `/stay`), tappable pins for the 6 `NEARBY` spots
  (popover card with photo + town + "Open in Google Maps"), a **spot-count pill**
  top-left ("6 spots around Luisiana · stays from ₱1,000/night" — the "Over 1,000
  places" badge), an **Area map / Google Maps toggle** top-right (the live Google
  embed stays mounted underneath), a floating address card on desktop, and a
  **listing card docked to the bottom edge on mobile** (photo, ★5.0 (9 reviews),
  Guest favorite badge, price/night, → `/stay`).
- **Mobile search bottom-sheet on `/book`** (`src/pages/BookingPage.tsx`): the
  reference's Where/When/Who sheet. On mobile the stay fields render inside a
  fixed bottom sheet (rounded-t-[28px], grip handle, X close, **Clear all** +
  **Maghanap · Search** footer) opened from a compact **search summary bar**
  (accommodation · dates · guests, Search icon). The same single-mounted fields
  stay inline on desktop via `lg:contents`; the guests field gains mobile-only
  **−/+ steppers**. Escape, focus trap and scroll lock come from the one shared
  `useOverlay` hook (`src/components/ui/overlay.ts`) — the design-system test
  forbids a second keydown/overlay implementation. Scrim is the Drawer-style
  `bg-forest-950/50 backdrop-blur-sm`, rendered after the sticky CTA bar so it
  dims that too. The existing mobile sticky total + Magpatuloy bar is unchanged.
- **Messages filter chips** (`src/pages/MessagesPage.tsx`): the reference's
  chip row above the inbox — **Lahat · All** / **Hindi pa nababasa · Unread**
  (with a brass count badge of total unread), active chip = forest pill,
  inactive = white outline pill. Combined with the existing search filter;
  empty state says "No unread messages right now" when the Unread chip is empty.
- **Confirm-and-pay breakdown** (`src/pages/DownpaymentPage.tsx`, "Buod ng
  Bayad" card): itemized rows — `₱nightlyRate × N nights` (with weekday/
  weekend-holiday + bracket sub-line), **Pet fee**, **Late checkout** when
  priced — then **Kabuuan ng stay (Stay total)**, **Babayaran Ngayon**
  (downpayment due now, hero figure), **Natitirang bayad sa check-in**
  (balance), and **Refundable security deposit** (separate). The reference's
  "You're confirmed!" success screen was already ported earlier
  (`BookingStatusPage.tsx`: success check circle, HDL confirmation code,
  summary + "Tingnan ang Aking Bookings" CTA).
