# Signed-in Guest experience — design plan

Working notes for the redesign of `/account`, `/messages`, `/booking/status` and
the booking components behind them. Follows the `frontend-design` skill's
plan → review → build → critique pass.

## Subject

A private countryside hacienda in Luisiana, Laguna: family gatherings, campfire,
lawn camping, A-frame units, a Main House that sleeps ten. The signed-in
experience is what a guest who has *already decided to come* looks at. Its job is
not to report metrics — it is to let someone follow one real arrangement: what
they booked, when, what it costs, what is still owed, and what happens next.

That is the organising idea. The pages before this pass were a metrics dashboard
(three identical stat tiles, a tab strip, a stack of identical rounded cards)
with no photograph, no property, and no sense of the place in them.

## Color

The brief pins the palette, so it is taken as given and not re-chosen:

| Token | Hex | Role |
| --- | --- | --- |
| `forest-700` | `#243D2E` | ink, primary action |
| `cream-50` | `#FAF7F2` | ground |
| `cream-100` | `#F5F1E8` | recessed block |
| `brass-400` | `#B89A64` | the one accent — hairlines, the "held" state, numerals |
| `sage-400` | `#A6B29B` | quiet secondary text |

Status colours stay exactly where they are (`StatusBadge` is the only place they
are written) so a colour never means two things.

## Type

Cormorant Garamond display + Inter body, both already loaded. The change is in
*how much* the serif is asked to do.

Before, `/account` was ~90% `text-xs` and `text-[10px]`: a wall of the same size,
which is what makes a page read as an admin tool. Now the serif carries the
things a guest actually reads twice — the property name, the dates, the amount
owed, the countdown — at real sizes with `tabular-nums`, and Inter carries the
rest.

Labels inside data stop being ALL-CAPS-tracked. One tracked eyebrow per page;
ledger labels are sentence case. (The tracked eyebrow itself stays — it is the
established brand voice on every public page.)

## Layout

```
DESKTOP ≥ lg
┌───────────────────────────────────────────────────────────────┐
│  fixed nav pill                                               │
├───────────────────────────────────────────────────────────────┤
│  MASTHEAD — the booked property's own dusk photograph, forest  │
│  scrim, property name in Cormorant, dates + countdown.        │
│  ONE bold element. Everything below it is quiet.               │
├──────────────────────────────────────┬────────────────────────┤
│  LEDGER COLUMN                       │  RAIL (sticky)         │
│  ─ toolbar: search / filter / sort   │  ─ Your details        │
│  ─ booking folio: photo strip │      │  ─ What you've paid    │
│    facts on a hairline grid          │  ─ Talk to the Hacienda│
│  ─ activity spine (vertical)         │                        │
│  ─ actions in a footer band          │                        │
└──────────────────────────────────────┴────────────────────────┘

MOBILE — one column. Masthead compresses to a 168px band. Rail
drops below the folio. Action band wraps.
```

Left-aligned throughout, except the masthead's own display line.

## Principles

1. **Spend the boldness in one place.** The masthead photograph is the memorable
   thing; every other surface is a hairline-ruled document.
2. **Structure encodes information.** The ledger grid, the folio rule and the
   activity spine tell you how the content relates. They are not decoration.
3. **A sequence may be numbered; nothing else may.** The activity log and the
   booking status spine genuinely are sequences, so they get sequence marks.
   Section headers do not.
4. **One radius for documents, not for everything.** Marketing cards keep the
   brand's 28px. Signed-in surfaces use 14px — a reservation reads as a
   document, not as another soft card in a row.
5. **Facts read as a ledger** (label above value on a hairline), never as a grid
   of tiles.

## Review against the generic tells

| Tell | Verdict |
| --- | --- |
| cream + high-contrast serif + warm accent | The client's own established brand, explicitly pinned by the brief. Skill: "the brief's own words always win." Accent here is brass and forest green, not terracotta. **Kept.** |
| SaaS-card kit — identical rounded cards, one radius, same shadow | **Actively removed.** Three identical `StatCard`s and the repeated `rounded-[28px]` cards become a ledger, a spine and one masthead. |
| Tracked ALL-CAPS eyebrow above every heading | Kept at page level only (brand voice, used site-wide incl. public pages). Removed from data labels. |
| Numbered `01 / 02 / 03` markers | Only where the content is a sequence (activity log, status spine). |
| Fade-and-slide-up on every section | **No new entrance animation.** One reveal on the masthead, and it is disabled under `prefers-reduced-motion`. |
| Meta strings joined with middle dots | Replaced by the ledger grid wherever the data has more than two parts. |
| Gradient washes as decoration | None added. The masthead scrim is a legibility overlay on a photograph, not decoration. |

## Scope guard

`test/web/design-system.test.ts` pins the shared system, and the public pages are
out of scope. So:

* Everything below the new marker in `src/styles.css` is **additive** — no
  existing rule is edited, so public pages render identically.
* New components live in `src/components/Account/` and are mounted only by
  signed-in pages.
* `StatCard` and `Tabs` are used *only* by `AccountPage` (verified by grep), so
  restyling them cannot reach a public page.
* `StatusBadge` is shared with the demo review desk; its tone map is untouched.
* `Nav` keeps its plain-link drawer: `test/web/nav-mobile.test.tsx` asserts no
  `role="menu"` and no `aria-haspopup` in it.

---

## What shipped

### New — `src/components/Account/` (signed-in only)

| File | Role |
| --- | --- |
| `stayFacts.ts` | The readings a Guest page needs about one Booking: property name and photograph, reference, day counts, date formats, pesos, and the five-stage mapping. Presentation only — nothing here decides what a Booking may be. |
| `StayMasthead.tsx` | The one bold element. The booked accommodation on the Hacienda's own photograph, or the same band in forest when there is nothing coming. |
| `BookingFolio.tsx` | One Booking as a document: photograph, ledger, stage track, action band. Presentational — owns no Booking state and calls no lifecycle method. |
| `StatusTrack.tsx` | The twelve canonical statuses collapsed onto the five questions a Guest asks. A Booking that ended without a stay gets a sentence and no track. |
| `AccountRail.tsx` | `RailPanel`, `RailFacts`, `HelpPanel`. Sticky from `lg`, drops under the main column on a phone. |

### Changed

`pages/AccountPage.tsx` (restructured around the masthead, folio and rail),
`pages/MessagesPage.tsx` (thread on a dotted ground, asymmetric bubbles),
`pages/BookingStatusPage.tsx` (stage track + ledger),
`components/Booking/BookingHistory.tsx` (activity spine, newest marked in brass),
`components/Booking/PaymentStep.tsx`, `PaymentInformationPanel.tsx`,
`HoldCountdown.tsx`, `LateCheckoutRequest.tsx`, `BookingInvoice.tsx`,
`components/Auth/ProtectedRoute.tsx` (the sign-in gate),
`components/Nav.tsx` (signed-in cluster in the bar and the drawer),
`components/ui/Tabs.tsx` (segmented control), `components/ui/StatCard.tsx`
(a count on a hairline, not a tile), `src/styles.css` (additive `guest-*` block),
`tailwind.config.js` (opacity `8` and `12`).

### Verification actually run

* `npm run lint` (`tsc -b`) — exit 0.
* `npm run test` — 77 files, **1109 passed**, matching the pre-change baseline.
* `npm run build` — exit 0, 14 pages prerendered.
* Base commit built in a throwaway worktree and diffed: **all 14 public pages
  byte-identical** (hashed asset names normalised).
* Generated CSS compared rule by rule: **0 pre-existing declarations changed**,
  160 rules added, **0 pre-existing keyframes changed**, one added (`guestRise`).
* Real components rendered through jsdom and their structure inspected — this is
  what caught two defects the tests did not: a duplicated date line in the
  folio, and empty-masthead copy that read "No stay booked yet" on an account
  that had bookings but none upcoming.

**Not verified:** pixels. No browser binary exists in this sandbox and its
download host is outside the network allowlist, so no screenshots were taken and
no viewport was measured. Responsive behaviour is asserted by the markup and the
breakpoint utilities, not by observation.

### Audit pass (after the rewrite)

The redesign was re-read line by line, and four audits run that the test suite
does not cover. Each found something real:

**Contrast.** Every light-mode text/background pair in the signed-in surfaces was
composited and measured against WCAG AA. Six labels failed and were raised to a
`/90` alpha (their dark counterparts lifted in the same edit):

| where | was | ratio | now |
| --- | --- | --- | --- |
| activity timestamps and actor, on inset | `forest-600/80`, `/70` | 4.32, 3.43 | `/90` = 5.45 |
| payment step label, on inset | `forest-600/80` | 4.32 | `/90` |
| notification timestamp, on `cream-50` | `forest-600/70` | 3.49 | `/90` = 5.55 |
| message meta, on white | `forest-600/70` | 3.58 | `/90` = 5.84 |

Twelve dark-mode pairs measured too; all pass. The weakest survivors are
decorative rules and a masthead reference line at 3.5:1 and 5.8:1.

**Clipped text.** Every `truncate` that had no tooltip was found. The folio's own
property name could vanish into an ellipsis on a narrow screen — it now wraps,
which is the right call for the headline of the one card the whole page is about.
The nav pill and drawer gained `title`; the account number and the masthead email
gained `break-all`. The status badge beside the name is `shrink-0`, so the name
gives way before the badge does.

**Type scale.** Eleven `text-[10px]` labels in the signed-in surfaces went to
11px — 10px uppercase tracking is legible on paper and mush on a phone. The
shared `.data-label` token is left at 10px because public pages depend on it.

**Images.** All 27 accommodation and nearby-image paths in `config/site.ts`
resolve to files under `public/`; nothing 404s.

### Verification actually run — final

* `npm run lint` (`tsc -b`) — exit 0.
* `npm run test` — **78 files, 1117 passed** (1109 baseline + 8 new invoice tests).
* `npm run build` — exit 0, 15 pages prerendered.
* Base commit rebuilt in a throwaway worktree: **all 15 public pages
  byte-identical** (hashed asset names normalised).

**Not verified:** pixels. This sandbox has no browser binary, and every download
host that could supply one sits outside the network allowlist — GitHub *release
assets* redirect to `release-assets.githubusercontent.com`, which is blocked even
though `github.com` itself answers. No screenshots were taken and no viewport was
measured. Responsive behaviour is asserted by the markup and the breakpoint
utilities, not by observation. The audit pass above exists to close that gap as
far as it can be closed without a renderer.
