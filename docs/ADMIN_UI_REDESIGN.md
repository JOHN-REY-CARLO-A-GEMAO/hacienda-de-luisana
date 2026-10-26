# Admin app UI redesign — 2026-10-26

This pass applies the `frontend-design` skill to the **Flutter Admin app**
(`lib/`). The Guest website (`src/`) is a separate app and was not changed.

## Brief and audience

The app belongs to one Admin operating Hacienda de LuisAna, a private stay and
camping property in Luisiana, Laguna. Its job is to triage real bookings,
payments, stays, guest messages and door events quickly. The interface should
feel like a dependable estate operations record, not a generic SaaS dashboard.

## Design plan and critique

First-pass direction: warm cream canvas, forest ink, aged brass, Cinzel titles,
Inter operational copy, tabular numerals, a dark operations masthead and ruled
queue rows. Core palette: pine `#10271B`, forest `#1E3A2B`, paper `#F5F3EC`,
surface `#FFFEF9`, brass `#B88735`, sage `#E9EFE4`, with clay `#A43D31` for
blocked work and slate `#315A69` for in-progress stays.

The first version was too close to the skill's warned-about "editorial cream +
serif + warm accent" default. It was revised into a **field ledger**: one dark
pine masthead, brass reserved for state and the next decision, hairline rules
instead of identical soft-shadow cards, and Inter-dominant dense data. Cinzel
is used only for short titles and reference numerals. This is more specific to
a working hospitality operations record and more usable under time pressure.

Layout principle:

```text
phone                         tablet / landscape
┌──────────────────────┐      ┌────────────────────────────────────────┐
│ pine masthead        │      │ rail │ pine masthead                   │
│ real day + counts    │      │      ├───────────────┬────────────────┤
├──────────────────────┤      │      │ needs action  │ recent activity│
│ compact queue rows   │      │      │ ledger rows   │ ledger rows    │
│ recent activity      │      │      └───────────────┴────────────────┘
│ pine tab bar         │      └────────────────────────────────────────┘
└──────────────────────┘
```

All content is left aligned. Pages use a 16 dp gutter and a 1080 dp maximum
reading width. Status is always expressed in words first, then supported by
icon, shape and colour. Copy is sentence case and active voice. Non-user
motion is limited to a short fade; reduced-motion settings collapse it.

## What changed

- **Foundation:** one `AppTheme` token system for palette, type scale, spacing,
  radii, app bars, buttons, inputs, chips, dialogs, sheets, tooltips, progress,
  list tiles and navigation.
- **Shared primitives:** `AdminPageHeader`, `AdminFilterStrip`,
  `AdminFilterChip`, `AdminSectionHeading`, `AdminInlineNotice`,
  `AdminMetricTile`, `AdminInfoRow`, `AdminFormSection`,
  `AdminResponsiveColumns` and `AdminMastheadMetric` in `widgets/admin_ui.dart`.
- **Existing components:** cards, status pills, empty/loading states, section
  headings, metrics and progress were rebuilt around readable type, accessible
  semantics, hairline borders and consistent radii.
- **Dashboard:** real-count masthead, compact action queues, responsive
  two-column ledger, clearer door activity and actionable error states.
- **Bookings:** search field with clear action, count-bearing filter strip,
  advanced filter/sort sheet, result count, improved pagination, denser record
  cards and one clear primary action.
- **Navigation:** grouped More sheet, refined bottom bar, and a navigation rail
  at tablet/landscape widths. All destination indices and tour anchors remain.
- **Analytics:** gradient/all-caps dashboard replaced with one revenue panel,
  readable metrics, data-scaled stay bars and a responsive revenue split.
- **Forms and workflows:** sign-in and rates surfaces have clearer grouping,
  labels, validation notices and loading/error feedback. Room status uses a
  labelled select with explicit confirmation.
- **System feedback:** loading, empty, success, warning and error states were
  made explicit and announced to assistive technology where appropriate.
- **Accessibility:** stronger text contrast, sentence-case labels, 48 dp
  targets, semantic labels on icon-only controls, visible focus rings and
  reduced-motion behaviour.

## Functionality preserved

No backend, Firestore rules, authentication, PIN gate, pricing, booking
lifecycle, provider, route, API contract or permission logic was changed. The
security confirmation and PIN flows, quick actions, conversation lookup,
payment queue, refund workflow and guided-tour keys remain wired as before. No
mock business data or new runtime dependency was introduced.

## Verification note

The sandbox has no Flutter/Dart SDK, so `flutter analyze` and `flutter test`
cannot run here. All 79 Dart files under `lib/` were parsed with a Dart grammar
and all relative/package-local imports were resolved. Web type checking, web
unit tests and the production client build were also run; see the completion
report for exact results.
