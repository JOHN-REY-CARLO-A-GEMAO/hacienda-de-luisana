# Hacienda de LuisAna — agent notes

Two roles, two apps, one Firebase project (ADR-0007):

- **Guest website** (`src/`) — React + Vite + TS + Tailwind + Firebase. Guest-only: landing page, `/book`, `/account` (own Bookings, payment proof upload, payment plan), `/messages` (chat with the Admin). No management screens.
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

## SEO and the prerender

The Guest website is a single-page app that is prerendered at build time
(`scripts/prerender.mjs`) into one `.html` file per public route. A page's title,
description and whether it may be indexed are declared once, in
`src/config/routes.ts`; adding a route to `src/App.tsx` without a row there gives
it the not-found head, and `test/web/seo.test.ts` fails. Read `docs/SEO.md`
before touching the `<head>`, the JSON-LD, or the deploy configuration.

## The contact form, and the two schemas

The public inquiry form does **not** run on Firebase. The estate's project is on
the Spark plan, which cannot deploy Cloud Functions, so `submitInquiry` posts to a
Cloudflare Worker in `workers/contact-inquiry/`. Read
`docs/FORMS_SECURITY.md` and ADR-0024 before changing either side.

There are two schemas and they are a deliberate pair:

- `src/lib/security/contactInquiry.ts` — the browser's, for UX.
- `workers/contact-inquiry/src/schema.ts` — the worker's, which is the authority
  and is stricter.

Neither can import the other, and neither is generated. What keeps them honest is
`test/web/contact-worker-contract.test.ts`, which imports the worker's real
`LIMITS`/`inquirySchema` and feeds the browser's output through it. Change a limit
on one side and that test fails — so fix both. There is no `sync:security` script
any more; the functions mirror and its manifest were deleted with the endpoint.

The worker has its **own** toolchain: `cd workers/contact-inquiry && npx tsc
--noEmit && npx vitest run`. The root `tsc -b` does not typecheck it. Its deploy
steps, secrets and free-tier numbers are in its README. Callable rate limiting is
still `functions/src/security/rateLimit.ts` (ADR-0023); do not describe
`src/lib/rateLimit.ts` as security.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
