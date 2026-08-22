# Hacienda de LuisAna — Website

Private countryside escape in Luisiana, Laguna. Built with React + Vite + TypeScript + Tailwind CSS, now integrated with Firebase (Auth, Firestore, Hosting).

![Hacienda](https://haciendadeluisana.com/favicon.svg)

## ✨ Features

- Responsive landing page (Hero, Accommodations, Experience, Gallery, Location, Reviews, FAQ)
- Booking inquiry form → Firestore (or localStorage fallback)
- Owner Admin Dashboard at `/admin`:
  - Protected by Firebase Auth (Email + Google)
  - Real-time bookings from Firestore
  - Stats, calendar, status management
- Firebase integration:
  - Authentication
  - Firestore Database
  - Storage
  - Hosting

## 🚀 Quick Start

```bash
# Install
npm install

# Dev (requires .env.local for Firebase, else local fallback)
npm run dev

# Build
npm run build

# Preview build
npm run preview
```

## 🔧 Firebase Setup

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) for full guide.

**TL;DR:**
1. Create Firebase project at https://console.firebase.google.com
2. Enable Auth (Email + Google), Firestore, Storage
3. Copy config:
   ```bash
   cp .env.example .env.local
   # Fill keys in .env.local
   ```
4. Deploy rules & hosting:
   ```bash
   firebase deploy --only firestore:rules,storage,hosting
   ```

## 📁 Project Structure

```
src/
  components/
    Auth/
      LoginForm.tsx          # Reusable login (email + Google)
      ProtectedRoute.tsx     # Auth guard for /admin
    Nav.tsx, Footer.tsx, ...
  context/
    AuthContext.tsx          # Global auth state
  hooks/
    useAuth.ts
  lib/
    firebase.ts              # Firebase init (env-based)
    firestoreBookings.ts     # Cloud-aware bookings service
    storage.ts               # Original localStorage fallback
  pages/
    Home.tsx
    BookingPage.tsx          # Now writes to Firestore
    AdminPage.tsx            # Real-time + auth
  config/site.ts             # Business content source of truth
```

## 🔐 Environment Variables

All Firebase keys use `VITE_` prefix (Vite requirement). See `.env.example`.

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID (optional)
```

## 📦 Deployment

### Firebase Hosting
```bash
npm run build
firebase deploy --only hosting
```

### Vercel (existing)
`vercel.json` already present — just set env vars in Vercel dashboard.

### GitHub Pages
Workflow in `.github/workflows/deploy.yml` — add secrets for Firebase env vars.

## 🧪 Build Verification

CI should run:
```bash
npm ci
npm run build
```

## 📄 License

Private project for Hacienda de LuisAna.
