# Project Folders Structure Blueprint — Hacienda de LuisAna

> Generated via `folder-structure-blueprint-generator` skill (github/awesome-copilot).
> Config: `PROJECT_TYPE=Auto-detect | IS_MONOREPO=true (dual-app) | INCLUDES_MICROSERVICES=false | INCLUDES_FRONTEND=true | VISUALIZATION_STYLE=ASCII | DEPTH_LEVEL=3 | INCLUDE_FILE_COUNTS=true | INCLUDE_GENERATED_FOLDERS=false | INCLUDE_FILE_PATTERNS=true | INCLUDE_TEMPLATES=true`
> Last updated: 2026-09-23 (restructured: `lib/screens/` → `lib/views/admin|auth`, `lib/theme/` shim removed, `src/app/screens/` → `src/app/pages/`, `lib/models/bookings.dart` barrel). Maintain with code changes (see §12).

## 0. Initial Auto-detection Phase

### Technology signatures found

- **React + Vite + TypeScript (primary web):** `package.json` (`react ^18.3.1`, `vite ^5.4.8`, `react-router-dom ^6.26.2`), `vite.config.ts`, `tsconfig.json` / `tsconfig.app.json`, `tailwind.config.js` + `postcss.config.js`, `index.html`, `src/main.tsx` + `src/App.tsx`.
- **Node.js tooling:** `package.json` scripts (`dev`, `build`, `lint: tsc -b`, `test: vitest run`), `package-lock.json`, `vitest.config.ts`, `capacitor.config.ts` (`@capacitor/* ^8.x`).
- **Flutter / Dart (guest app):** `pubspec.yaml` (`hacienda_de_luisana`, `flutter_riverpod`, `firebase_*`, `provider ^6.1.5`, `google_fonts`, `image_picker`, `intl`), `lib/main.dart`, `android/` (`compileSdk 36`, Gradle 8.11.1, Kotlin 2.2.20), `ios/`, `assets/images/gmaps/`.
- **Firebase backend (shared):** `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `storage.cors.json`, `src/lib/firebase.ts`, `lib/firebase_options.dart`. Versions: `firebase ^12.18.0` (web), `firebase_core ^2.30.0` / `cloud_firestore ^4.17.0` (Flutter).
- **No .NET / Java / Angular signatures:** no `.sln`, `.csproj`, `pom.xml`, `build.gradle`, `angular.json`.

### Monorepo determination

Dual-app single repo, **not a formal workspace monorepo**:

- Two distinct apps with own configs: Vite web (`package.json`) + Flutter (`pubspec.yaml`), sharing one Firebase project, one brand, `CONTEXT.md` vocabulary, `docs/adr/`.
- No `lerna.json` / `nx.json` / `turborepo.json` / npm workspaces. Root-level orchestration is docs (`docs/README.md`, `AGENTS.md`, `CONTEXT.md`) + Firebase config + env (`.env*`).
- Verdict: `IS_MONOREPO=true` in the loose sense (multi-app). Treat as two bounded contexts with shared backend contract.

### Microservices check — negative

- No repeated service directories, no service Dockerfiles, no gateway / registry. Single Firestore + Storage + Auth backend. `INCLUDES_MICROSERVICES=false`.

### Frontend identification — positive

- Web assets: `public/` (favicon, `images/gmaps/`, `images/nearby/`), `src/sections/` landing blocks, `src/components/`, Tailwind (`src/styles.css`).
- Mobile UI: `lib/views/` (incl. `admin/`, `auth/`), `lib/widgets/`, `lib/core/theme/`, `assets/`.
- Build configs: `vite.config.ts`, `capacitor.config.ts` (wraps `/app` guest shell), Flutter `android/` + `ios/`.

## 1. Structural Overview

- **Organizing principle: by feature + by layer, duplicated per platform.** Web splits `pages/` (routes) → `sections/` (landing blocks) → `components/<Feature>/` (Admin/Auth/Booking) → `lib/<domain>/` (auth/booking/kyc/payments) + `app/` (Capacitor `/app` shell). Flutter splits `views/<feature>/` + `screens/` (legacy/admin) → `services/` → `models/` + `providers/` + `widgets/` + `core/`.
- **Repeating pattern:** `<feature>/contract.ts → index.ts → upload.ts / actions.ts` on web (`lib/kyc/`, `lib/payments/`, `lib/booking/`); `<feature>_model.dart + <feature>_store/service.dart + <feature>_screen.dart` in Flutter.
- **Rationale (inferred):** Firestore is the source of truth; both clients are thin shells over Booking lifecycle (`Pending → … → Completed`, see `CONTEXT.md` § Stay) with Host-gated transitions enforced in `firestore.rules`. Domain logic lives in `src/lib/booking/*` (web) and `lib/services/` (Flutter) so UI stays replaceable.
- **Monorepo relations:** `src/` and `lib/` never import each other. Shared contract is Firestore collections (`profiles`, bookings, `tracking_sessions/{bookingId}`), Storage paths (KYC / payment proof), and vocabulary in `CONTEXT.md` + `docs/adr/0001–0006`.

## 2. Directory Visualization (ASCII, depth 3, generated folders excluded)

Excluded: `node_modules/`, `dist/`, `build/`, `.dart_tool/`, `android/.gradle/`, `android/build/`, `.idea/`, `*.tsbuildinfo`, `*.log`.

```
hacienda-de-luisana/          # dual-app repo (Vite web + Flutter + Firebase)
├── src/ (83 files)           # Vite React+TS web app
│   ├── App.tsx / main.tsx
│   ├── pages/                # routes: Home, Booking, Admin, Auth, Account, LiveTracking
│   ├── sections/             # landing blocks: Hero, Accommodations, Gallery, Location…
│   ├── components/           # shared + Admin/ Auth/ Booking/ (Nav, Footer, SmartImage…)
│   ├── app/                  # Capacitor /app shell: AdminApp, components/Screen, pages/
│   ├── lib/                  # domain: auth/, booking/, kyc/, payments/, firebase, tracking…
│   ├── context/ hooks/ config/
│   └── styles.css / vite-env.d.ts
├── lib/ (53 files)           # Flutter guest app (main.dart)
│   ├── main.dart / firebase_options.dart
│   ├── core/                 # constants/, theme/, utils/ (date_formatter, geo_utils)
│   ├── models/               # booking, accommodation, tracking_session, smart_lock_event…
│   ├── services/             # booking_store, auth_store, esp32_service, firestore_service…
│   ├── providers/            # app_providers (riverpod + provider bridge)
│   ├── views/                # dashboard/, bookings/, rooms/, stays/, crm/, analytics/…
│   │   ├── admin/            # admin_bookings/records/tracking (ex-`lib/screens/`)
│   │   └── auth/             # owner_login (ex-`lib/screens/`)
│   ├── widgets/              # hacienda_card, status_pill, radar_alert_banner…
├── test/ (23 files)
│   ├── web/                  # vitest: booking-lifecycle, auth-*, kyc/payment-contract…
│   └── p1_*.dart … p4_*.dart # flutter: correctness, firestore_sync, kyc, key
├── docs/ (16 files)
│   ├── README.md / FIREBASE_SETUP.md / FLUTTER_FLOW.md / APP_PLAN.md…
│   ├── adr/0001–0006         # booking, date-hold, roles, transactions
│   └── agents/               # domain.md, issue-tracker.md, triage-labels.md
├── public/ (24 files)        # favicon.svg, CNAME, images/gmaps/, images/nearby/
├── assets/ (22 files)        # Flutter assets/images/gmaps/ mirror
├── scripts/ (3 files)        # android-icons.sh, download-gmaps.sh, download-nearby.sh
├── android/ (native) ios/    # Flutter native shells — see §7
├── index.html / vite.config.ts / tailwind.config.js / capacitor.config.ts
├── firebase.json / firestore.rules+indexes / storage.rules+cors
├── package.json / pubspec.yaml / vercel.json
└── CONTEXT.md / AGENTS.md / docs/README.md  # shared vocabulary + layout map
```

Content statistics (non-generated): `src 83 | lib 53 | test 23 (web 19 + dart 4) | docs 16 | public 24 | assets 22 | scripts 3 | ios 49 | android ~1877 (native+gradle, excluded from blueprint detail)`.

## 3. Key Directory Analysis

### Web (`src/`) — React+Vite

- ** `src/pages/`**: route entry per URL (`Home.tsx`, `BookingPage.tsx`, `AdminPage.tsx`, `AuthPage.tsx`, `AccountPage.tsx`, `LiveTrackingPage.tsx`). Thin; composes `sections/` + `components/` + `lib/`. Add a route here, never business logic.
- **`src/sections/`**: landing-page blocks (`Hero`, `Accommodations`, `Experience`, `Gallery`, `Location`, `Reviews`, `FAQ`, `Nearby`, `Stats`, `Amenities`, `Contact`, `Intro`). Presentational, Tailwind only.
- **`src/components/`**: shared (`Nav`, `Footer`, `Logo`, `SmartImage`, `MobileStickyCTA`) + grouped `Admin/` (`RatesPanel`, `TeamPanel`), `Auth/` (`LoginForm`, `ProtectedRoute`), `Booking/` (`BookingReview`, `HoldCountdown`, `KycUpload`, `PaymentStep`, `PaymentReview`, `BookingHistory`). Feature grouping is by domain, not by atom/molecule.
- **`src/app/`**: Capacitor guest shell mounted at `/app` (`AdminApp.tsx`, `components/Screen.tsx`, `pages/AdminBookingsScreen`, `AdminRecordsScreen`, `AdminTrackingScreen`, `ClientAnalyticsScreen`). Mirrors Flutter views for Host/Staff on web.
- **`src/lib/`**: domain core. `auth/` (`roles`, `profile`, `session`, `credentials`, `pages`), `booking/` (`actions`, `activity`, `availability`, `holds`, `money`, `rates`, `statuses`, `internal`), `kyc/` (`contract`, `upload`, `purge`), `payments/` (`contract`, `upload`), plus `firebase.ts`, `firestoreBookings.ts`, `tracking.ts`/`trackingSessions.ts`, `smartLockStorage.ts`, `storage.ts`, `ratesDB.ts`. Pure functions preferred (see `booking-module-purity.test.ts`).
- **`src/context/ + hooks/ + config/`**: `AuthContext.tsx`, `useAuth.ts`, `config/site.ts`. Session/RBAC glue only.

### Mobile (`lib/`) — Flutter

- **`lib/views/<feature>/` (canonical):** `dashboard/`, `bookings/`, `rooms/`, `stays/`, `crm/`, `analytics/`, `smartlock/`, `tracking/` + `main_shell_screen.dart`. Each feature owns its screen; shared chrome in `main_shell_screen`.
- **`lib/views/admin/ + views/auth/` (ex-`lib/screens/`):** `admin_bookings/records/tracking_screen.dart`, `owner_login_screen.dart`. Consolidated here 2026-09-23; `lib/screens/` and the `lib/theme/` shim deleted.
- **`lib/services/`:** `booking_store.dart` (provider+persisted source of truth), `auth_store.dart`, `firestore_service.dart` / `cloud_bookings.dart`, `kyc_storage.dart`, `esp32_service.dart` (simulated BLE: 800 ms unlock, 5 s relock), `door_key.dart`, `mock_data_service.dart`, `notification_service.dart`.
- **`lib/models/`:** `booking.dart` (guest flow) + `booking_model.dart` (admin flow) + `bookings.dart` barrel, `accommodation.dart`, `room_model.dart`, `tracking_session.dart`, `guest_location_model.dart`, `guest_crm_model.dart`, `smart_lock_event_model.dart`.
- **`lib/widgets/ + core/`:** design-system atoms (`hacienda_card`, `status_pill`, `metric_stat_card`, `radar_alert_banner`, `simulation_bar`, `luxe_progress`, `pressable_card`, `pulse_dot`, `staggered_entrance`, `animated_*`, `section_header`, `empty_state`); single theme `core/theme/app_theme.dart` (consolidated 2026-09-23); `core/utils/` (`date_formatter`, `geo_utils`), `core/constants/`.
- **`lib/providers/ + utils/`:** `app_providers.dart`, `utils/tracking.dart`, `utils/validators.dart`.

### Backend / shared (`firebase.*`, `storage.*`)

- `firebase.json` (hosting `dist`, emulators), `firestore.rules` (role resolution: bootstrap allowlist → `profiles/{uid}` → Guest; mirrors `src/lib/auth`), `firestore.indexes.json`, `storage.rules` + `storage.cors.json`. Treat as contract — web and Flutter must satisfy the same rules.

### Support (`test/`, `docs/`, `public/`, `assets/`, `scripts/`)

- **`test/web/`**: vitest per-domain (`booking-lifecycle`, `date-hold`, `auth-*`, `kyc-contract`, `payment-*`, `published-rates`). **`test/*.dart`**: `p1_local_correctness`, `p2_firestore_sync`, `p3_kyc`, `p4_key`.
- **`docs/adr/0001–0006`**: approve-before-pay, date-hold read-time expiry, approval recheck, anonymous identity at creation (ADR-0004), stored roles + allowlist bootstrap (ADR-0005), transactional approval.
- **`public/` vs `assets/`**: web serves `public/images/gmaps|nearby/`; Flutter bundles `assets/images/gmaps/`. Keep filenames in sync when adding imagery.
- **`scripts/`**: `download-gmaps.sh`, `download-nearby.sh`, `android-icons.sh` — asset fetch/generation only.

## 4. File Placement Patterns

- **Configuration:** root only — Vite (`vite.config.ts`), TS (`tsconfig*.json`), Tailwind/PostCSS, Capacitor, Vercel (`vercel.json`), Firebase (`firebase.json`, `firestore.*`, `storage.*`), Flutter (`pubspec.yaml`, `analysis_options` if added). Env: `.env.example` (committed) → `.env.local` / `.env` (gitignored). Never nest configs inside `src/` or `lib/`.
- **Domain models:** web `src/lib/<domain>/*.ts` (`booking/money.ts`, `kyc/contract.ts`); Flutter `lib/models/*.dart`. DTO/schema stays with domain, not with UI.
- **Business logic:** web `src/lib/<domain>/actions.ts|availability.ts|holds.ts` + `src/lib/*Service*.ts`; Flutter `lib/services/*_store.dart|*_service.dart`. UI files must not contain Firestore writes directly (except thin wrappers).
- **Interfaces/abstractions:** web `*/contract.ts` + `*/index.ts` barrel (`lib/kyc/index.ts`, `lib/payments/index.ts`, `lib/booking/index.ts`); Flutter `lib/core/` + model classes. Group by domain folder.
- **Tests:** web `test/web/<domain>-*.test.ts(x)` mirroring `src/lib/<domain>`; Flutter `test/pN_*.dart`. Mocks in `lib/services/mock_data_service.dart` (Flutter) and localStorage fallback in `src/lib/authLocal.ts` (web demo mode). Never co-locate `*.test.*` inside `src/` — root `test/` is the convention.
- **Docs:** ADRs in `docs/adr/NNNN-*.md`, agent docs in `docs/agents/`, setup/flow in `docs/*.md`, vocabulary in `/CONTEXT.md`. READMEs distributed: root `docs/README.md` (layout), `public/images/fb/README.md` (asset notes).

## 5. Naming and Organization Conventions

- **Files — web:** `PascalCase.tsx` for components/pages (`LoginForm.tsx`, `BookingPage.tsx`), `camelCase.ts` for libs (`authFirebase.ts`, `firestoreBookings.ts`), `contract.ts` / `index.ts` / `upload.ts` / `purge.ts` suffixes for domain seams. Tests: `<domain>-<aspect>.test.ts(x)` kebab (`booking-lifecycle.test.ts`, `auth-scoped.test.tsx`).
- **Files — Flutter:** `snake_case.dart` throughout (`booking_store.dart`, `tracking_radar_screen.dart`, `guest_crm_model.dart`). Screens end `_screen.dart`, models `_model.dart` (except `booking.dart`/`accommodation.dart`), services `_store.dart`/`_service.dart`.
- **Folders — web:** `lowercase` for system (`lib/`, `pages/`, `hooks/`), `PascalCase` for feature groups under `components/` (`Admin/`, `Auth/`, `Booking/`) and `lowercase` under `lib/` (`auth/`, `booking/`, `kyc/`, `payments/`). **Folders — Flutter:** always `lowercase` singular (`views/`, `models/`, `services/`, `core/`), feature subfolders singular (`analytics/`, `bookings/`, `crm/`).
- **Namespaces/modules:** web barrel `index.ts` per domain maps 1:1 to folder (`lib/booking/index.ts` re-exports `actions|holds|money|…`); Flutter `package:` imports mirror `lib/` path. No cross-imports between `src/` and `lib/` — shared surface is Firestore/Storage schema + `CONTEXT.md` terms.
- **Co-location vs separation:** co-locate presentational helpers with feature (`components/Booking/HoldCountdown.tsx` next to `PaymentStep.tsx`); separate cross-cutting concerns (`tracking.ts`, `storage.ts`, `validators.dart`, `geo_utils.dart`). Public API (`contract.ts`, model class) separated from implementation (`internal.ts`, `upload.ts`, service impl).

## 6. Navigation and Development Workflow

- **Entry points:** web `index.html` → `src/main.tsx` → `src/App.tsx` (router) → `src/pages/*`; Flutter `lib/main.dart` → `views/main_shell_screen.dart` → per-feature screens. Config starting points: `src/lib/firebase.ts`, `src/lib/auth/*`, `lib/firebase_options.dart`, `firestore.rules`.
- **To understand the project:** read `CONTEXT.md` (vocabulary) → `docs/README.md` (layout) → `docs/adr/` (booking/payment/date-hold/roles invariants) → `src/lib/booking/*` + `firestore.rules` → `src/pages/AdminPage.tsx` + `lib/services/booking_store.dart`.
- **Where to add:**
  - New landing block → `src/sections/<Name>.tsx` + route in `src/pages/Home.tsx` if needed.
  - New booking step / admin panel → `src/components/<Feature>/<Name>.tsx` + logic in `src/lib/<domain>/` + test in `test/web/`.
  - New guest capability → `lib/views/<feature>/<name>_screen.dart` + model in `lib/models/` + service in `lib/services/` + reusable UI in `lib/widgets/`.
  - New backend field/rule → `firestore.rules` + `firestore.indexes.json` + both `src/lib/firestoreBookings.ts` and `lib/services/firestore_service.dart` + `test/web/auth-firestore-rules.test.ts` + `test/p2_*`.
- **Dependencies flow:** `pages|views` → `components|widgets` → `lib/services|src/lib` → `firebase/firestore` → rules. DI: React `AuthContext` + `useAuth`; Flutter `provider` + `flutter_riverpod` via `lib/providers/app_providers.dart`. Never import UI from `lib/` domain files.
- **Content stats:** §2 counts; complexity concentrates in `src/lib/booking/` (9 modules), `src/lib/auth/` (6), `lib/services/` (9), `lib/views/` (8 features).

## 7. Build and Output Organization

- **Web build:** `npm run dev` (vite :3000), `npm run build` (`tsc -b && vite build` → `dist/`), `npm run preview`, `npm run lint` (`tsc -b`), `npm test` (vitest). Capacitor wrap: `npm run android:sync` (`build && cap sync`). Deploy: Vercel (`vercel.json` → `dist/`) or `firebase deploy --only hosting` (`public=dist`), GH Pages workflow.
- **Flutter build:** `flutter pub get`, `flutter run` / `flutter run -d chrome`, `flutter test` (`test/p*_test.dart`). Native shells `android/` + `ios/` are build inputs, not hand-edited except manifests/icons.
- **Outputs (gitignored, never document in detail):** `dist/`, `build/`, `.dart_tool/`, `android/.gradle|build`, `ios/build`, `*.tsbuildinfo`, `*.log` (`dev*.log`, `emu.log`, `firebase-debug.log`). Only `src/`, `lib/`, configs, and `public/`/`assets/` sources are tracked.
- **Env variants:** dev (`npm run dev`, Firebase emulators `npm run emulators --project demo-hacienda`, Flutter debug) vs prod (`dist/` + Vercel/Firebase Hosting, Flutter release APK e.g. `hacienda-client2.apk` — untracked artifact). Env via `VITE_FIREBASE_*`; missing keys → in-browser demo mode (`authLocal.ts`, PBKDF2, `Continue as Host/Staff/Guest` banner).

## 8. Technology-Specific Organization

- **React+Vite+TS:** ESM only (`"type": "module"`); scripts in `package.json`; components by feature (`components/<Feature>/`); state via Context + hooks; API layer `src/lib/*` (Firestore client, no REST gateway); styles Tailwind (`tailwind.config.js`, `src/styles.css`) + `lib/reveal.ts` for scroll effects; assets `public/` served at root.
- **Flutter/Dart:** `flutter_riverpod` + `provider` bridge; `MaterialApp` theme in `core/theme/app_theme.dart` (palette `forest900 #0F1C11`, `olive #8A9A5B`, `cream`, `goldAccent #C5A059`); `intl`, `google_fonts`, `url_launcher`, `image_picker`, `shared_preferences`, `crypto`, `google_sign_in`, `firebase_app_check`; maps/location `google_maps_flutter` + `geolocator`; charts `fl_chart`; notifications `flutter_local_notifications` + `firebase_messaging`. Lint via `flutter_lints`.
- **Node.js specifics:** `vitest.config.ts` + `jsdom`, ` Capacitor 8` plugins (`App`, `Browser`, `Share`, `SplashScreen`, `StatusBar`); utility scripts in `scripts/*.sh` (not `package.json` bin).
- **Firebase specifics:** Auth (Email/Google/Anonymous), Firestore (`profiles/{uid}` roles, bookings, `tracking_sessions/{bookingId}` with 30-day read-time expiry + self-delete stop-share), Storage (KYC IDs, payment proofs). Rules are authorization (UI hiding is courtesy). Indexes in `firestore.indexes.json`; CORS in `storage.cors.json`.
- **No .NET/Java patterns present** — skill template sections for those stacks intentionally omitted.

## 9. Extension and Evolution

- **Extension points:** add `src/lib/<new-domain>/contract.ts+index.ts` or `lib/services/<new>_service.dart` + `lib/models/<new>_model.dart`; expose via barrel/provider; mount UI in `pages/` or `views/`. Firebase: new collection → rules + indexes + both clients' service layers together.
- **Scaling:** split large `booking/` or `booking_store.dart` by lifecycle stage (holds → payment → check-in → tracking) rather than by technical layer; extract `widgets/` atom when reused 3+ times; prefer new `views/<feature>/` over growing `screens/`.
- **Refactoring pattern observed:** restore-then-extend (Vite files restored from `11edf1a` while keeping Flutter app; see `docs/README.md` Cleanup Notes). Keep `preview/`/`dist/`/`hacienda_flutter/` deletions permanent — they are gitignored outputs. Record structural moves in `docs/adr/` when they change invariants.

## 10. Structure Templates

### New web feature (booking-adjacent)

```
src/components/<Feature>/<Name>.tsx   # UI (PascalCase)
src/lib/<domain>/<name>.ts            # logic (camelCase) + update contract.ts/index.ts
test/web/<domain>-<aspect>.test.ts    # vitest covering contract
# if routed: src/pages/<Name>Page.tsx + route in App.tsx
```

### New Flutter feature

```
lib/views/<feature>/<name>_screen.dart
lib/models/<name>_model.dart
lib/services/<name>_service.dart  # or _store.dart if persisted/provider
lib/widgets/<shared_atom>.dart    # only if reused
test/pN_<name>_test.dart
```

### New backend field / rule

```
firestore.rules                     # allow + role check (hostEmails bootstrap → profiles → Guest)
firestore.indexes.json              # composite index if queried
src/lib/firestoreBookings.ts + src/lib/<domain>/*
lib/services/firestore_service.dart + lib/models/*
test/web/auth-firestore-rules.test.ts + test/p2_firestore_sync_test.dart
docs/adr/NNNN-*.md                  # if invariant changes
```

### New test

```
test/web/<domain>-<thing>.test.ts   # mirrors src/lib/<domain>/
test/pN_<thing>_test.dart           # mirrors lib/services|models
```

Naming reminder: web components `PascalCase`, web libs `camelCase`, Dart `snake_case`; never place tests inside `src/` or `lib/`.

## 11. Structure Enforcement

- **Build/type checks:** `npm run lint` (`tsc -b`) blocks structural drift in imports/barrels; `flutter analyze` + `flutter_lints` for Dart.
- **Tests as structure guards:** `booking-module-purity.test.ts` (domain stays pure), `auth-firestore-rules.test.ts` + `auth-roles/session/routes/scoped` (RBAC + routing shape), `booking-lifecycle` + `date-hold` (lifecycle invariants), `p1–p4` Dart (local correctness → sync → KYC → key).
- **Rules as enforcement:** `firestore.rules` + `storage.rules` refuse cross-role access even if UI leaks; `storage.cors.json` constrains web uploads.
- **Docs practice:** vocabulary changes → `CONTEXT.md`; invariant changes → new `docs/adr/NNNN-*.md`; layout changes → `docs/README.md` + this blueprint; triage/process → `docs/agents/`. `AGENTS.md` points agents to `docs/README.md` + `docs/agents/domain.md` first.

## 12. Maintaining This Blueprint

- Update when adding top-level folders, new `src/lib/<domain>/` or `lib/views/<feature>/`, changing routing, auth/roles, Firestore/Storage schema, or build outputs.
- Regenerate §2 tree after moves; refresh §2 file counts (`Get-ChildItem -Recurse -File` per dir, generated excluded).
- Source of truth for behavior remains code + `firestore.rules` + `docs/adr/`; this file is the map, not the territory.
