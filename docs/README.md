# Hacienda de LuisAna

Private countryside escape in Luisiana, Laguna. This repository contains **two applications for two roles**, sharing one brand and one Firebase project ([ADR-0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)):

| Role | Application | Where |
| --- | --- | --- |
| **Guest** (the client) | **Website** — React + Vite + TypeScript + Tailwind + Firebase | `src/` · deployed on Vercel (`haciendadeluisana.com`) and Firebase Hosting |
| **Admin** | **Mobile app** — Flutter (Android) | `lib/` + `android/` |

There is **no Staff role and no Host role**. The Admin does everything an operator does, from the app. The website has no management screens.

![Hacienda](https://haciendadeluisana.com/favicon.svg)

---

## Repository Layout

```
# Guest website (Vercel / Firebase Hosting)
src/                    # React app (components, pages, sections, lib, tutorial, context, config)
public/                 # Static assets (images/gmaps, nearby, favicon, CNAME)
index.html · vite.config.ts · tailwind.config.js · postcss.config.js · tsconfig.json
firebase.json · firestore.rules · firestore.indexes.json · storage.rules
vercel.json · package.json
test/web/               # vitest — booking lifecycle, auth, rules mirror, interactive tutorial walk

# Admin mobile app
lib/                    # Flutter app (main.dart, models/, services/, providers/, views/, widgets/, core/, tutorial/)
android/                # Flutter Android project (Gradle 8.11.1, Kotlin 2.2.20, compileSdk 36)
assets/                 # Flutter asset images
pubspec.yaml
test/*_test.dart        # flutter test — lifecycle rules, published rates, booking model, tour state machine, security gate, PIN policy, PIN sheet

# Shared
CONTEXT.md              # Domain glossary (the vocabulary both apps use)
docs/adr/               # Architecture decision records (0001–0010)
docs/                   # Setup, flows, plans (this folder)
```

Build outputs (`dist/`, `build/`, `.dart_tool/`, `android/.gradle/`) are gitignored.

---

## Roles and access

| | Guest | Admin |
| --- | --- | --- |
| Public site, `/book` | ✅ | ✅ (reads like anyone) |
| `/account` — own Bookings, payment plan, payment proof, Date hold, withdraw | ✅ | — (turned away; pointed to the app) |
| `/messages` — chat with the Admin, and 📍 Share Live Location (15/30/60 min) | ✅ | ✅ app inbox |
| Rate a finished stay, and change your mind for 14 days | ✅ (at `/account`) | — |
| Read, answer, moderate and publish Reviews | — | ✅ app ([ADR-0014](./adr/0014-a-review-is-private-and-a-testimonial-is-a-separate-document.md)) |
| Review a Booking: approve / reject, refuse an ID | — | ✅ app |
| Verify / reject Payment proof, cancel, settle and mark Refunds | — | ✅ app |
| Check-in → Staying → Check-out → Complete, revoke a Credential | — | ✅ app |
| Publish rates & cancellation policy (`site_config/rates`) | — | ✅ app |
| A deliberate second input on every sensitive action — a Security PIN (approve, delete, publish, revoke) or a confirm (stay transitions, sign-out, reader grant) | — | ✅ app ([ADR-0015](./adr/0015-a-sensitive-admin-action-needs-a-deliberate-second-input.md)) |
| Read every Booking, Access log, CRM, analytics | — | ✅ app |
| Read a Guest's live location while they are sharing it | — | ✅ app ([ADR-0013](./adr/0013-live-location-as-a-stream.md)) |

A role is **stored**, not chosen: signing up on the website makes a Guest and cannot make anything else. The Admin is recognised by the bootstrap email allowlist (`firestore.rules` `adminEmails()`, mirrored in `storage.rules`, `src/lib/auth/profile.ts` and `lib/services/auth_store.dart`) or by `profiles/{uid}.role == 'admin'`. Enforcement is `firestore.rules`; hiding a page or a button is only the courtesy half. See [ADR-0005](./adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md) (storage of a role) and [ADR-0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md) (the two roles).

---

## Guest website (`src/`)

### Features

- Responsive landing (Hero, Accommodations, Experience, Gallery, Location, Reviews, FAQ)
- `/book` — Guests book at least **30 days before check-in** (calendar dates in **Asia/Manila**, configurable via `site_config/booking`); native date-picker minimum plus authoritative Firestore create validation. Availability checks, 24-hour Date holds, downpayment proof and Pending → Admin review remain intact. See [BOOKING_POLICY.md](./BOOKING_POLICY.md) for configuration, enforcement, verification and deployment.
- `/account` — the Guest's own Bookings: status timeline, Date hold countdown, Payment plan choice from the published rates, Payment proof upload, withdraw, Activity log
- `/login`, `/guest/auth` — Guest sign-in / sign-up, email + password and Google, password reset, session kept across reloads
- `/admin/*`, `/app/*` — a notice: the Admin dashboard moved to the Admin mobile app
- Interactive guided tutorial (first visit + "Replay tutorial") — drives the real UI instead of slides; see [TUTORIAL.md](./TUTORIAL.md)

### Routes

| Route | Page | Who |
| --- | --- | --- |
| `/` | Landing | everyone |
| `/book` | Booking form + availability | everyone (an anonymous Guest identity is attached at submit — ADR-0004) |
| `/login`, `/guest/auth` | Sign in / sign up | Guests |
| `/account` | My Bookings | signed-in Guest (`booking:read:own`) |
| `/status` | Deployment status — is this build wired to Firebase, and why not | everyone (read-only; the key is masked) |
| `/admin/*`, `/app/*` | "Moved to the Admin app" | — |

### Quick start

```bash
npm install
cp .env.example .env.local   # fill VITE_FIREBASE_* keys (skip this to run in demo mode)
npm run dev                  # http://localhost:3000
npm run lint                 # tsc -b
npm test                     # vitest: booking lifecycle + auth + rules mirror
npm run build
npm run preview
```

With no Firebase keys configured the site runs in **demo mode**: Guest accounts and Bookings live in this browser (passwords PBKDF2-hashed), and a banner says so on every protected page. That is the local-development behaviour; a *deployed* build falls back to the committed project in `src/lib/firebaseDefaults.ts`, so a deployment with an empty dashboard still reaches the Admin app instead of quietly keeping Guest requests in their own browser.

### Deployment

- **Vercel**: `vercel.json` present — set `VITE_*` env vars in the dashboard to override the committed project, then **redeploy** (Vite reads them at build time). Deployed build is `dist/`.
- **Firebase Hosting**: `firebase deploy --only hosting` (public = `dist`)
- **GitHub Pages**: workflow `.github/workflows/deploy.yml`

Env vars (`VITE_` prefix required): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_FIREBASE_DATABASE_URL` (live location, [ADR-0013](./adr/0013-live-location-as-a-stream.md); without it the sharing control is disabled and says why), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (payment-proof uploads to the Supabase Storage bucket `payment-proofs`, [ADR-0011](./adr/ADR-0011-supabase-storage.md); without them proofs stay in this browser as labelled demo mode).

Two switches worth knowing: `FIREBASE_ENV_STRICT=1` makes a build with no Firebase at all **fail** instead of shipping in demo mode, and `/status` on any deployment says which project it was built for and can test the connection from the browser. Which source wins, and why the committed config is not a secret, is in [FIREBASE_SETUP.md § 3c](./FIREBASE_SETUP.md).

Firebase setup: see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

---

## Admin mobile app (`lib/`)

### Tech stack

- Flutter / Dart ≥ 3.2 — `flutter_riverpod` (data streams), `provider` (auth session), `firebase_core`, `firebase_auth`, `cloud_firestore`, `google_sign_in`, `fl_chart`, `google_fonts`, `intl`, `url_launcher`, `flutter_local_notifications`, `shared_preferences`
- Theme (`lib/core/theme/app_theme.dart`): forest greens + gold accent, Cinzel / Cormorant Garamond / Inter
- `firebase_database` — the ephemeral live-location stream, read only by the inbox ([ADR-0013](./adr/0013-live-location-as-a-stream.md), [MESSAGING.md](./MESSAGING.md))
- Interactive guided tour (`lib/tutorial/`) — first launch + More → "Replay the guided tour"; drives the real screens, see [TUTORIAL.md](./TUTORIAL.md)

### Screens (`lib/views/`)

| Tab / screen | File | What the Admin does |
| --- | --- | --- |
| Sign in | `auth/admin_login_screen.dart` | Google or email + password; any non-Admin account is signed straight back out |
| Dashboard | `dashboard/dashboard_screen.dart` | Today's check-ins, active stays, pending requests, revenue, recent lock events, approaching-Guest banner |
| Bookings | `bookings/bookings_screen.dart` | Every Booking, filters (Needs action / Pending / Reserved / Active / Completed / Cancelled), one-tap Approve / Check in / Begin stay / Check out / Complete |
| Booking detail | `bookings/booking_detail_screen.dart` | money, refund breakdown, **every** lifecycle action (approve, reject, verify / reject payment proof, cancel with refund settlement, mark refunded, revoke Credential, record expiry, stay progression), Activity log, delete |
| Stays | `stays/stay_duration_screen.dart` | Stay durations and progress |
| Analytics | `analytics/analytics_screen.dart` | Revenue, conversion, length of stay, top Accommodation |
| Smart lock | `smartlock/smart_lock_screen.dart` | `access_logs` audit trail + simulator |
| Accommodation Status | `rooms/rooms_screen.dart` | Operational status per Accommodation, listed from the published rates document |
| CRM | `crm/guest_crm_screen.dart` | Guest history, VIP badges, notes |
| Rates | `rates/rates_screen.dart` | Publish `site_config/rates` — weekday/weekend-holiday guest-count standard-stay schedules, holiday dates, Security deposit, fixed 50% down payment and cancellation policy — validated with the same rules the website applies |

### Lifecycle rules

`lib/services/booking_lifecycle.dart` is a pure-Dart port of `src/lib/booking`: the eleven canonical statuses, the transition whitelist, the Admin and system actions with their preconditions (a proof and a covering amount before Verify, a re-check of the dates at approval, hold expiry read at action time), refund settlement, and `validatePublishedRates`. `FirestoreService.applyBookingAction` writes the resulting patch and the Activity entry in one batch.

### Run

```bash
flutter pub get
flutter test              # lifecycle, rates, model, security-gate, PIN-policy and PIN-sheet tests
flutter run               # Android emulator/device
```

Android: see [ANDROID.md](./ANDROID.md). Without a configured Firebase app the screens run on in-memory demo data and the sign-in gate cannot be passed (Firebase Auth is the only sign-in).

---

## Documents

- [CONTEXT.md](../CONTEXT.md) — glossary
- [MESSAGING.md](./MESSAGING.md) — the Guest ↔ Admin conversation: data model, the 1,000-character limit, cursor pagination, retention, and live location
- [docs/adr/](./adr/) — decisions; start with [0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md); the money and audit boundaries are [0010](./adr/0010-money-and-audit-invariants-in-the-rule-layer.md); live location is [0013](./adr/0013-live-location-as-a-stream.md); reviews and the public testimonial are [0014](./adr/0014-a-review-is-private-and-a-testimonial-is-a-separate-document.md)
- [docs/REVIEWS.md](./REVIEWS.md) — the Review data model, eligibility, the edit window, moderation, and what the website publishes
- [HDL_FLOW_CORRECTED.md](./HDL_FLOW_CORRECTED.md) — the system flow (thesis chart), per module
- [FLUTTER_FLOW.md](./FLUTTER_FLOW.md) — the Admin app's flow and screen contracts
- [FLUTTER_UI_UX.md](./FLUTTER_UI_UX.md) — the Admin app's design system
- [APP_PLAN.md](./APP_PLAN.md) — the plan that led here (Tagalog), updated to the two-app architecture
- [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) — Firebase project, rules, rates document
- [ANDROID.md](./ANDROID.md) — building the Admin app
