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
src/                    # React app (components, pages, sections, lib, context, config)
public/                 # Static assets (images/gmaps, nearby, favicon, CNAME)
index.html · vite.config.ts · tailwind.config.js · postcss.config.js · tsconfig.json
firebase.json · firestore.rules · firestore.indexes.json · storage.rules
vercel.json · package.json
test/web/               # vitest — booking lifecycle, auth, rules mirror

# Admin mobile app
lib/                    # Flutter app (main.dart, models/, services/, providers/, views/, widgets/, core/)
android/                # Flutter Android project (Gradle 8.11.1, Kotlin 2.2.20, compileSdk 36)
assets/                 # Flutter asset images
pubspec.yaml
test/*_test.dart        # flutter test — lifecycle rules, published rates, booking model

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
| Public site, `/book`, `/track` | ✅ | ✅ (reads like anyone) |
| `/account` — own Bookings, KYC upload, payment plan, payment proof, Date hold, withdraw | ✅ | — (turned away; pointed to the app) |
| Review a Booking: approve / reject, refuse an ID | — | ✅ app |
| Verify / reject Payment proof, cancel, settle and mark Refunds | — | ✅ app |
| Check-in → Staying → Check-out → Complete, purge ID after the stay, revoke a Credential | — | ✅ app |
| Publish rates & cancellation policy (`site_config/rates`) | — | ✅ app |
| Read every Booking, Access log, CRM, analytics | — | ✅ app |

A role is **stored**, not chosen: signing up on the website makes a Guest and cannot make anything else. The Admin is recognised by the bootstrap email allowlist (`firestore.rules` `adminEmails()`, mirrored in `storage.rules`, `src/lib/auth/profile.ts` and `lib/services/auth_store.dart`) or by `profiles/{uid}.role == 'admin'`. Enforcement is `firestore.rules`; hiding a page or a button is only the courtesy half. See [ADR-0005](./adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md) (storage of a role) and [ADR-0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md) (the two roles).

---

## Guest website (`src/`)

### Features

- Responsive landing (Hero, Accommodations, Experience, Gallery, Location, Reviews, FAQ)
- `/book` — availability check against stored Bookings (24-hour Date hold), Booking submission → Firestore (localStorage fallback in demo mode)
- `/account` — the Guest's own Bookings: status timeline, Date hold countdown, government ID + receipt upload (KYC), Payment plan choice from the published rates, Payment proof upload, withdraw, Activity log
- `/login`, `/guest/auth` — Guest sign-in / sign-up, email + password and Google, password reset, session kept across reloads
- `/admin/*`, `/app/*` — a notice: the Admin dashboard moved to the Admin mobile app

### Routes

| Route | Page | Who |
| --- | --- | --- |
| `/` | Landing | everyone |
| `/book` | Booking form + availability | everyone (an anonymous Guest identity is attached at submit — ADR-0004) |
| `/login`, `/guest/auth` | Sign in / sign up | Guests |
| `/account` | My Bookings | signed-in Guest (`booking:read:own`) |
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

With no Firebase keys configured the site runs in **demo mode**: Guest accounts and Bookings live in this browser (passwords PBKDF2-hashed), and a banner says so on every protected page.

### Deployment

- **Vercel**: `vercel.json` present — set `VITE_*` env vars in the dashboard. Deployed build is `dist/`.
- **Firebase Hosting**: `firebase deploy --only hosting` (public = `dist`)
- **GitHub Pages**: workflow `.github/workflows/deploy.yml`

Env vars (`VITE_` prefix required): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.

Firebase setup: see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

---

## Admin mobile app (`lib/`)

### Tech stack

- Flutter / Dart ≥ 3.2 — `flutter_riverpod` (data streams), `provider` (auth session), `firebase_core`, `firebase_auth`, `cloud_firestore`, `google_sign_in`, `google_maps_flutter`, `geolocator`, `fl_chart`, `google_fonts`, `intl`, `url_launcher`, `flutter_local_notifications`
- Theme (`lib/core/theme/app_theme.dart`): forest greens + gold accent, Cinzel / Cormorant Garamond / Inter

### Screens (`lib/views/`)

| Tab / screen | File | What the Admin does |
| --- | --- | --- |
| Sign in | `auth/admin_login_screen.dart` | Google or email + password; any non-Admin account is signed straight back out |
| Dashboard | `dashboard/dashboard_screen.dart` | Today's check-ins, active stays, pending requests, revenue, recent lock events, approaching-Guest banner |
| Bookings | `bookings/bookings_screen.dart` | Every Booking, filters (Needs action / Pending / Reserved / Active / Completed / Cancelled), one-tap Approve / Check in / Begin stay / Check out / Complete |
| Booking detail | `bookings/booking_detail_screen.dart` | KYC documents, money, refund breakdown, **every** lifecycle action (approve, reject, refuse ID, verify / reject payment proof, cancel with refund settlement, mark refunded, purge ID, revoke Credential, record expiry, stay progression), Activity log, delete |
| Stays | `stays/stay_duration_screen.dart` | Stay durations and progress |
| Analytics | `analytics/analytics_screen.dart` | Revenue, conversion, length of stay, top Accommodation |
| Smart lock | `smartlock/smart_lock_screen.dart` | `access_logs` audit trail + simulator |
| Rooms | `rooms/rooms_screen.dart` | Accommodation status and pricing |
| CRM | `crm/guest_crm_screen.dart` | Guest history, VIP badges, notes |
| Rates | `rates/rates_screen.dart` | Publish `site_config/rates` — nightly rate, Security deposit, down-payment %, cancellation policy — validated with the same rules the website applies |

### Lifecycle rules

`lib/services/booking_lifecycle.dart` is a pure-Dart port of `src/lib/booking`: the thirteen canonical statuses, the transition whitelist, the Admin and system actions with their preconditions (a submitted ID before Approve, a proof and a covering amount before Verify, a re-check of the dates at approval, hold expiry read at action time), refund settlement, and `validatePublishedRates`. `FirestoreService.applyBookingAction` writes the resulting patch and the Activity entry in one batch.

### Run

```bash
flutter pub get
flutter test              # lifecycle, rates, model tests
flutter run               # Android emulator/device
```

Android: see [ANDROID.md](./ANDROID.md). Without a configured Firebase app the screens run on in-memory demo data and the sign-in gate cannot be passed (Firebase Auth is the only sign-in).

---

## Documents

- [CONTEXT.md](../CONTEXT.md) — glossary
- [docs/adr/](./adr/) — decisions; start with [0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md); the money and audit boundaries are [0010](./adr/0010-money-and-audit-invariants-in-the-rule-layer.md)
- [HDL_FLOW_CORRECTED.md](./HDL_FLOW_CORRECTED.md) — the system flow (thesis chart), per module
- [FLUTTER_FLOW.md](./FLUTTER_FLOW.md) — the Admin app's flow and screen contracts
- [FLUTTER_UI_UX.md](./FLUTTER_UI_UX.md) — the Admin app's design system
- [APP_PLAN.md](./APP_PLAN.md) — the plan that led here (Tagalog), updated to the two-app architecture
- [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) — Firebase project, rules, rates document
- [ANDROID.md](./ANDROID.md) — building the Admin app
