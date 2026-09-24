# Project Folders Structure Blueprint — Hacienda de LuisAna

> Generated via `folder-structure-blueprint-generator` skill (github/awesome-copilot).
> Config: `PROJECT_TYPE=Auto-detect | IS_MONOREPO=true (dual-app) | INCLUDES_MICROSERVICES=false | INCLUDES_FRONTEND=true | VISUALIZATION_STYLE=ASCII | DEPTH_LEVEL=3 | INCLUDE_FILE_COUNTS=true | INCLUDE_GENERATED_FOLDERS=false | INCLUDE_FILE_PATTERNS=true | INCLUDE_TEMPLATES=true`
> Last updated: 2026-09-24 (ADR-0007 — two roles, two apps: `src/` is the Guest website only, `lib/` is the Admin app only; Capacitor, `src/app/`, `src/components/Admin/`, `src/pages/AdminPage.tsx`, `lib/views/admin/`, `lib/models/booking.dart`, `booking_store` / `cloud_bookings` / `esp32_service` / `door_key` / `kyc_storage` removed; `lib/views/rates/`, `lib/views/bookings/booking_detail_screen.dart`, `lib/services/booking_lifecycle.dart` added). Maintain with code changes (see §12).

## 0. Initial Auto-detection Phase

### Technology signatures found

- **React + Vite + TypeScript (Guest website):** `package.json` (`react ^18.3.1`, `vite ^5.4.8`, `react-router-dom ^6.26.2`, `firebase ^12.18.0`), `vite.config.ts`, `tsconfig.json` / `tsconfig.app.json` / `tsconfig.test.json`, `tailwind.config.js` + `postcss.config.js`, `index.html`, `src/main.tsx` + `src/App.tsx`.
- **Node.js tooling:** `package.json` scripts (`dev`, `build: tsc -b && vite build`, `lint: tsc -b`, `test: vitest run`, `emulators`), `package-lock.json`, `vitest.config.ts`. **No Capacitor** (removed with ADR-0007).
- **Flutter / Dart (Admin app):** `pubspec.yaml` (`hacienda_de_luisana`, `flutter_riverpod`, `provider`, `firebase_core` / `cloud_firestore` / `firebase_auth` / `firebase_messaging`, `google_sign_in`, `google_fonts`, `fl_chart`, `flutter_local_notifications`, `intl`), `lib/main.dart`, `android/` (pure Flutter shell, label "Hacienda Admin", package `com.haciendadeluisana.client2`), `ios/`, `assets/images/gmaps/`.
- **Firebase backend (shared):** `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `storage.cors.json`, `src/lib/firebase.ts`, `lib/firebase_options.dart`.
- **No .NET / Java / Angular signatures:** no `.sln`, `.csproj`, `pom.xml`, `angular.json`.

### Monorepo determination

Dual-app single repo, **not a formal workspace monorepo**:

- Two apps with their own configs and their own **role**: Vite web (`package.json`) = Guest / Client; Flutter (`pubspec.yaml`) = Admin. One Firebase project, one brand, one vocabulary (`CONTEXT.md`), one `docs/adr/`.
- No `lerna.json` / `nx.json` / npm workspaces. Root-level orchestration is docs (`docs/README.md`, `AGENTS.md`, `CONTEXT.md`) + Firebase config + env (`.env*`).
- Verdict: `IS_MONOREPO=true` in the loose sense. Treat as two bounded contexts (Guest side / Admin side) with a shared backend contract.

### Microservices check — negative

- No service directories, Dockerfiles, gateway or registry. Single Firestore + Storage + Auth backend. `INCLUDES_MICROSERVICES=false`.

### Frontend identification — positive

- Web assets: `public/` (favicon, `images/gmaps/`, `images/nearby/`), `src/sections/` landing blocks, `src/components/`, Tailwind (`src/styles.css`).
- Mobile UI: `lib/views/`, `lib/widgets/`, `lib/core/theme/`, `assets/`.
- Build configs: `vite.config.ts`, Flutter `android/` + `ios/`.

## 1. Structural Overview

- **Organizing principle: by role first, then by feature + layer.** `src/` holds everything the Guest can do (browse, book, KYC, pay, chat, review, cancel) and nothing the Admin does; `lib/` holds everything the Admin does (approve, verify, refund, stays, rates, rooms, lock, chat inbox, CRM, analytics) and no Guest booking flow. Inside each: web `pages/` → `sections/` + `components/<Feature>/` → `lib/<domain>/`; Flutter `views/<feature>/` → `services/` → `models/` + `providers/` + `widgets/` + `core/`.
- **Repeating pattern:** `<feature>/contract.ts → index.ts → upload.ts / actions.ts` on web (`lib/kyc/`, `lib/payments/`, `lib/booking/`); `<feature>_model.dart + <feature>_service.dart + <feature>_screen.dart` in Flutter.
- **Rationale:** Firestore is the source of truth; both clients are thin shells over one Booking lifecycle (`Pending → … → Completed`, `CONTEXT.md` § Stay). The Guest's transitions live in `src/lib/booking/actions.ts`, the Admin's and the system's in `lib/services/booking_lifecycle.dart`; `firestore.rules` enforces the two-role split regardless of UI.
- **Relations:** `src/` and `lib/` never import each other. Shared contract = Firestore collections (`bookings` + `activity`, `profiles`, `site_config/rates`, `conversations` + `messages`, `reviews`, `access_logs`), Storage paths (`kyc/{bookingId}/…`), and vocabulary in `CONTEXT.md` + `docs/adr/0001–0007`.

## 2. Directory Visualization (ASCII, depth 3, generated folders excluded)

Excluded: `node_modules/`, `dist/`, `build/`, `.dart_tool/`, `android/.gradle/`, `android/build/`, `emulator-data/`, `.idea/`, `*.tsbuildinfo`, `*.log`.

```
hacienda-de-luisana/          # two roles, two apps (Vite web = Guest · Flutter = Admin) + Firebase
├── src/ (70 files)           # GUEST WEBSITE — React + Vite + TS
│   ├── App.tsx / main.tsx    # routes: / /book /track /share-location /login /guest/auth /account
│   ├── pages/                # Home, BookingPage, AuthPage, AccountPage, MessagesPage, LegalPage
│   ├── sections/             # landing blocks: Hero, Accommodations, Gallery, Location, FAQ…
│   ├── components/           # Nav, Footer, Logo, SmartImage, MobileStickyCTA
│   │   ├── Auth/             # LoginForm, ProtectedRoute (guest session only)
│   │   └── Booking/          # BookingHistory, HoldCountdown, KycUpload, PaymentStep
│   ├── lib/                  # domain: auth/, booking/, kyc/, payments/, chat, reviews, firebase…
│   ├── context/ hooks/ config/
│   └── styles.css / vite-env.d.ts
├── lib/ (43 files)           # ADMIN APP — Flutter (main.dart → AuthGate → MainShellScreen)
│   ├── main.dart / firebase_options.dart
│   ├── core/                 # constants/, theme/, utils/ (date_formatter, geo_utils)
│   ├── models/               # booking_model, room_model, guest_crm_model, smart_lock_event_model
│   ├── services/             # auth_store, booking_lifecycle, firestore_service, mock_data_service, notification_service
│   ├── providers/            # app_providers (riverpod streams + provider bridge)
│   ├── views/                # main_shell_screen + feature folders
│   │   ├── auth/             # admin_login_screen
│   │   ├── bookings/         # bookings_screen, booking_detail_screen (all Admin actions)
│   │   ├── rates/            # rates_screen (publishes site_config/rates)
│   │   └── dashboard/ stays/ inbox/ payments/ smartlock/ rooms/ crm/ analytics/ rates/
│   ├── widgets/              # hacienda_card, status_pill, empty_state, pulse_dot, animated_badge…
│   └── utils/                # validators
├── test/ (22 files)
│   ├── web/                  # vitest (19): booking-*, auth-*, kyc/payment-contract, rates, date-hold…
│   └── *_test.dart           # flutter (3): booking_lifecycle, published_rates, booking_model
├── docs/ (17 files)
│   ├── README.md / FIREBASE_SETUP.md / FLUTTER_FLOW.md / FLUTTER_UI_UX.md / ANDROID.md / APP_PLAN.md / HDL_FLOW_CORRECTED.md
│   ├── adr/0001–0007         # approve-before-pay, date hold, recheck, guest identity, roles, transaction, two-roles-two-apps
│   └── agents/               # domain.md, issue-tracker.md, triage-labels.md
├── public/ (24 files)        # favicon.svg, CNAME, images/gmaps/, images/nearby/
├── assets/ (22 files)        # Flutter assets/images/gmaps/ mirror
├── scripts/ (3 files)        # android-icons.sh, download-gmaps.sh, download-nearby.sh
├── android/ ios/             # Flutter native shells — see §7
├── index.html / vite.config.ts / vitest.config.ts / tailwind.config.js / postcss.config.js
├── firebase.json / firestore.rules + firestore.indexes.json / storage.rules + storage.cors.json
├── package.json / pubspec.yaml / vercel.json
└── CONTEXT.md / AGENTS.md / Project_Folders_Structure_Blueprint.md
```

Content statistics (non-generated): `src 70 | lib 43 | test 22 (web 19 + dart 3) | docs 17 | public 24 | assets 22 | scripts 3`.

## 3. Key Directory Analysis

### Guest website (`src/`) — React + Vite

- **`src/pages/`**: one route entry per URL (`Home`, `BookingPage`, `AuthPage`, `AccountPage`, `MessagesPage`, `LegalPage`). `App.tsx` also mounts `/track` and the `AdminMoved` signpost for `/admin/*` and `/app/*` (there are no admin pages — the signpost says to use the mobile app). Thin; composes `sections/` + `components/` + `lib/`.
- **`src/sections/`**: landing-page blocks (`Hero`, `Accommodations`, `Experience`, `Gallery`, `Location`, `Reviews`, `FAQ`, `Nearby`, `Stats`, `Amenities`, `Contact`, `Intro`). Presentational, Tailwind only.
- **`src/components/`**: shared chrome (`Nav`, `Footer`, `Logo`, `SmartImage`, `MobileStickyCTA`) + `Auth/` (`LoginForm`, `ProtectedRoute` — guest session gate) + `Booking/` (`BookingHistory`, `HoldCountdown`, `KycUpload`, `PaymentStep`). No `Admin/` group any more.
- **`src/lib/`**: domain core. `auth/` (`roles` — `guest | admin`, guest permissions; `profile`; `session`; `credentials`; `pages`), `booking/` (`actions` — guest actions, `activity`, `availability`, `holds`, `money`, `rates`, `statuses`, `internal`), `kyc/` (`contract`, `upload`, `purge`), `payments/` (`contract`, `upload`), plus `firebase.ts`, `firestoreBookings.ts`, `guestAuth.ts` (anonymous identity), `chatCloud.ts`, `reviewsCloud.ts`, `storage.ts`, `ratesDB.ts` (reads `site_config/rates`), `authFirebase.ts` / `authLocal.ts` / `authSession.ts`. Pure functions preferred (`booking-module-purity.test.ts`).
- **`src/context/ + hooks/ + config/`**: `AuthContext.tsx`, `useAuth.ts`, `config/site.ts` (content source of truth).

### Admin app (`lib/`) — Flutter

- **`lib/views/`**: `main_shell_screen.dart` (5 tabs + "More" sheet + Sign out) and one folder per feature: `auth/admin_login_screen`, `bookings/{bookings_screen, booking_detail_screen}` (every Admin action: Approve, Reject, Reject ID, Verify payment, Reject proof, Cancel, Mark refunded, Check-in, Begin stay, Check-out, Complete, Purge KYC, Revoke key + Activity log), `rates/rates_screen` (publish nightly rates, deposits, down-payment %, refund tiers), `payments/` (payment references + verification), `inbox/` (guest chat), `dashboard/`, `stays/`, `smartlock/`, `rooms/`, `crm/`, `analytics/`.
- **`lib/services/`**: `auth_store.dart` (Firebase Auth session + `isAdmin` gate — allowlist or `profiles.role == 'admin'`), `booking_lifecycle.dart` (status table, transitions, hold expiry, `findDateConflicts`, `settleRefund`, `validatePublishedRates`, `applyAdminAction`), `firestore_service.dart` (streams + writes incl. `activity` entries and `site_config/rates`), `mock_data_service.dart` (demo data when Firebase is absent), `notification_service.dart`.
- **`lib/models/`**: `booking_model.dart` (accepts snake_case web docs and camelCase mocks; coarse `BookingStatus` + canonical raw status), `room_model`, `guest_crm_model`, `smart_lock_event_model`.
- **`lib/providers/`**: `app_providers.dart` — riverpod stream providers (bookings, sessions, lock logs, rooms, profiles, rates, per-booking activity) + `provider` bridge for `AuthStore`.
- **`lib/widgets/ + core/`**: design-system atoms (`hacienda_card`, `status_pill`, `section_header`, `empty_state`, `pulse_dot`, `staggered_entrance`, `pressable_card`, `luxe_progress`, `animated_tab_page`, `animated_badge`, `metric_stat_card`), theme (`core/theme/app_theme.dart`), palette (`core/constants/app_constants.dart`), utils.

### Shared backend

- **`firestore.rules`**: two roles only — `role()` from `profiles/{uid}` or the `adminEmails()` bootstrap allowlist; `isAdmin()` / guest ownership (`uid == request.auth.uid`). `bookings/{id}/activity` append-only. `site_config/rates` public read, Admin write. `tracking_sessions` closed to every caller (ADR-0009); `access_logs` signed-in create, Admin read.
- **`storage.rules`**: `kyc/{bookingId}/…` — guest upload for own booking, Admin read/delete (`isAdminEmail()` mirrors the allowlist).
- **`firestore.indexes.json`**: `bookings (uid, created_at)` for the Guest's "My bookings".

## 4. File Placement Patterns

- **Configuration:** root (`vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `pubspec.yaml`, `firebase.json`, `*.rules`, `vercel.json`). Env via `.env*` (`VITE_FIREBASE_*`); Flutter via `lib/firebase_options.dart` + `android/app/google-services.json`.
- **Models / contracts:** web `src/lib/<domain>/contract.ts`; Flutter `lib/models/*_model.dart`. Booking status vocabulary duplicated on purpose in `src/lib/booking/statuses.ts` and `lib/services/booking_lifecycle.dart` (`BookingStatuses`) — keep in sync.
- **Business logic:** web `src/lib/booking/*` (guest actions), Flutter `lib/services/booking_lifecycle.dart` (admin + system actions). UI never mutates Firestore directly.
- **Tests:** root `test/web/*.test.ts(x)` (vitest, jsdom) and `test/*_test.dart` (flutter_test). Never co-locate tests inside `src/` or `lib/`.
- **Docs:** ADRs in `docs/adr/NNNN-*.md`, agent docs in `docs/agents/`, setup / flow in `docs/*.md`, vocabulary in `/CONTEXT.md`.

## 5. Naming and Organization Conventions

- **Files — web:** `PascalCase.tsx` for components / pages, `camelCase.ts` for libs, `contract.ts` / `index.ts` / `upload.ts` / `purge.ts` for domain seams. Tests: `<domain>-<aspect>.test.ts(x)`.
- **Files — Flutter:** `snake_case.dart`. Screens end `_screen.dart`, models `_model.dart`, services `_service.dart` / `_store.dart` / `_lifecycle.dart`. Tests `<thing>_test.dart`.
- **Folders:** web `lowercase` system folders, `PascalCase` feature groups under `components/` (`Auth/`, `Booking/`), `lowercase` under `lib/`. Flutter always `lowercase`, feature subfolders under `views/`.
- **Roles in identifiers:** only `guest` and `admin` (`Role`, `ActorKind` incl. `system`, `isAdmin`, `adminEmails`). Do not introduce `staff`, `host`, `owner` identifiers — they were removed with ADR-0007.
- **No cross-imports** between `src/` and `lib/`.

## 6. Navigation and Development Workflow

- **Entry points:** web `index.html` → `src/main.tsx` → `src/App.tsx` → `src/pages/*`; Flutter `lib/main.dart` → `AuthGate` → `views/auth/admin_login_screen.dart` → `views/main_shell_screen.dart` → feature screens. Config starting points: `src/lib/firebase.ts`, `src/lib/auth/*`, `lib/services/auth_store.dart`, `firestore.rules`.
- **To understand the project:** `CONTEXT.md` (vocabulary) → `docs/README.md` (layout, roles) → `docs/adr/0007` then `0001–0006` → `src/lib/booking/*` + `lib/services/booking_lifecycle.dart` + `firestore.rules` → `docs/FLUTTER_FLOW.md`.
- **Where to add:**
  - New landing block → `src/sections/<Name>.tsx` + mount in `src/pages/Home.tsx`.
  - New **Guest** capability → `src/components/Booking/<Name>.tsx` + logic in `src/lib/<domain>/` + test in `test/web/`. Never an admin screen.
  - New **Admin** capability → `lib/views/<feature>/<name>_screen.dart` + action in `booking_lifecycle.dart` (+ `firestore_service.dart` write) + `test/<name>_test.dart`. Never a guest booking flow.
  - New backend field / rule → `firestore.rules` + `firestore.indexes.json` + `src/lib/firestoreBookings.ts` + `lib/services/firestore_service.dart` + `test/web/auth-firestore-rules.test.ts`.
- **Dependencies flow:** `pages|views` → `components|widgets` → `src/lib | lib/services` → Firebase → rules. DI: React `AuthContext` + `useAuth`; Flutter `provider` (`AuthStore`) + `flutter_riverpod` (`app_providers.dart`).

## 7. Build and Output Organization

- **Web build:** `npm run dev` (vite :3000, host 0.0.0.0), `npm run build` (`tsc -b && vite build` → `dist/`), `npm run preview`, `npm run lint`, `npm test` / `npx vitest run`. Deploy: Vercel (`vercel.json` → `dist/`) or `firebase deploy --only hosting`.
- **Flutter build:** `flutter pub get`, `flutter run`, `flutter test`, `flutter build apk --release` (`build/app/outputs/flutter-apk/app-release.apk`). Native shells `android/` + `ios/` are build inputs; hand-edit only manifests / icons / `google-services.json`.
- **Outputs (gitignored):** `dist/`, `build/`, `.dart_tool/`, `android/.gradle|build`, `ios/build`, `*.tsbuildinfo`, `*.log`, `emulator-data/`.
- **Env variants:** dev (`npm run dev`, `npm run emulators`, Flutter debug with in-memory demo data when Firebase is absent) vs prod (`dist/` + Vercel / Hosting; Flutter release APK). Missing `VITE_FIREBASE_*` → in-browser demo mode (`authLocal.ts`).

## 8. Technology-Specific Organization

- **React + Vite + TS:** ESM only; components by feature; state via Context + hooks; Firestore client in `src/lib/*` (no REST gateway); Tailwind + `lib/reveal.ts`; assets `public/`.
- **Flutter / Dart:** `flutter_riverpod` + `provider` bridge; `MaterialApp` theme in `core/theme/app_theme.dart` (palette `forest900 #0F1C11`, `olive #8A9A5B`, `cream`, `goldAccent #C5A059`); `intl`, `google_fonts`, `google_sign_in`, `fl_chart`, `flutter_local_notifications`, `firebase_messaging`. Lint via `flutter_lints`.
- **Node.js:** `vitest.config.ts` + `jsdom`; utility scripts in `scripts/*.sh`.
- **Firebase:** Auth (Email / Google / Anonymous for guests), Firestore (`profiles/{uid}.role ∈ {guest, admin}`, `bookings` + `activity`, `site_config/rates`, `access_logs`), Storage (`kyc/`). Rules are authorization; UI hiding is courtesy.

## 9. Extension and Evolution

- **Extension points:** `src/lib/<new-domain>/contract.ts + index.ts` (guest side) or `lib/services/<new>_service.dart` + `lib/models/<new>_model.dart` (admin side); expose via barrel / provider; mount in `pages/` or `views/`. Firebase: new collection → rules + indexes + both service layers together.
- **Scaling:** split `booking_lifecycle.dart` / `src/lib/booking/` by lifecycle stage before splitting by layer; extract a `widgets/` atom when reused 3+ times.
- **Adding an operator:** grant the Admin role (allowlist or `profiles.role`) — never a new role or a new app. Record any change to the two-role model in a new ADR that supersedes 0007.

## 10. Structure Templates

### New Guest feature (website)

```
src/components/Booking/<Name>.tsx     # UI (PascalCase)
src/lib/<domain>/<name>.ts            # logic (camelCase) + update contract.ts / index.ts
test/web/<domain>-<aspect>.test.ts    # vitest covering the contract
# if routed: src/pages/<Name>Page.tsx + route in App.tsx
```

### New Admin feature (Flutter)

```
lib/views/<feature>/<name>_screen.dart
lib/models/<name>_model.dart
lib/services/<name>_service.dart      # or a new AdminAction in booking_lifecycle.dart
lib/widgets/<shared_atom>.dart        # only if reused
test/<name>_test.dart
```

### New backend field / rule

```
firestore.rules                       # allow + role check (adminEmails bootstrap → profiles.role → guest ownership)
firestore.indexes.json                # composite index if queried
src/lib/firestoreBookings.ts + src/lib/<domain>/*
lib/services/firestore_service.dart + lib/models/*
test/web/auth-firestore-rules.test.ts
docs/adr/NNNN-*.md                    # if an invariant changes
```

## 11. Structure Enforcement

- **Build / type checks:** `npm run lint` (`tsc -b`) for web; `flutter analyze` + `flutter_lints` for Dart (not runnable in every sandbox — run before release).
- **Tests as guards:** `booking-module-purity.test.ts` (domain stays pure), `auth-firestore-rules.test.ts` + `auth-roles / session / routes / scoped` (two-role model, guest-only routing), `booking-lifecycle` + `booking-actions` + `date-hold` (lifecycle invariants), `booking_lifecycle_test.dart` + `published_rates_test.dart` (admin actions, refund settlement, rates validation).
- **Rules as enforcement:** `firestore.rules` + `storage.rules` refuse cross-role access even if a UI leaks.
- **Docs practice:** vocabulary → `CONTEXT.md`; invariants → `docs/adr/`; layout → `docs/README.md` + this blueprint; process → `docs/agents/`.

## 12. Maintaining This Blueprint

- Update when adding top-level folders, new `src/lib/<domain>/` or `lib/views/<feature>/`, changing routing, auth / roles, Firestore / Storage schema, or build outputs.
- Regenerate §2 tree and counts after moves (`find <dir> -type f | wc -l`, generated excluded).
- Source of truth for behavior remains code + `firestore.rules` + `docs/adr/`; this file is the map, not the territory.
