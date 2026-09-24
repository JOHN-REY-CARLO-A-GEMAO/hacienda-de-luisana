# Hacienda de LuisAna — agent notes

Two roles, two apps, one Firebase project (ADR-0007):

- **Guest website** (`src/`) — React + Vite + TS + Tailwind + Firebase. Guest-only: landing page, `/book`, `/account` (own Bookings, KYC + payment proof upload, payment plan), `/messages` (chat with the Admin). No management screens.
- **Admin mobile app** (`lib/`) — Flutter. Admin-only: Booking review and lifecycle, KYC and payment verification, refunds, published rates, stays, chat inbox, smart-lock Access log, rooms, CRM, analytics.

There is no Staff role and no Host role. Roles are `guest` | `admin`.

Read `docs/README.md` for the repository layout, and `docs/agents/domain.md` for the domain docs rules before exploring.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
