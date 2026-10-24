# Web Interface Guidelines — review of the Guest website

**Date:** 23 October 2026
**Scope:** the Guest website only — `src/**/*.tsx`, `src/styles.css`, `index.html`.
**Rules:** [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (`command.md`, fetched at review time).
**Not in scope:** the Flutter Admin app (`lib/`), domain/policy copy, test pins.

The site is unusually compliant already: one `h1` per page (`PageHeader`), one container, one
`Field`/`Alert`/`Drawer`/`ConfirmDialog`, a real tablist, a focus trap shared by every overlay,
`Intl.*` for money and dates, empty states everywhere, `prefers-reduced-motion` honoured in CSS,
`aria-live` on the async regions that had been thought about. What follows is what is left.

---

## Trip-wire summary (fix in this order)

1. `src/components/ui/Field.tsx:41` — errors/hints aren't tied to the control (`aria-describedby`), and `aria-invalid` is opt-in per call site. Every form inherits it.
2. `src/styles.css:6` + `index.html:19` — `color-scheme: light dark` wins over the inline `light`, so native controls and scrollbars go dark on a light page.
3. 13 × `transition-all` — the one anti-pattern the codebase still repeats everywhere.
4. `src/sections/FAQ.tsx:42` — collapsed answers stay in the accessibility tree and are read aloud.
5. `src/pages/ReviewDeskPage.tsx:248` — "Approve downpayment" commits an irreversible decision on one click, no ConfirmDialog.
6. `index.html:7` — `theme-color` doesn't match the page background; `index.html` has no LCP image preload.

---

## index.html

```
index.html:7 - theme-color #243b26 vs page background #FAF7F2 (line 15) → browser chrome dark on a cream page
index.html:19 - inline color-scheme: light, but src/styles.css:6 sets "light dark" and wins → native selects, date pickers, scrollbars go dark under an OS dark theme
index.html:52 - no <link rel="preload" as="image"> for the hero LCP image (/images/gmaps/img-07.jpg, sections/Hero.tsx:37) → discovered only after the JS bundle
index.html:5 - viewport-fit=cover set but no safe-area inset reaches the fixed header (Nav.tsx:99); .pt-safe/.pb-safe (styles.css:214-215) are defined and never used
```

## src/styles.css

```
src/styles.css:92 - transition-all (card-surface) → list properties
src/styles.css:126 - transition-all (.btn) → colour, background, box-shadow, transform
src/styles.css:6 - color-scheme: light dark on a light-only brand (index.html says light) → pick one
src/styles.css:9 - no overscroll-behavior / touch-action: manipulation / -webkit-tap-highlight-color anywhere → double-tap-zoom delay on every control; page rubber-bands behind overlays
src/styles.css:100 - .h1/.h2 lack text-wrap: balance → widows on the long serif page titles
```

## src/components/ui/Field.tsx

```
src/components/ui/Field.tsx:41 - error/hint spans have no id and no control wires aria-describedby → screen readers announce the error as loose text, not as the field's description
src/components/ui/Field.tsx:54 - aria-invalid only when a caller passes `invalid`; most pass `error` alone (e.g. pages/BookingPage.tsx:590) → invalid fields aren't reported as invalid
src/components/ui/Field.tsx:54 - controls carried through have no `name` (Input/Select/Textarea) → add at call sites, autocomplete is already correct
```

## src/components/ui/Tabs.tsx

```
src/components/ui/Tabs.tsx:53 - tabs set aria-selected/aria-controls-less → add aria-controls; panels (pages/AccountPage.tsx:403, :479) need role="tabpanel" + aria-labelledby
src/components/ui/Tabs.tsx:40 - only ←/→ handled; Home/End missing from the tablist contract (minor)
```

## src/pages/AccountPage.tsx

```
src/pages/AccountPage.tsx:396 - tab selection never written back to the URL (read once at :98) → back/forward and shared links lose the tab
src/pages/AccountPage.tsx:517 - search box state not in the URL
src/pages/AccountPage.tsx:459 - date of birth input lacks autoComplete="bday"
src/components/Pager.tsx:21 - page/page-size not in the URL
```

## src/components/Nav.tsx

```
src/components/Nav.tsx:104 - transition-all → transition-[background-color,border-color,box-shadow]
src/components/Nav.tsx:111 - transition-all → transition-[height]
src/components/Nav.tsx:99 - fixed inset-x-0 top-0, no env(safe-area-inset-top) → bar can sit under a notch/status area
```

## src/sections/FAQ.tsx

```
src/sections/FAQ.tsx:41 - transition-all
src/sections/FAQ.tsx:42 - collapsed answer is grid-rows-[0fr] opacity-0 only → still in the a11y tree, still read aloud, still selectable. Use hidden/inert (or visibility) when closed
src/sections/FAQ.tsx:33 - trigger has aria-expanded but no aria-controls + panel id
```

## src/pages/ReviewDeskPage.tsx

```
src/pages/ReviewDeskPage.tsx:249 - "Approve downpayment" is irreversible and fires on one click → ConfirmDialog (the site already has one) or an undo window
src/pages/ReviewDeskPage.tsx:217 - proof <img> has no width/height → the card jumps when the screenshot loads
src/pages/ReviewDeskPage.tsx:139 - raw ISO dates "{check_in} → {check_out}" instead of the site's Intl formatter (lib/formatDate.ts)
```

## src/pages/DownpaymentPage.tsx

```
src/pages/DownpaymentPage.tsx:530 - <input type="file" class="sr-only"> inside a label with no focus-within ring → invisible keyboard focus on the control that gates submission
src/pages/DownpaymentPage.tsx:543 - preview <img> has no width/height
src/pages/DownpaymentPage.tsx:619 - reference placeholder "GCash / Maya / bank ref" neither ends with "…" nor shows an example pattern (minor)
```

## src/pages/BookingPage.tsx

```
src/pages/BookingPage.tsx:697 - submit disabled whenever the calendar isn't ready or availability isn't "available"; the reason lives in alerts far above → keep it enabled and focus/announce the blocker on click
src/pages/BookingPage.tsx:742 - price without tabular-nums (side panel re-renders as guests/date change)
```

## src/pages/MessagesPage.tsx

```
src/pages/MessagesPage.tsx:228 - live conversation has no role="log"/aria-live → an Admin reply is never announced
src/pages/MessagesPage.tsx:152 - scrollIntoView({behavior:'smooth'}) ignores prefers-reduced-motion (styles.css:325 only resets CSS scroll-behavior)
```

## src/pages/SupportPage.tsx

```
src/pages/SupportPage.tsx:174 - submit disabled until password ≥12 chars → guideline: stay enabled, validate on submit, focus the first error
src/pages/SupportPage.tsx:177 - no reason shown next to the disabled button
```

## src/components/Booking/PaymentStep.tsx

```
src/components/Booking/PaymentStep.tsx:429 - focus:outline-none focus:ring-2 → ring on mouse click; use focus-visible
src/components/Booking/PaymentStep.tsx:452 - same (amount field)
src/components/Booking/PaymentStep.tsx:390 - candidate-amount radios sit in a plain label list with no fieldset/legend → group them
```

## src/components/Booking/LateCheckoutRequest.tsx

```
src/components/Booking/LateCheckoutRequest.tsx:106 - "(Until {12 + h}:00 PM)" prints 13:00 PM … 18:00 PM → 12-hour wrap (h=1 → 1:00 PM); also 24-hour "12:00 PM" vs "Until 6:00 PM" mixed on one label
src/components/Booking/LateCheckoutRequest.tsx:112 - toLocaleString() with no locale (every other figure passes 'en-PH')
```

## src/components/Booking/BookingInvoice.tsx

```
src/components/Booking/BookingInvoice.tsx:92 - <th> without scope="col"; no <caption>; header cells left-aligned against right-aligned money columns
src/components/Booking/BookingInvoice.tsx:67 - date formatted inline here rather than through lib/formatDate.ts
```

## src/sections/Gallery.tsx

```
src/sections/Gallery.tsx:92 - transition-all
src/sections/Gallery.tsx:70 - category filter is local state only (not in the URL, no aria-pressed) → a filtered gallery can't be linked or restored
src/sections/Gallery.tsx:167 - lightbox <img> has no width/height → reflow when the photo arrives
```

## src/sections/Reviews.tsx

```
src/sections/Reviews.tsx:238 - transition-all
src/sections/Reviews.tsx:250 - aria-label on a <div> with no role="img" → star rating is silent to AT (StayReviewCard at :209 does it correctly)
```

## src/pages/StatusPage.tsx

```
src/pages/StatusPage.tsx:141 - config table has no <caption>/scope on <th> (minor)
```

## Other transition-all sites

```
src/components/Tutorial.tsx:48
src/tutorial/TourOverlay.tsx:270
src/sections/ContactDetails.tsx:104
src/sections/Nearby.tsx:33
src/sections/StayPreview.tsx:74
src/sections/GalleryPreview.tsx:51
```

## Smaller items

```
src/App.tsx:61 - smooth hash scroll ignores prefers-reduced-motion (same in tutorial/TourEngine.tsx:152-153, TourOverlay.tsx:167)
src/components/ui/Drawer.tsx:64 - drawer body scroll lacks overscroll-behavior: contain (Nav.tsx:278 has it)
src/components/DisputeForm.tsx:324 - window.confirm for "Accept proposal" while the site owns a styled ConfirmDialog
src/components/ui/StatCard.tsx:31 - large metric number without tabular-nums
src/components/Auth/AuthShell.tsx:31 - decorative <img> with no width/height (fixed-height parent, so low impact)
src/components/ConfirmDialog.tsx:86 - busy state says "Working…"; site convention elsewhere is the verb ("Saving…", "Cancelling…")
```

---

## ✓ Pass — nothing to flag

```
src/components/Booking/AvailabilityCalendar.tsx   role=grid, aria-busy, per-day aria-labels, aria-pressed, live status region, keyboard-safe buttons
src/components/ui/overlay.ts                      Escape, focus trap, focus restore, scroll lock, all correct
src/components/ConfirmDialog.tsx                  alertdialog, labelled + described, Escape = cancel, initial focus on confirm
src/components/ui/Drawer.tsx                      dialog semantics, labelled, close button aria-labelled
src/components/ui/Alert.tsx                       role/aria-live chosen from tone, override documented
src/components/ui/EmptyState.tsx                  every list has a way out
src/components/Booking/StayRequestsSection.tsx    live totals, aria-live, counters tabular
src/components/ContactInquiryForm.tsx             autocomplete, counters, aria-live
src/components/Auth/*.tsx                         autocomplete, spellCheck=false, inline errors, aria-live on failures
src/sections/Hero.tsx                             eager + fetchpriority=high, Ken Burns disabled under reduced motion
```

## Notes

- `dark:` utilities and a `.dark` block survive in `styles.css` although `index.html` removes the
  class and the theme switch is gone. Not a guideline violation, but they make findings like
  `color-scheme` harder to reason about; deleting them is the cheaper long-term fix.
- The site uses `:focus` (not `:focus-visible`) for input rings in `styles.css:166` and
  `PaymentStep.tsx:429/452`. Inputs keep a ring after a mouse click; `focus-visible` is the
  guideline and the rest of the design system already uses it.
- No `user-scalable=no`, no `onPaste` blocking, no `dangerouslySetInnerHTML`, no `<div onClick>`
  navigation, no unlabelled icon buttons, no images without `alt`. Those checks came back clean.
