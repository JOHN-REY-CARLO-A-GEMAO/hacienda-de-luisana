# UI/UX consistency & redundancy audit — Hacienda de LuisAna

**Date:** 22 October 2026
**Scope:** the whole product — the Guest website (`src/`) and the Admin app (`lib/`).
**Related:** [`AUDIT_REPORT.md`](AUDIT_REPORT.md) (architecture, security, IoT readiness),
[`FLUTTER_UI_UX.md`](FLUTTER_UI_UX.md) (the earlier Admin-app refresh),
[`CONTEXT.md`](../CONTEXT.md) (the vocabulary every label must use),
[`BOOKING_POLICY.md`](BOOKING_POLICY.md).

This pass had one goal: the two applications should read as one product, and no
screen should say the same thing twice or use two different controls for one job.
Nothing here changes a domain rule, a permission, or what a Booking does. Every
change is presentation, grouping, or the component a screen draws itself with —
except where noted as a defect (a wrong colour, a lost keyboard path).

---

## 1. Method

1. **Inventory first.** Every route in `src/App.tsx` and every screen under
   `lib/views/` was read before anything changed, along with the components each
   one mounts.
2. **Grep audits** for the things that drift quietly: raw colour utilities
   (`bg-amber-50`, `bg-red-50`, `text-red-800`), handwritten radii
   (`rounded-[28px]`, `rounded-3xl`) where a token exists, repeated button
   recipes (`btn bg-white border …`), local status maps (`switch (status)`),
   `text-xs` overriding a button's own size, and duplicate headings on one page.
3. **Test pins** were inventoried (`test/web/*`, `test/phase0/*`) so that copy
   guests and the Hacienda already rely on — and which tests assert — is not
   renamed for the sake of style. Where a test pinned a *defect*, the test was
   re-characterized and the reason recorded (§9).
4. **Limits.** No Flutter/Dart SDK in this environment: `lib/` changes were
   reviewed by inspection only, and are deliberately small and mechanical. No
   browser or Playwright either, so no screenshots were taken: this document
   describes structure and tokens, not pixel diffs.
5. **The rules were then written down as tests.** `test/web/design-system.test.ts`
   pins the six shapes that had already drifted (one `h1`, one container, button
   tokens, `Field`, `Alert`, one overlay). Running it found six more leaks than
   the manual sweep had, and they are fixed rather than exempted — see §9.2.

---

## 2. What exists

### 2.1 Guest website — 23 routes

| Route | Screen | Frame before | Frame now |
| --- | --- | --- | --- |
| `/` | `pages/Home.tsx` | 10 numbered scenes | unchanged (numbered scenes are the homepage's voice) |
| `/stay` | `StayPage` | `PageShell` | `PageShell` (shared sections, no scene numbers) |
| `/rates` | `RatesPage` | `PageShell` | `PageShell` |
| `/gallery` | `GalleryPage` | `PageShell` | `PageShell` |
| `/experience` | `ExperiencePage` | `PageShell` | `PageShell` |
| `/location` | `LocationPage` | `PageShell` | `PageShell` |
| `/reviews` | `ReviewsPage` | `PageShell` | `PageShell` |
| `/faqs` | `FaqPage` | `PageShell` | `PageShell` |
| `/house-rules` | `HouseRulesPage` | `PageShell` | `PageShell` |
| `/contact` | `ContactPage` | `PageShell` | `PageShell` |
| `/support` | `SupportPage` | handwritten, no page header | `Container` + `PageHeader` + `Card` |
| `/book` | `BookingPage` | handwritten header, local `Field` | `Container` + `PageHeader` + `FlowSteps` |
| `/book/pay` | `DownpaymentPage` | handwritten header | `Container` + `PageHeader` + `FlowSteps` |
| `/booking/status` | `BookingStatusPage` | card with a second status pill | `Container` + `PageHeader` + `StatusBadge` |
| `/account` | `AccountPage` | header + 3 hand-built stats + pill tabs + drawer | `PageHeader` + `StatCard` + `Tabs` + `Drawer` |
| `/messages` | `MessagesPage` | handwritten header, one-off thread panel | `Container` + `PageHeader` + `Card` |
| `/guest/auth` | `GuestAuthPage` | two `AuthShell`s, three headings | `AuthLayout` + one `AuthFormPanel` heading |
| `/login` | redirect | — | — |
| `/legal` | `LegalPage` | handwritten header | `Container` + `PageHeader` + `Card` + `Alert` |
| `/status` | `StatusPage` | handwritten header, two local tone maps | `Container` + `PageHeader` + `Alert` + `.data-table` |
| `/review` | `ReviewDeskPage` | handwritten header + guard | `PageHeader` + `Card` + `StatusBadge` + `MessageScreen` |
| `/admin/*`, `/app/*` | `AdminMoved` | handwritten | `MessageScreen` |
| `*` | `NotFound` | handwritten | `MessageScreen` |

Plus the frames that are not routes: `ErrorBoundary`, `ProtectedRoute` →
`TurnedAway`, and the in-page guards inside `/review` and `/account`.

### 2.2 Guest website — components

`Nav`, `Footer`, `Logo`, `SmartImage`, `TiltCard`, `ParallaxImage`,
`PageShell`, `Scene`, `ErrorBoundary`, `ConfirmDialog`, `Pager`, `Tutorial`
(`TourOverlay`, `TourProvider`), `OfficialChannelsNotice`,
`chat/ShareLocationBar`, `ContactInquiryForm`, `DisputeForm`, `ReviewForm`,
`Auth/*` (`AuthLayout`, `AuthFormPanel`, `LoginForm`, `LoginFormOnly`,
`RegisterForm`, `ResetPasswordForm`, `ProtectedRoute`), and
`Booking/*` (`AvailabilityCalendar`, `FlowSteps`, `HoldCountdown`,
`PaymentStep`, `PaymentInformationPanel`, `PaymentQrCode`, `BookingInvoice`,
`BookingHistory`, `StayRequestsSection`, `LateCheckoutRequest`).

### 2.3 Admin app — 27 screen files

`main.dart` → `AuthGate` → `AdminLoginScreen` → `PinGateScreen` →
`MainShellScreen`, which keeps ten destinations alive in an `IndexedStack`
(Dashboard, Bookings, Chat, Stays, Analytics, Smart Lock, Rooms, Guest CRM,
Rates, Payment references) with five in the bottom bar and the rest behind
"More". Pushed screens: booking detail, payment-verification queue, payment
proof viewer, refunds, invoice dialog, review list/detail, disputes, case
notifications, notifications, and the security sheets
(`pin_gate`, `setup_pin`, `forgot_pin`, `secure_action`).

Shared widgets already existed and were kept: `HaciendaCard`, `StatusPill`,
`EmptyState`, `SectionHeader`, `MetricStatCard`, `LuxeProgress`,
`AnimatedBadge`, `PressableCard`, `StaggeredEntrance`, `PulseDot`,
`BookingTimelineWidget`.

---

## 3. Findings

### F-01 — Two different components were both called `AuthShell`

`pages/AuthPage.tsx` declared its own `AuthShell` (the split-photograph frame)
while `components/Auth/AuthShell.tsx` also exported `AuthShell` (the form
panel). The page rendered an intro ("Sign in as Guest" + paragraph) and then
`LoginForm` rendered a second one ("Welcome back / Sign in" + paragraph): the
page said the same thing three times before the first field.

**Now:** `AuthLayout` owns the frame, `AuthFormPanel` owns the single `h1`, which
changes with the mode (sign in / create account / reset). The same panel is used
on `/guest/auth` and inside the gate in front of `/account`, so there is one
sign-in surface rather than two that could drift.

### F-02 — The booking status was drawn four ways, in three palettes

`AccountPage` had private `statusChip()`/`statusIcon()`; `BookingStatusPage`
had a private `statusCopy()` with its own tones; the invoice, hold countdown and
review entry each printed their own word for the same state. Worse,
`/booking/status` printed the status **twice** — an `h1` reading "Pending" and a
pill reading "Status: Pending" — and a Booking that had moved on to `Staying`
was still headlined "Pending".

**Now:** one `StatusBadge` with one tone map, one `statusMeaning()` sentence per
status, and one `statusHeadline()` for a page title. A page names the state once
and heads it with what the state means for the Guest; a list shows the badge
alone. The four tones are shared with the Admin app (§8).

### F-03 — Alert boxes were re-invented per page

Six amber boxes, five red and three green, differing in radius, border, padding
and whether they carried `role="alert"`. Several errors were silent to a screen
reader.

**Now:** one `Alert` with four tones and an `actions` slot; the `role` follows
the tone (a failure interrupts, guidance does not) and can be overridden when a
message describes standing evidence rather than a new event (the payment page's
reading of an uploaded receipt).

### F-04 — Two page-header systems in one application

Marketing sections used `SceneHeader` (with scene numbers); every real page
hand-wrote `eyebrow` + `<h1>` + lead with its own spacing. Mounted on `/stay` or
`/faqs`, a numbered section printed "05" for a section that was not the fifth
thing on the page, at a size *above* the page's own `h1`.

**Now:** `PageHeader` is the one page header (eyebrow, one `h1`, lead, actions,
secondary aside) and `PageShell` is built from it. `SceneHeader` keeps the
numbered treatment for the homepage through `SceneNumberingProvider`; anywhere
else it renders the same eyebrow + `h2` without a number, and its heading sizes
are capped below the page `h1`.

### F-05 — Four ways to draw a form field

`BookingPage` had a local `Field`; `AccountPage`, `LoginFormOnly`,
`BookingStatusPage` and `SupportPage` hand-wrote `<label><span class="label">`;
`DisputeForm` used bare label text; inputs mixed `field`, ad-hoc borders and
unstyled controls. Errors appeared above, below, or not at all.

**Now:** `Field` / `Input` / `Select` / `Textarea` / `CheckboxRow`, with label,
hint, error and `aria-invalid` decided once. Used by the booking, payment, auth,
registration, password-reset, profile, dispute, review, contact and support
forms.

### F-06 — The account page repeated the Guest's own identity

Header name/email; the same avatar, name and email again at the top of the
profile tab; three bordered stat cards in a third visual language; a dark
"next stay" panel repeating the first booking card; "Messages" beside a bell
that already led to messages; a second "Sign out" beside the nav's own; and a
drawer with no Escape key, no focus handling and no scroll lock.

**Now:** one header (name, email, member-since), `StatCard` ×3, one compact
"next stay" summary, a `Tabs` strip that is a real `tablist` with arrow keys,
and the shared `Drawer` (Escape, backdrop, focus trap, scroll lock). The
profile tab no longer repeats what the header already shows. Sign out sits once,
with the profile it signs out of.

### F-07 — Navigation offered the same destination twice

Desktop header: bell, avatar, a "My Profile" avatar link, a separate
"My Bookings" pill, and "Sign out". The avatar and the pill went to the same
page. The mobile drawer repeated "My Bookings", "My Profile" and "Notifications"
as three stacked buttons.

**Now:** one account control — avatar + "My bookings" (or "Admin account") — and
the notification bell. The drawer offers "My bookings & profile", "Notifications
(n)" and "Messages". The nav keeps its "Sign out"; the account page's duplicate
is gone.

### F-08 — Two closing invitations on every detail page

`/stay` ended with a "Ready to compare prices?" paragraph and then `PageShell`'s
own booking band; `/rates` restated its lead after the tables. The useful link
in each (booking lead time, booking rules) moved into the lead, where it is read
once; the closing band belongs to `PageShell` and appears once per page.

### F-09 — Every "nothing here / something broke / wrong place" screen was bespoke

404, the moved-Admin signpost, the turned-away notice, the review-desk guard and
the error boundary were five different centrings with different heading sizes
and different ways out.

**Now:** `MessageScreen` for dead ends (with one clear way on) and `EmptyState`
for every list — no bookings, no filtered results, no notifications, no pending
downpayments, nothing selected, no messages. `LoadingPanel`/`Spinner`/
`SkeletonLines` replace four private "Loading…" paragraphs.

### F-10 — `/support` did not look like the rest of the site

No page header, raw `border rounded-xl`, unlabelled inputs, button styles that
existed nowhere else, and three unrelated jobs (secure an identity, read case
notifications, open a case) stacked without hierarchy.

**Now:** `PageHeader`, one card per job in the order that unblocks the next,
`Field` inputs, `Alert` messages, `EmptyState` for the inbox. The dispute centre
keeps every string its tests assert.

### F-11 — Button sizes and states drifted

Buttons carried `text-xs` to override a `text-sm` default (36 occurrences), a
"quiet" button was re-spelled inline in four files, and destructive actions
borrowed `btn-ghost text-red-700`. In `ConfirmDialog` the two actions were
different heights — Cancel at `btn-sm`, the primary at full `btn`.

**Now:** `btn-sm`, `btn-quiet`, `btn-danger`, `btn-danger-quiet`, `icon-btn`,
and disabled handling on `.btn` itself. Two defects found while doing it:

- **`.btn-sm` was declared *before* the variants**, and every variant re-applies
  the `btn` base (including its 48px padding). So `btn-primary btn-sm` silently
  rendered full size. `btn-sm` now comes after the variants.
- A dialog's primary action re-spelled the whole button recipe inline, which is
  how it ended up a different height from Cancel beside it. Both now use tokens.

### F-12 — Duplicate and contradictory diagnostics on `/status`

The page printed the same heading, "If it says Demo mode", **twice**, with
overlapping Vercel instructions for two different variable sets, and used two
private tone maps (`STATE_TONE`, `CHECK_TONE`) that disagreed with the alert
palette used everywhere else. The verdict panels were hand-built tinted boxes.

**Now:** the verdict and the receipt-storage verdict are `Alert`s; the duplicate
section is merged into "If payment proofs do not arrive"; one tone vocabulary
drives both the setting badges and the connection checks; the settings table is
`.data-table`.

### F-13 — Footer information architecture and casing

The footer's link column mixed marketing pages with policies, and the same
destination was spelled two ways across header and footer ("Support &
Disputes" / "Support & disputes", "House Rules" / "House rules", "Rates &
Fees" / unlinked in the nav). Two empty-ish bands of padding sat above the
copyright.

**Now:** four columns — brand / Explore / Plan & policies / Get in touch — the
same label for the same destination in header, drawer and footer, sentence case
for multiword labels, and one tightened bottom bar.

### F-14 — Registration was the last form outside the design system

Eight hand-written label blocks, a `Clear`/`Show` button pair styled inline,
and errors rendered by a private helper. **Now:** `Field`/`Input`/`CheckboxRow`,
three grouped `fieldset`s ("Your name", "How the Hacienda reaches you",
"Securing your account") instead of five ad-hoc dividers, and the same error
placement as every other form. Every string and selector its tests use is
preserved.

### F-15 — Admin app: the same Booking status, two colours

`bookings_screen.dart` mapped the legacy `BookingStatus` enum; the detail screen
mapped the canonical status strings. `Approved` fell through the detail screen's
`switch` to the **error** colour, so an approved Booking could read red on its
own page while reading green in the list. Late-checkout, refund and room status
each had their own inline colour logic too.

**Now:** one `lib/core/theme/status_style.dart` (`color`, `colorForEnum`,
`lateCheckout`, `refund`, `room`, `payment`) used by the list, the detail page,
the payment queue, refunds and rooms. Colour is never the only signal — every
call site also prints the status in words.

### F-16 — Admin app: three display faces, one app

`app_theme.dart` set Cinzel for the app bar, but the login headline asked for
Cormorant and the reviews score for Playfair — three serifs in one product.

**Now:** `AppTheme.serif(...)` is the only display face; both strays use it.

---

## 4. The design system

### 4.1 Foundations (web)

Defined in `src/styles.css` and `tailwind.config.js`. The palette was already
right; the problem was pages bypassing it. No new hue was introduced.

| Layer | Token | Rule |
| --- | --- | --- |
| Display serif | Cormorant Garamond | page titles, section titles, card titles, large figures |
| Text | Inter | everything else |
| Eyebrow | `.eyebrow` — 11px, 0.28em, uppercase, `forest-600` | the line above a title |
| Page title | `.h1` — 36 → 48px, 1.05 | exactly one per page |
| Section title | `.h2` — 24 → 30px | one per section |
| Card title | `.h3` — 20px | one per card |
| Lead | `.prose-lead` — 14–16px, `forest-800/80`, 1.6 | the paragraph under a title |
| Data label | `.data-label` — 10px uppercase | above a date, a total, a reference |
| Link | `.text-link` — underline, 4px offset | in body copy only |
| Surface | `.card` (28px, white, hairline, `shadow-card`) | page-level panel |
| Inner block | `.card-tight` (16px, hairline, no shadow) | list rows, sub-panels |
| Quiet panel | `.panel-muted` (cream tint) | summaries inside a card |
| Radius | 28 panel · 16 inner · 12 field · 999 pill | nothing else |
| Button | `.btn` + `btn-primary` / `btn-quiet` / `btn-ghost` / `btn-danger` / `btn-danger-quiet`, size `btn-sm` | one primary action per page |
| Icon button | `.icon-btn` — 36px circle | bell, close, overflow |
| Field | `.field`, `.label`, `.field-hint`, `.field-error`, `[aria-invalid]` | one shape, one error position |
| Badge | `.badge` | booking status, counts |
| Alert | `.alert` + `alert-info` / `success` / `warning` / `danger` | every inline message |
| Table | `.data-table` | the two tables in the site |
| Motion | `ease-out-expo`, `prefers-reduced-motion` respected | marketing only |

**Rules the pages follow**

1. One `h1` per page, from `PageHeader`; sections use `h2`, cards `h3`.
2. A page picks one reading width: `form`, `narrow`, `content`, `wide`.
3. A page owns exactly one primary action; everything else is quiet or ghost.
4. Colour, radius, shadow and spacing come from the tables above, never from a
   page. A page-local hex or amber/red literal is a bug.
5. Marketing treatments (scene numbers, parallax, tilt) never appear on an
   application screen, and vice versa.

### 4.2 Shared components (`src/components/ui/`)

Import from the barrel: `import { Alert, PageHeader } from '../components/ui'`.

| Component | Replaces | Accessibility built in |
| --- | --- | --- |
| `PageHeader` | nine handwritten headers | one `h1`, consistent rhythm, actions row |
| `Container` | per-page max-widths | the four widths |
| `Card` | `rounded-[28px] … shadow-card` recipes | `as` for correct semantics |
| `Alert` | 14 tinted boxes | tone-driven `role`/`aria-live`, override available |
| `StatusBadge`, `StatusIconTile`, `statusHeadline`, `statusMeaning`, `statusTone` | `statusChip`, `statusIcon`, `statusCopy`, four palettes | `data-status` for tests and styling; label always in words |
| `EmptyState` | nine bespoke "nothing here" blocks | `compact` for inside a card |
| `LoadingPanel`, `Spinner`, `SkeletonLines` | four "Loading…" paragraphs | `role="status"`, live region |
| `Field`, `Input`, `Select`, `Textarea`, `CheckboxRow` | four field conventions | label association, `aria-invalid`, error announced |
| `Tabs` | pill buttons (account page) | `role="tablist"`, arrow keys, `aria-selected` |
| `Drawer`, `Modal` | account drawer, invoice modal | Escape, backdrop, focus trap + restore, scroll lock |
| `MessageScreen` | 404, moved admin, turned away, review guard | one `h1`, one clear way on |
| `StatCard` | three bordered stat tiles | label/value/icon pairing |

### 4.3 Information hierarchy

Every screen now answers, in this order:

```
global nav / app shell            (Nav, or the Admin shell + bottom bar)
page title + one line of context  (PageHeader: eyebrow, h1, lead)
the essential controls            (PageHeader actions, then the form/flow)
main content, by importance       (the list, the calendar, the queue)
secondary detail                  (history, disclosures, policies, invoice)
```

Applied to the surfaces that had drifted:

- **`/book`** — title, `FlowSteps` (step 1 of 3), stay details, your details,
  availability, submit. One primary action at the foot.
- **`/book/pay`** — title + step aside, how to pay (amount first), screenshot,
  submit; the quote and policy sit in an `aside` column.
- **`/booking/status`** — the meaning of the status is the `h1`, the badge names
  it, the next step follows, the record and history are secondary.
- **`/account`** — identity, three numbers, next stay, list; profile is a tab,
  not a second page.
- **`/support`** — sign in, then open/track, then read; each state has one card.
- **`/status`** — verdict, receipt verdict, evidence table, live checks, then
  what to do, at the bottom where it is only read when needed.
- **`/review`** — queue on the left (what to do next), decision on the right.
- **Admin** — dashboard numbers, then the queue that needs a decision, then
  everything else.

Two deliberate exceptions: the sign-in page (one column, one task, no page title
above the form's own) and the chat page (the conversation is the page; the
thread fills the column and the composer is pinned under it).

---

## 5. Redundancy: removed vs. kept

### Removed

| Removed | Where | Why |
| --- | --- | --- |
| Second and third heading before the first sign-in field | `/guest/auth` | same information, twice |
| "Messages" action beside the bell that already opens messages | `/account` header | duplicate action in one context |
| Duplicate "Sign out" | `/account` profile form vs. nav | one place to sign out |
| Duplicate avatar/"My Profile" link + "My Bookings" pill | `Nav` desktop | one account control |
| Duplicate "My Profile" drawer row | `Nav` mobile | same destination twice |
| Second closing CTA band | `/stay`, `/rates` | one invitation per page |
| Homepage tail sections re-mounted on detail pages | `/stay`, `/rates` | the same chip row and lead paragraphs |
| Second "If it says Demo mode" block | `/status` | duplicate heading, overlapping instructions |
| Second contact link + duplicate "Contact instead" | `/support` | the page already links to contact |
| Scene numbers on non-homepage sections | `/stay`, `/faqs`, … | numbers that meant nothing there |
| Section headings larger than the page title | all detail pages | inverted hierarchy |
| Three status palettes, four status renderings | account, status, invoice, review | one badge |
| `rounded-[28px]`/`shadow-card` one-offs | 18 files | the `.card` token |
| `text-xs` on buttons | 36 occurrences | `btn-sm` |
| Inline button recipes | invoice, dialog, nav | `btn-quiet` / `btn-danger` / `btn-sm` |

### Kept — on purpose

- **Status in both the list and the detail view.** Needed in both places; the
  component and palette are shared, and the detail view adds the sentence that
  explains it while the list shows only the badge.
- **The footer's sitemap.** Losing it would leave every page one navigation
  mistake from a dead end.
- **"Book your stay" in the header and at the foot of a page.** One is always
  available; the other closes an argument the page just made.
- **The "next stay" panel above the booking list.** It answers "what is coming"
  without reading the list; it no longer repeats the invoice, actions or contact.
- **The homepage's scene numbers.** They are the narrative there; suppressed
  everywhere else.
- **Booking lead time on the form.** Stated once, where it changes a decision;
  `/rates` links to it rather than keeping a second copy.
- **The tutorial's `data-tour` anchors.** They are the guided tour's contract.

---

## 6. Accessibility

None of this is new chrome; it is behaviour that used to live (or not) per page:

- A skip link to `main` is the first focusable element on every page.
- The account tabs are a `tablist` (arrow keys, `aria-selected`); they were
  buttons with an `aria-current` guess.
- The notification drawer and the invoice modal trap focus, restore it to the
  opener, close on Escape and on backdrop, and lock page scroll.
- Alerts announce themselves: `role="alert"` for a failure the person just
  caused, `role="status"` for standing guidance — the payment page's receipt
  reading used to compete with the submit error.
- Fields carry `aria-invalid`, an associated label and a single error position.
- The icon-only header controls have `aria-label`s; the account control's label
  names both destinations it now covers.
- Colour is never the only signal: status pills print the status, connection
  checks print a word and a mark, badges carry counts in text.
- `prefers-reduced-motion` disables the marketing motion layer, and the Admin
  app's motion is paint-only (transforms/opacity).

---

## 7. Responsive behaviour

- Page headers stack their actions below the title on small screens instead of
  squeezing them beside it (`PageHeader`).
- The account stat row is 3-up from `sm`, 1-up below; the booking card's
  `dl` is 2-up on phones, 4-up from `sm`.
- Filters (search / status / sort) are a 3-column row on desktop and a stack on
  phones; they are real inputs, not a custom dropdown.
- Tables are the only place horizontal scrolling is acceptable, and only one
  page has one.
- The Admin app keeps its 2-column metric grid but the shell is
  `LayoutBuilder`-friendly; wider layouts are a follow-up (§10).

---

## 8. Admin app parity

Shared with the website: status vocabulary and grouping, success/pending/
in-progress/closed semantics, and a single display face.

| Concern | One source of truth |
| --- | --- |
| Booking status colour | `lib/core/theme/status_style.dart` → `status(color)` / `colorForEnum` |
| Late-checkout / refund / room status | same file → `lateCheckout`, `refund`, `room` |
| Payment state | same file → `payment` |
| Display serif | `AppTheme.serif(...)` (Cinzel) |
| Ink/surface tokens | `AppColors` (ops) and `AppTheme.forest900…cream200` (brand), radii `radiusCard/Panel/Field/Pill` |
| Card, empty state, section header, metric, progress, timeline | `lib/widgets/*` |

The web `StatusBadge` and the Dart `StatusStyle` deliberately use the same four
groups so a Booking does not change colour when it crosses from the Admin app to
the Guest's phone.

---

## 9. Verification

Everything below was run against the working tree this document describes.
Where a gate could not run, it says so instead of assuming a pass.

### 9.1 Gates and results

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc -b` (also `npm run lint`) | clean, no errors |
| Production build | `npx vite build` | ✓ built in 5.18 s — 316 modules, only the pre-existing chunk-size and dynamic-import warnings |
| Web test suite | `node scripts/phase0/run.mjs web` | **73 files, 1004 tests, all passing** |
| Typecheck gate | `node scripts/phase0/run.mjs typecheck` | OK |
| Safety rules | `node scripts/phase0/run.mjs safety` | **44 pass / 0 fail / 0 skipped / 0 todo** |
| Characterization | `node scripts/phase0/run.mjs characterization` | **13 failed / 89 passed — identical to the baseline measured from a clean worktree at `626d935`**, so this pass changed no characterized behaviour. The 13 are the pinned pre-existing findings (byte-identical source hashes, the mobile-simulator contract, the supplemental rules evaluator), not the UI. |
| Invariants | `node scripts/phase0/run.mjs invariants` | **21 failed / 10 passed — identical to that same clean-worktree baseline** (verified by running the suite in a throwaway `git worktree` at the unmodified commit, then removing it). |
| Flutter | — | **not compiled: no Dart/Flutter SDK in this environment.** One new file and mechanical colour/import edits; brace balance and imports checked by script. Static inspection only — see §8 and §9.4. |
| Rendered screens | — | **not verified: no browser or Playwright in this environment, so no screenshots were produced.** Every layout claim here is from source, not from pixels. |

The dev server is not part of the evidence: it was used while working, but a
compile without errors is not a visual check.

### 9.2 The new invariant test — `test/web/design-system.test.ts`

The audit's rules were enforced by hand and had already drifted, so six of them
are now assertions over the source (73 new tests, all passing):

| Rule | What it caught when first run |
| --- | --- |
| no page writes its own `<h1>` | 0 offenders after the `PageHeader` migration |
| no page/section hand-rolls a centred container | **21 `mx-auto max-w-*` wrappers in 19 `src/sections/*.tsx`**, all now `<Container width>` |
| no re-spelled `btn` recipes | **8 call-sites** re-deriving `btn bg-*` / `text-xs` sizing, now `btn-primary` / `btn-on-dark` / `btn-lg` / `btn-sm`; `grep 'className="btn bg-'` in `src` is empty |
| inline messages use `Alert` | **14 tinted `<div>`s** in `HoldCountdown`, `PaymentInformationPanel`, `AvailabilityCalendar`, `PaymentStep`, `LateCheckoutRequest`, now `<Alert tone>` |
| form controls use `Field`/`Input`/`Select`/`Textarea` | still 3 files — see §9.4 |
| exactly one overlay implementation | `Gallery` lightbox and `PaymentQrCode`'s enlarged QR moved from private Escape/scroll-lock/focus code onto `useOverlay`; `ConfirmDialog`, `Drawer`, `Modal`, invoice all share it |
| every `ui/` export is consumed | `export`-only additions were flagged and are now either used or excluded by name (types, `WIDTHS`, `useOverlay`) |

Two findings the test produced were **defects in the rule, not the code**, and are
narrowed with a comment rather than deleted:

- `MessageScreen`'s own `mx-auto max-w-lg` is the component that owns that
  centring; `Nav`'s is inside a ternary string, not JSX.
- `Nav`'s Escape handler closes a disclosure (no trap, no backdrop), `Gallery`
  keeps only arrow keys, and `TourOverlay` drives a script — none is a second
  overlay implementation.

`ErrorBoundary` was **not** exempted: its bespoke `max-w-lg` card with a
`font-serif text-3xl` heading was migrated onto `MessageScreen` (same pinned
strings, `tone="danger"`), which also removed the last hand-built whole-screen
message. `AuthShell`'s heading is deliberately the section token (`.h2`) — one
task in one column — and is asserted as such.

### 9.3 What this pass changed, by area

| Area | Change |
| --- | --- |
| Page frame | `PageShell` + `Page` own the frame; 22 marketing sections moved onto `Container`; `styles.css` holds the vertical rhythm (`.section`, `-roomy`, `-full`, `-tight`) |
| Headings | one `h1` per page via `PageHeader` / `MessageScreen` / `AuthShell`; section headings use `.h2`/`.h3` |
| Buttons | `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-on-dark`, `btn-lg`, `btn-sm`; `.btn-sm` declared **last** so size wins over variant |
| Alerts | `Alert` with `tone`, `role`, `actions`; 18 consumer files |
| Fields | `Field`, `Input`, `Select`, `Textarea`, `CheckboxRow`; 15 / 12 / 8 / 4 / 1 consumers |
| Loading, empty, error | `LoadingPanel`, `Spinner`, `SkeletonLines`, `EmptyState`, `MessageScreen` |
| Flutter | `status_style.dart` centralises the status pill; `AppColors.alertDanger*` replaces ad-hoc red panels; `Colors.redAccent` now appears once |

### 9.4 Remaining inconsistencies — found, not fixed

These are real and are listed so the document is not read as "done".

| Remaining | Evidence | Why it was left |
| --- | --- | --- |
| **Two table styles** | `StatusPage` uses `.data-table`; `BookingInvoice` uses `w-full text-xs text-left` | the invoice is a printable document, the status table is a settings audit — a shared table would need a second variant, which is a design decision, not a sweep |
| **Raw controls outside `ui/`** | 13 raw `<input>` in 4 files: `Booking/PaymentStep.tsx` (6: radio, checkbox, file), `ReviewForm.tsx` (3 + 1 raw `<textarea className="field text-sm">`), `DisputeForm.tsx` (1 file), `DownpaymentPage.tsx` (3: file drop, amount radios, off-receipt checkbox) | these are file pickers, star ratings and radio rows — no primitive exists for them yet, and inventing four new primitives at the end of a pass is how the last round of drift started. New follow-up §10.6. |
| **`AuthShell` heading size** | `<h1 className="h2 mt-2">` | deliberate: a sign-in task, one column, no page hero |
| **Section rhythm vs. one-off spacing** | sections use `.section*`; a handful of `py-*` remain inside cards | card-internal spacing is compositional, not page rhythm |
| **No rendered verification** | no browser, no screenshots | see §9.1 |
| **Flutter not compiled** | no SDK | see §8, §9.1 |

Not claimed: that every page is consistent, that the visual result was seen, or
that the admin app was verified. What is claimed: every gate above ran with the
result stated, and the remaining gaps are enumerated.

## 10. Follow-ups this pass did not take

1. **Flutter page scaffolding.** Each Admin screen builds its own `AppBar`
   (23 of them), padding and scroll container. An `AdminPageScaffold`
   (title, optional action, consistent list padding) would remove ~20 copies —
   best done with the SDK available so `flutter analyze` gates it.
2. **Admin design-language reconciliation.** `app_theme.dart` still carries two
   token families (`AppColors` ops palette and the brand `forest/cream` set).
   They agree today but are one edit from drifting; one palette with named
   semantics would finish F-15/F-16.
3. **`DisputeForm` case detail.** The outer panel and the report form are on the
   design system; the expanded case view still uses raw borders and small
   headings.
4. **`/review` desktop split.** The queue/decision two-column layout is right;
   its selected-row styling uses the card token but could use a dedicated
   `SelectableRow` if a second screen needs one.
5. **Bundling.** `vite build` warns about >500 kB chunks (Firebase + app).
   Route-level `lazy()` would improve first paint; unrelated to visuals.
6. **File, radio and rating controls.** `PaymentStep`, `DownpaymentPage`,
   `DisputeForm` and `ReviewForm` still hand-roll a file drop zone, radio rows and
   star buttons (13 `<input>` elements). A `FileField` and a `ChoiceRow` in
   `src/components/ui/` would finish F-05; each needs its own keyboard and
   screen-reader contract, so it is a component task, not a class swap.
7. **Visual regression coverage.** The suite asserts text and structure, not
   layout. A screenshot baseline per route would catch spacing drift that unit
   tests cannot — and would have caught the `.btn-sm` ordering defect
   automatically.
