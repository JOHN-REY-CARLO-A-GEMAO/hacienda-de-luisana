# Hacienda de LuisAna — agent notes

Two apps share one brand and one Firebase project:

- **Vite website** (`src/`) — React + Vite + TS + Tailwind + Firebase: landing page, booking inquiry, `/admin` dashboard, `/app` guest shell, `/track` live location sharing.
- **Flutter guest app** (`lib/`) — quiet-luxury prototype: booking, KYC upload, digital key, simulated ESP32 smart lock.

Read `docs/README.md` for the repository layout, and `docs/agents/domain.md` for the domain docs rules before exploring.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
