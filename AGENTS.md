# Hacienda de LuisAna — agent notes

Two roles, two apps, one Firebase project (ADR-0007):

- **Guest website** (`src/`) — React + Vite + TS + Tailwind + Firebase. Guest-only: landing page, `/book`, `/mybookings` (own Bookings, payment proof upload, payment plan), `/messages` (chat with the Admin). No management screens.
- **Admin mobile app** (`lib/`) — Flutter. Admin-only: Booking review and lifecycle, payment verification, refunds, published rates, stays, chat inbox, smart-lock Access log, rooms, CRM, analytics.

There is no Staff role and no Host role. Roles are `guest` | `admin`.

Read `docs/README.md` for the repository layout, and `docs/agents/domain.md` for the domain docs rules before exploring.

## Which Firebase project a build talks to

Decided once, at build time, by `src/lib/firebaseConfig.ts`: `VITE_FIREBASE_*`
variables first, then the committed project in `src/lib/firebaseDefaults.ts` for
production builds, then nothing (demo mode, `authLocal.ts`). So `npm run dev`,
`npm test` and the emulator workflow run in demo mode, while a deployed build talks
to the Hacienda's real project. `/status` reports which source won, and the build
log prints it (`[firebase] Building for project …`). Never put a secret in a
`VITE_*` variable — everything Vite exposes is public — and read
`docs/FIREBASE_SETUP.md` § 3c before changing any of this.

## Payment proofs are receipts, not claims

A Guest files a payment proof only when the browser read the reference number,
the amount, and the payment date and time off the screenshot; all four are
read-only, and there is no manual or "my receipt says otherwise" fallback. The
one rule is `checkScannedReceipt` in `src/lib/payments/receipt-rules.ts` — use
it rather than re-deriving the checks in a page. Receipts older than the
Admin's `payment_proof_max_age_days` (default 7) are refused, and a reference
already on a live Booking is refused as a duplicate both up front
(`paymentReferenceStatus`) and inside `submitBooking`'s transaction. The core
runs on Firebase Functions or on the Cloudflare Worker (ADR-0024), which hosts
`paymentReferenceStatus` too; with neither host deployed the duplicate check can
only see the Guest's own Bookings. See ADR-0025.

There is no live-location feature in either app; do not reintroduce the
Realtime Database block in `firebase.json` or the removed share controls
(ADR-0026).

## SEO and the prerender

The Guest website is a single-page app that is prerendered at build time
(`scripts/prerender.mjs`) into one `.html` file per public route. A page's title,
description and whether it may be indexed are declared once, in
`src/config/routes.ts`; adding a route to `src/App.tsx` without a row there gives
it the not-found head, and `test/web/seo.test.tsx` fails. Read `docs/SEO.md`
before touching the `<head>`, the JSON-LD, or the deploy configuration.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
