# Hacienda de LuisAna

Private countryside escape in Luisiana, Laguna. This repository contains **two apps** sharing the same brand:

- **Vite Website** (React + Vite + TypeScript + Tailwind + Firebase) — deployed on **Vercel** (`haciendadeluisana.com`) and Firebase Hosting. Landing page + booking + admin dashboard.
- **Flutter Guest App** — quiet-luxury mobile prototype with booking, KYC, guest dashboard and simulated ESP32 Smart Lock.

![Hacienda](https://haciendadeluisana.com/favicon.svg)

---

## Repository Layout

```
# Vite Web (Vercel / Firebase)
src/                    # React app (components, pages, sections, lib)
public/                 # Static assets (images/gmaps, nearby, favicon, CNAME)
index.html
vite.config.ts
tailwind.config.js
postcss.config.js
tsconfig.json
capacitor.config.ts     # Capacitor wrapper for /app guest shell
firebase.json / firestore.* / storage.rules
vercel.json
package.json

# Flutter Mobile
lib/                    # Flutter app (main.dart, models/, services/, theme/)
assets/images/gmaps/    # Flutter asset images
pubspec.yaml
android/                # Flutter Android project (Gradle 8.11.1, Kotlin 2.2.20)
```

Only **Flutter app + Vite** are tracked. Build outputs (`dist/`, `build/`, `.dart_tool/`, `android/.gradle/`, `.idea/`, `hacienda_flutter/` duplicate, `preview/`) are gitignored and removed.

---

## Vite Website — Features

- Responsive landing (Hero, Accommodations, Experience, Gallery, Location, Reviews, FAQ)
- Booking inquiry → Firestore (localStorage fallback)
- Owner Admin at `/admin` — Firebase Auth (Email + Google), real-time bookings, stats/calendar
- Firebase: Auth, Firestore, Storage, Hosting
- Guest mobile shell at `/app` (capacitor)

### Quick Start (Vite)

```bash
npm install
cp .env.example .env.local   # fill VITE_FIREBASE_* keys
npm run dev                  # http://localhost:5173  (+ /app)
npm run build
npm run preview
```

### Firebase Setup

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md). TL;DR:

1. Create project at https://console.firebase.google.com
2. Enable Auth (Email + Google), Firestore, Storage
3. `firebase deploy --only firestore:rules,storage,hosting`

### Deployment

- **Vercel**: `vercel.json` present — set `VITE_*` env vars in dashboard. Deployed build is `dist/`.
- **Firebase Hosting**: `firebase deploy --only hosting` (public = `dist`)
- **GitHub Pages**: workflow `.github/workflows/deploy.yml`

Env vars (`VITE_` prefix required): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.

---

## Flutter App — Quiet Luxury Guest Prototype

### Tech Stack

- **Flutter 3.44.4 / Dart 3.12** — `provider: ^6.1.2`, `google_fonts: ^6.2.1`, `flutter_spinkit: ^5.2.1`, `url_launcher: ^6.2.5`, `image_picker: ^1.1.2`, `intl: ^0.19.0`
- Theme palette (`lib/theme/app_theme.dart`): `forest900 #0F1C11`, `forest800 #243B26`, `olive #8A9A5B`, `cream50 #FBF9F3`, `cream100 #F3EFE0`, `goldAccent #C5A059`

### App Structure (`lib/main.dart`)

1. **Home** — 380px SliverAppBar hero PageView (`assets/images/gmaps/img-03/05/07.jpg`), stats (12 guests / 2 decks / 4.9★), featured stays.
2. **Stay** — ChoiceChip filters (All / Main House / Camping), cards + detail modal (Main House 12 @ ₱8,500; Camping A 4 @ ₱1,800; Camping B 4 @ ₱1,500).
3. **Explore** — Nearby (Hulugan Falls, Aliw Falls, Caliraya Lake, Kamay ni Hesus) + Open in Maps + 2-col gallery.
4. **Book** — 2-step form (accommodation, dates, guests 1-12) → `Booking:HDL-xxx` (`lib/models/booking.dart`).
5. **Key / Dashboard** — `BookingStore` (provider), status badge, check-in/out summary, Digital Key (enabled when confirmed), host contact (`tel:+639258507707`).
6. **KYC & ESP32** — `KycScreen` (ID + receipt image_picker) → `BookingConfirmationScreen`; `Esp32Service` simulated BLE 5.0 (800ms unlock, 5s auto re-lock, 1.2s press-and-hold `SpinKitPulse`).

### Run (Flutter)

```bash
flutter pub get
flutter run               # Android emulator/device
flutter run -d chrome     # Web
```

Android project is Flutter-native (`android/` with `compileSdk 36`, `ndkVersion 30.0.14904198`, Kotlin 2.2.20). The previous Capacitor `android/` has been superseded — use `flutter` tooling, not `npx cap`.

---

## Cleanup Notes

This commit reverts the Flutter-only replacement (merge #3) and restores the Vercel-deployed Vite + Firebase files from `11edf1a`, while keeping the Flutter app. Removed `preview/`, `dist/`, `hacienda_flutter/` duplicate, `.idea/`, `android/.idea/`, `pubspec.lock`, `tsconfig.tsbuildinfo`, and generated `GeneratedPluginRegistrant.java`. Updated `.gitignore` to cover both Vite and Flutter workflows.
