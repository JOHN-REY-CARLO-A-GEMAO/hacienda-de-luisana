# UI/UX consistency & redundancy audit — Hacienda de LuisAna

**Date:** 22 October 2026
**Scope:** the whole product — the Guest website (`src/`) and the Admin app (`lib/`).
**Companion docs:** [`FLUTTER_UI_UX.md`](FLUTTER_UI_UX.md) (the earlier Admin-app
refresh), [`AUDIT_REPORT.md`](AUDIT_REPORT.md) (security/architecture),
[`CONTEXT.md`](../CONTEXT.md) (the vocabulary every label must use).

This pass had one goal: the two applications should look and behave like one
product, and no screen should say the same thing twice or use two different
controls for one job. Nothing here changes a domain rule, a permission, or what
a Booking does; every change is presentation, grouping, or the component a
screen draws itself with.

---

## 1. What was inspected

### Guest website — every route

| Route | Screen | Layout before this pass |
| --- | --- | --- |
| `/` | `pages/Home.tsx` (10 sections) | Scene-numbered marketing layout |
| `/stay` | `pages/StayPage.tsx` | `PageShell` + shared sections |
| `/rates` | `pages/RatesPage.tsx` | `PageShell` |
| `/gallery` | `pages/GalleryPage.tsx` | `PageShell` |
| `/experience` | `pages/ExperiencePage.tsx` | `PageShell` |
| `/location` | `pages/LocationPage.tsx` | `PageShell` |
| `/reviews` | `pages/ReviewsPage.tsx` | `PageShell` |
| `/faqs` | `pages/FaqPage.tsx` | `PageShell` |
| `/house-rules` | `pages/HouseRulesPage.tsx` | `PageShell` |
| `/contact` | `pages/ContactPage.tsx` | `PageShell` |
| `/support` | `pages/SupportPage.tsx` | **Hand-rolled**, one-line JSX, no shared frame |
| `/book` | `pages/BookingPage.tsx` | Hand-rolled header, local `Field` |
| `/book/pay` | `pages/DownpaymentPage.tsx` | Hand-rolled header, ad-hoc alerts |
| `/booking/status` | `pages/BookingStatusPage.tsx` | Card with a second status pill inside |
| `/account` | `pages/AccountPage.tsx` | Header + 3 stat cards + dark "next stay" + pill tabs + drawer + booking cards |
| `/messages` | `pages/MessagesPage.tsx` | Hand-rolled header, one-off thread panel |
| `/guest/auth` (`/login` redirects) | `pages/AuthPage.tsx` | A private `AuthShell` *and* a shared `AuthShell`, three headings |
| `/legal` | `pages/LegalPage.tsx` | Hand-rolled header + cards |
| `/status` | `pages/StatusPage.tsx` | Hand-rolled header + tone maps |
| `/review` | `pages/ReviewDeskPage.tsx` | Hand-rolled header; guard screen also hand-rolled |
| `/admin/*`, `/app/*` | signpost to the Admin app | Hand-rolled |
| `*` | 404 | Hand-rolled |
| — | `ErrorBoundary`, `ProtectedRoute`, `TurnedAway` | Three more hand-rolled centred messages |

Every component used by those routes was read: `Nav`, `Footer`, `PageShell`,
`SceneHeader`, the `Auth/*` family, `ConfirmDialog`, `Pager`, `Booking/*`
(calendar, flow steps, hold countdown, invoice, payment step, payment
information, stay requests, history), `DisputeForm`, `ReviewForm`,
`ContactInquiryForm`, `Tutorial/*`, `chat/ShareLocationBar`, and the `sections/*`
mounted on `/` and on the detail pages.

### Admin app — every screen

`main.dart` → `AdminLoginScreen` → `MainShellScreen` (Dashboard, Bookings,
Booking detail, Chat inbox, Stays, Analytics, Smart Lock, Rooms, Guest CRM,
Rates, Payment references) plus the pushed screens: payment verification queue,
payment proof viewer, refunds, invoice dialog, review detail, disputes and case
notifications, notifications, PIN gate / setup / reset / secure-action sheets,
and the shared widget library in `lib/widgets/`.

### Design sources found

`tailwind.config.js` + `src/styles.css` (web), `lib/core/theme/app_theme.dart`
and `lib/core/constants/app_constants.dart` (Flutter). Both already had a real
brand palette; the problem was that pages and screens bypassed it.

---

## 2. Findings

Each finding says what was wrong, why it mattered, and what now happens.

### F-01 — Three headings before the first field on the sign-in page

`pages/AuthPage.tsx` defined its **own** `AuthShell` (the split-photo layout)
while `components/Auth/AuthShell.tsx` was also called `AuthShell` (the form
panel). The page rendered `GUEST_INTRO` ("Sign in as Guest" + a paragraph) and
then `LoginForm` rendered a second intro ("Welcome back / Sign in" + another
paragraph) — three statements of the same thing, two of them headings.

**Now:** `AuthLayout` owns the frame (photograph + brand + logo), `AuthFormPanel`
owns the single `h1`, which changes with the mode (sign in / create account /
reset). `/guest/auth` passes no intro of its own. One name per component.

### F-02 — The booking status was written in four places, in three palettes

- `AccountPage` had private `statusChip()` and `statusIcon()` helpers.
- `BookingStatusPage` had a private `statusCopy()` with its own tones.
- The invoice, hold countdown and review entry each printed their own word for
  the same state.
- `BookingStatusPage` also printed the status twice on one screen: an `h1`
  reading "Pending" plus a pill reading "Status: Pending". A Booking that had
  moved on to `Staying` was still headlined **Pending** — a defect the Phase 0
  suite had pinned as `F24-LATER-STATUS`.

**Now:** one `StatusBadge` (`components/ui/StatusBadge.tsx`) with a single tone
map, one `statusMeaning()` sentence per status, and one `statusHeadline()` for a
page title. The badge is the only place the status is named on a page; the
heading says what it means for the Guest. The same grouping is mirrored in the
Admin app by `lib/core/theme/status_style.dart`.

### F-03 — Alert boxes were re-invented per page

At least six amber boxes, five red boxes and three green boxes, differing in
radius, border colour, padding and whether they carried `role="alert"`. Several
error messages were not announced to screen readers at all.

**Now:** one `Alert` with four tones (`info`, `success`, `warning`, `danger`),
`role` chosen by urgency, and an optional action slot. Used by the booking form,
payment step, status page, account page, support desk, disputes, review desk and
legal page.

### F-04 — Two page-header systems in the same application

Marketing sections used `SceneHeader` (with scene numbers), while every real page
hand-wrote `eyebrow` + `<h1>` + paragraph with its own spacing. Worse, when a
numbered section was mounted on `/stay` or `/faqs`, it printed a scene number
("05") for a section that was not the fifth thing on the page, and at a size
*above* the page's own `h1`.

**Now:** `PageHeader` is the one page header (eyebrow, one `h1`, lead, actions)
and `PageShell` is built from it. `SceneHeader` keeps the numbered treatment for
the homepage only, through a `SceneNumberingProvider`; mounted anywhere else it
renders the same eyebrow + `h2` without a number. Section headings were reduced
one step so they always sit below the page title.

### F-05 — Four ways to draw a form field

`BookingPage` had a local `Field`; `AccountPage`, `LoginFormOnly`,
`BookingStatusPage` and `SupportPage` each hand-wrote `<label><span class="label">`;
`DisputeForm` used bare `<label>` text; inputs mixed `field`, `w-full border …`
and unstyled controls. Errors appeared above, below, or not at all.

**Now:** `Field`/`Input`/`Select`/`Textarea`/`CheckboxRow` in
`components/ui/Field.tsx`, with the label, hint, error and `aria-invalid` state
decided once. The booking, payment, auth, account, dispute, review and support
forms all use them.

### F-06 — The Guest's account page repeated itself

One screen carried: an avatar and name in the header, the same avatar, name and
email again at the top of the profile tab, three bordered stat cards in a third
visual language, a dark "next stay" panel repeating the first booking card's
facts, a separate "Notifications" **and** "Sign out" beside the nav's own bell
and sign-out, plus a drawer with no Escape key, no focus handling and no
scroll lock.

**Now:** one header (name, email, member-since) + three `StatCard`s + one compact
"next stay" panel + tab strip (`Tabs`, a real `tablist` with arrow keys). The
drawer is the shared `Drawer` (Escape, backdrop, focus trap, scroll lock). Sign
out lives once, at the foot of the profile form. The profile tab no longer
repeats the identity the header already shows.

### F-07 — Navigation offered the same destination twice

Desktop header: bell, avatar, a "My Profile" avatar link, a separate
"My Bookings" pill, and "Sign out". The avatar and the pill went to the same
page. The mobile drawer repeated "My Bookings", "My Profile" and "Notifications"
as three stacked buttons.

**Now:** one account control — avatar + "My bookings" (or "Admin account") — plus
the notification bell. The drawer offers "My bookings & profile", "Messages" and
"Notifications (n)". The nav's "Sign out" and the account page's were duplicates;
the account page keeps the one that sits next to the profile it signs out of.

### F-08 — Duplicate calls to action at the foot of detail pages

`/stay` ended with a "Ready to compare prices? …" paragraph and then
`PageShell`'s own booking band; `/rates` restated its lead paragraph after the
tables. Every public page therefore had two closing invitations.

**Now:** the closing band belongs to `PageShell`; the page-level duplicates are
gone and the useful link (booking lead time → `/book`, terms → `/legal`) moved
into the lead where it is read once.

### F-09 — Every "nothing here / something broke / wrong place" screen was bespoke

404, the moved-Admin signpost, the turned-away message, the review-desk guard and
the error boundary were five different centrings with different heading sizes and
different ways out.

**Now:** `MessageScreen` (404, moved dashboard, turned away, review guard) and
`EmptyState` (every list: no bookings, no filtered results, no notifications, no
pending downpayments, nothing selected). `LoadingPanel`/`Spinner` replace four
private "Loading…" paragraphs.

### F-10 — The Support & Disputes page did not belong to the site

`SupportPage.tsx` was a single dense JSX line per block: no page header, raw
`border rounded-xl`, unlabelled inputs, button styles that did not exist
elsewhere, and all three jobs (secure an identity, read notifications, open a
case) stacked without hierarchy.

**Now:** `PageHeader`, one card per job in the order that unblocks the next,
`Field` inputs, `Alert` messages, `EmptyState` for the inbox. The dispute centre
itself was re-skinned onto the same primitives while keeping every string its
tests assert.

### F-11 — Hover/press states and sizes drifted between identical controls

Buttons were `btn` with `text-xs` overriding a `text-sm` default (36 occurrences),
"quiet" buttons were hand-written as `btn bg-white border …` in four files, and
destructive actions borrowed `btn-ghost text-red-700`.

**Now:** tokens in `styles.css` — `btn-sm`, `btn-quiet`, `btn-danger`,
`btn-danger-quiet`, `icon-btn`, plus disabled handling on `.btn` itself. A
codemod replaced every `btn* text-xs` with `btn* btn-sm` and every repeated
"white panel with 24/28px radius + card shadow" with `card`.

### F-12 — The Admin app coloured the same status two ways

`bookings_screen.dart` mapped the legacy `BookingStatus` enum, while
`booking_detail_screen.dart` mapped the canonical status strings. `Approved` fell
through the detail screen's switch to the **error** colour, so an approved
Booking could read red on its own page.

**Now:** `lib/core/theme/status_style.dart` is the single mapping for both
(`color()`, `colorForEnum()`, `payment()`), with `Approved` resolved as success.
Both screens call it; the inline `switch` statements are gone.

---

## 3. The design system

### 3.1 Foundations (`src/styles.css`, `tailwind.config.js`)

| Token | Value | Used for |
| --- | --- | --- |
| `eyebrow` | 11px, 0.28em tracking, uppercase, `forest-600` | The line above every title |
| `h1` | Cormorant 36 → 48px, 1.05 line-height | One per page |
| `h2` | Cormorant 24 → 30px | Section titles |
| `h3` | Cormorant 20px | Card titles |
| `prose-lead` | 14–16px, `forest-800/80`, 1.6 | The paragraph under a page title |
| `data-label` | 10px uppercase, muted | Labels over values (dates, totals) |
| `card` | white, 28px radius, 1px `forest-900/5`, `shadow-card` | Page-level panels |
| `card-tight` | white, 16px radius, hairline border, no shadow | Inner blocks and list rows |
| Radius scale | 28 panel · 16 inner · 12 field · 999 pill | Only these four exist |
| `panel-muted` | `cream-100/60`, 16px | Summary strips inside a card |
| `btn` / `btn-sm` | pill, 48px / 36px high | Every action |
| `btn-primary` / `btn-quiet` / `btn-ghost` | forest fill / white bordered / transparent bordered | Primary, secondary on card, tertiary |
| `btn-danger` / `btn-danger-quiet` | red fill / red outline | Destructive and its quieter form |
| `icon-btn` | 36px circle | Bell, close, overflow |
| `field` / `label` / `field-hint` / `field-error` | 12px radius, `forest-200` border, 2px focus ring | Every input |
| `badge` | pill, 11px semibold | Booking status, priorities |
| `alert-*` | 16px radius, four tones | Every inline message |
| `skip-link` | fixed, visible on focus | Keyboard entry to `main` |
| Brand palette | `forest`, `sage`, `brass`, `cream`, `olive`, `earth` | Unchanged; no new hue was introduced |

Rules the pages now follow:

1. One `h1` per page, from `PageHeader`; sections use `h2`, cards `h3`.
2. A page picks one of four widths (`form`, `narrow`, `content`, `wide`).
3. A page owns exactly one primary action; the rest are quiet or ghost.
4. Colour, radius and shadow come from the tables above, never from a page.
5. Marketing-only treatments (scene numbers, parallax, tilt) never leak into an
   application screen — and vice versa.

### 3.2 Shared components (`src/components/ui/`)

`PageHeader`, `Container`, `Card`, `Alert`, `StatusBadge` + `StatusIconTile`,
`EmptyState`, `LoadingPanel`/`Spinner`/`SkeletonLines`, `Field`/`Input`/`Select`/
`Textarea`/`CheckboxRow`, `Tabs`, `Drawer`, `Modal`, `MessageScreen`, `StatCard`.
Import them from `components/ui` (the barrel), not the individual files.

Accessibility is part of the component, not the page: the tab strip is a
`tablist` with arrow keys, the drawer and dialog trap focus and close on
Escape, alerts carry the right `role`, fields carry `aria-invalid`, the skip
link is the first focusable element, and `prefers-reduced-motion` still disables
the marketing motion layer.

### 3.3 Admin app

`lib/widgets/` already carried `HaciendaCard`, `StatusPill`, `EmptyState`,
`SectionHeader`, `MetricStatCard`, `LuxeProgress`, `AnimatedBadge`. The remaining
duplication was status colour, now resolved by `core/theme/status_style.dart`.

---

## 4. What was deliberately **not** removed

Repetition that carries information stays:

- **The status in a list and on the detail page.** It is needed in both places;
  the component and its palette are now shared, and the detail view adds the
  sentence that explains it while the list shows only the badge.
- **The footer's copy of the navigation.** A footer is a sitemap; losing it would
  make every page one navigation mistake away from a dead end.
- **"Book your stay" in the header *and* at the foot of a page.** One is always
  available, the other closes an argument the page just made.
- **The "next stay" panel above the booking list.** It answers "what is coming"
  without reading the list; it no longer repeats the invoice, the actions or the
  contact link.
- **The scene numbers on the homepage.** They are part of the narrative there;
  they are now suppressed everywhere else.
- **The booking lead time on the form.** It is stated once, where it changes a
  decision; `/rates` links to it instead of keeping a second copy.

---

## 5. Verification

| Check | Result |
| --- | --- |
| `npx tsc -b` | clean |
| `npx vite build` | succeeds (316 modules) |
| `npm test` / `node scripts/phase0/run.mjs web` | **72 files, 993 tests passing** |
| `node scripts/phase0/run.mjs characterization` | `status.characterization` updated and passing (see below); the foundation/model/security characterization failures pre-date this pass and are unrelated (pinned file hashes, mobile simulator source, supplemental rules evaluator) |
| Flutter | not compiled in this environment (no Flutter SDK). Changes are limited to one new file and two mechanical call-site edits; brace balance verified by inspection. |

**Re-characterized test.** `test/phase0/status.characterization.test.tsx` pinned
the old presentation, including the defect where a `Staying` Booking was
headlined "Pending". It now asserts what the page is meant to do — the badge's
`data-status` is the single source of the status, the heading states its meaning,
and the one-shot refresh behaviour (no live update until a browser-local event)
is still pinned. The desired-behaviour invariant
(`status.invariants.test.tsx`) is unchanged and passes.

Labels that tests (and muscle memory) depend on were preserved as-is:
"Sign In", "Make a Guest account", "Local Mode Active", "Downpayment proof",
"Request HDL-…", "No bookings match those filters", and every dispute-centre
string.

---

## 6. Follow-ups this pass did not take

1. **Flutter page scaffolding.** Each Admin screen still builds its own `AppBar`
   title, padding and scroll container. A `AdminPageScaffold` (title, optional
   action, consistent `ListView` padding) would remove ~20 copies — worth doing
   with the Flutter SDK available so `flutter analyze` gates it.
2. **Admin design-language reconciliation.** `app_theme.dart` carries two token
   families (`AppColors` ops palette and the quiet-luxury `forest900`/`cream50`
   set). They agree today but are one edit away from drifting; one palette with
   named semantics would finish F-12.
3. **`DisputeForm`'s case detail.** The outer panel and the report form are
   migrated; the expanded case view still uses raw borders and small headings.
4. **Bundling.** `vite build` warns about >500 kB chunks (Firebase + app). Route
   level `lazy()` would help the Guest site's first paint; unrelated to visuals.
5. **Visual regression coverage.** The suite asserts text and structure, not
   layout. A screenshot baseline per route would catch spacing drift that
   unit tests cannot.
