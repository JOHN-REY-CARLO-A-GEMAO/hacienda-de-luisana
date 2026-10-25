# `/account` — the guest book

**Scope:** the Guest's own page on the website (`src/pages/AccountPage.tsx` and
`src/components/Account/`).
**Supersedes:** the `/account` rows and the `BookingFolio`/`AccountRail`/`StatCard`/`Tabs`
entries in [`GUEST_UI_REDESIGN_PLAN.md`](GUEST_UI_REDESIGN_PLAN.md) and
[`UI_UX_AUDIT.md`](UI_UX_AUDIT.md) — those describe the previous pass, kept for the
history of why each decision was made.

---

## 1. What the page is for

A Guest does not return to `/account` to be reminded what the house looks like. They
come back to answer one question — *when am I going, and is it confirmed?* — and,
second, to reach a person at the Hacienda. Everything on the page is judged against
that:

| Job | Where it lives now |
| --- | --- |
| When is my stay, and is it confirmed? | The page opener, with the date range at display size |
| What is outstanding on it? | The entry that is still live, opened, with its money and its forms |
| What happened on my booking? | One disclosure per entry — *Progress and activity* |
| How do I reach the Admin? | The flyleaf |
| Who am I on this account? | The bookplate |

## 2. The direction

**The page is a page of the Hacienda's guest book** — one warm sheet on a board
cover, entries in date order, the date hanging in a brass-ruled margin, the Guest's
name written on the flyleaf. It is not a dashboard, and deliberately not a stack of
cards: a card per booking made a stay three weeks away take exactly as much room as
one that ended in June, and gave a Guest nothing to scan by.

The subject supplied the form. An estate that keeps a guest book keeps it as one
document — a ruled margin, a date per entry, the particulars on the inside cover —
and the vocabulary of the domain already carries it (`Booking`, `Date hold`,
`Activity log`, `folio`). Nothing here is a metaphor borrowed from another product.

## 3. Tokens

Colour (defined once, scoped to `.ledger-ground` in `src/styles.css`):

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--ledger-desk` | `#F5F1E8` | `#0D1711` | the board the sheet lies on |
| `--ledger-leaf` | `#FFFDF8` | `#16241B` | the sheet — warm white, never `#fff` |
| `--ledger-ink` | `#15241B` | `#F5F1E8` | names, figures, the loud line |
| `--ledger-soft` | `#4E5E4F` | cream at 78% | facts, sentences |
| `--ledger-meta` | `#6F7B65` | cream at 58% | references, marginalia |
| `--ledger-brass` | `#B89A64` | `#DDC497` | the margin rule, night marks, the selected tab |

Brass is spent three times and no more. The forest, cream and brass family is the
estate's own identity — the same palette the sign at the gate and the site's own
`theme-color` use — so it is kept rather than re-invented, but nothing else on the
page is allowed to be decorative. There is no gradient accent, no terracotta, and no
second accent colour.

Type:

| Face | Role |
| --- | --- |
| Cormorant Garamond | the date range, place names, italics of marginalia (tabs, block titles, the summary line, the greeting) |
| Inter | facts, sentences, controls, anything a Guest has to read precisely |

Scale: `3.35 / 2.85 / 2.2 / 1.8 / 1.5 / 1.15 / 1.0625 / 0.9375 / 0.8125 / 0.75 / 0.6875 rem`.
Body leading 1.7, display 1.05–1.15. Measure is capped (`62ch` for the status
sentence, `42rem` for the opener's copy) because the sheet is wide on a desktop.

Layout:

```
┌ the page opener ────────────────────────────────────────────┐
│ Your stay · Guest                                          │
│ The Main House                                             │
│ 20 – 22 November 2026            ← 3.35rem, the loud line  │
│ Friday to Sunday, 2 nights, 9 guests                       │
│ [Reserved]  26 days away      Reference HDL-2401            │
│                          [Notifications]  [Book a stay]    │
└────────────────────────────────────────────────────────────┘
┌ the sheet ──────────────────────────┬ the flyleaf ─────────┐
│ My bookings 4    My profile         │ ┌ bookplate ───────┐ │
├─────────────────────────────────────│ │ This book …      │ │
│ [Search] [Status ▾] [Order ▾]       │ │ Ana L. Reyes     │ │
│                                     │ │ ana@example.com  │ │
│ Jan │ Camping          [Payment …]  │ │ Member since …   │ │
│ 7 – 9│ Reference HDL-2402           │ └──────────────────┘ │
│ 2027 │ Booked 22 Oct 2026, 2 nights │ Talk to the Hacienda │
│ ▮▮   │ Your payment is being …      │ [Message the Admin]  │
│      │ Downpayment required ₱3,000  │ [Open Messenger]     │
│      │ …forms…                      │ [Call (0925) 850 …]  │
│      │ [Invoice] [Cancel booking]   │                      │
│      │ ▸ Progress and activity      │                      │
├─────────────────────────────────────┤                      │
│ 4 stays on this account, 1 coming up│                      │
└─────────────────────────────────────┴──────────────────────┘
```

On a phone the margin folds into a horizontal stamp above the entry's name, and the
flyleaf drops under the sheet. Alignment is left throughout; nothing is centred
except a button's own label.

## 4. Principles

1. **A book, not a dashboard.** No tiles, no equal cards, no shadow per entry. The
   only surfaces are the sheet and the sheet's opener.
2. **One photograph.** The stay that is coming gets the estate's own picture; every
   other entry is type and ink. A completed stay does not need a hero.
3. **The date margin is the wayfinding.** Every entry is found by *when*, in the same
   place, and one mark per night draws the length of a stay so `2 nights` is seen
   before it is read.
4. **The live entry is the loud one** — brass night marks, an open record, its forms
   in place. A closed stay is quiet: its stage track and its Activity log fold away
   behind one disclosure.
5. **Nothing decorative that does not encode.** Brass = live. Ticks = nights.
   Italic = the book's own marginal notes. The rule down the margin is the only
   vertical line on the page.

## 5. What was removed, and why

| Removed | Why |
| --- | --- |
| The per-entry photograph strip | Every booking had one, so none of them meant anything, and the opener already shows the place that is coming. |
| The ledger grid of four to six tinted facts | Inside a bordered sheet it was a box in a box. The same facts are one sentence and a two-line receipt. |
| The three stat tiles (`StatCard`) | Three identical tiles are a dashboard. The same counts are one italic line at the foot of the book. |
| The rail's "Next stay" panel | A second copy of the opener, 200px below it. |
| The always-open stage track and Activity log | What a Guest opens when something is disputed, not what they need on every visit — now one `<details>` per entry. |
| `Tabs` (segmented pill), `BookingFolio`, `AccountRail`, `StatCard` | Nothing else rendered them; each was replaced by the sheet, `StayEntry`, `Flyleaf` and `LedgerTabs`. |
| ALL-CAPS tracked eyebrows inside the page | They made every label shout at the same volume. Entry titles, block titles and labels are sentence case, and the mise-en-page carries the hierarchy. |

The one label the page keeps (`Your stay · Guest`) is pinned by
`test/web/auth-flow.test.tsx` and `auth-routes.test.tsx`; it is set sentence case at
12px and is the only thing above the loud line.

## 6. Interaction and accessibility

- **Tabs** are a real `tablist`: arrow keys, Home and End, `aria-selected`, roving
  `tabIndex`, `aria-controls` on every tab and a `role="tabpanel"` that points back
  with `aria-labelledby`. The selected tab is marked by a brass underline *and* its
  ink weight, never by colour alone. The choice is written back to `?tab=`, so the
  back button and a shared link land on the leaf that was open.
- **The record** is a native `<details>`, so it opens from the keyboard, is announced
  as a disclosure, and still works when the script that drew the page never runs.
- **The focus ring** comes from the shared `btn` / `.field` tokens and the brass
  outline on the tabs and the fold.
- **Motion** is one entrance on the opener (`guest-rise`), and it is off under
  `prefers-reduced-motion`.
- **Contrast**: ink on leaf, soft on leaf and brass on leaf all clear 4.5:1 at the
  sizes they are set; the opener's type sits on two stacked scrims for the same
  reason.
- **Empty states** name what is missing, why it might be, and what to do; a filter
  that matches nothing offers the way back.

## 7. Files

| File | What it is |
| --- | --- |
| `pages/AccountPage.tsx` | The page: state, permissions, dialogs, the two leaves. |
| `components/Account/StayMasthead.tsx` | The opener: photograph, dates, status, actions. |
| `components/Account/StayEntry.tsx` | One entry as a ledger row: date margin, facts, money, actions, folded record. |
| `components/Account/StatusTrack.tsx` | The five stages, drawn inside the folded record only. |
| `components/Account/LedgerTabs.tsx` | The index tabs and their keyboard contract. |
| `components/Account/Flyleaf.tsx` | The bookplate and the way to a person. |
| `components/Account/stayFacts.ts` | Every reading a Booking needs on this page — dates, nights, pesos, stages. |
| `components/Auth/ProtectedRoute.tsx` | The one strip that says a build has no Firebase; it clears the fixed bar itself. |
| `styles.css` § *The guest book* | The `ledger-*` tokens and nothing else. |

`test/web/account-ledger.test.tsx` pins the structure that this document argues for.
