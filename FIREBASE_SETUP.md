# Firebase Integration — Hacienda de LuisAna

This document explains how Firebase was integrated into the Hacienda de LuisAna website.

## 🔧 What Was Implemented

### 1. Firebase SDK & Configuration
- Installed `firebase` v10+ (modular SDK)
- Created `src/lib/firebase.ts`:
  - Centralized config using Vite env vars (`VITE_FIREBASE_*`)
  - Singleton initialization with HMR safety
  - Exports `app`, `auth`, `db` (Firestore), `storage`, `googleProvider`
  - `isFirebaseConfigured` flag for graceful fallback
  - Optional Analytics support

### 2. Environment Variables
- `.env.example` template with all required keys
- `.env.local` is gitignored (already in `.gitignore`)
- Vite type definitions in `src/vite-env.d.ts`

Required vars:
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID (optional)
```

### 3. Authentication (Email + Google)
- `src/context/AuthContext.tsx`: Global auth state provider
  - Email/password login & registration
  - Google OAuth via popup
  - Password reset
  - `onAuthStateChanged` listener
- `src/hooks/useAuth.ts`: Reusable hook
- `src/components/Auth/LoginForm.tsx`:
  - Reusable login/register/reset UI
  - Friendly error mapping
  - Shows setup instructions if Firebase not configured
- `src/components/Auth/ProtectedRoute.tsx`:
  - Protects `/admin` route
  - Allows local demo mode when Firebase not configured

**Integration points:**
- `src/main.tsx` wrapped with `<AuthProvider>`
- `src/App.tsx` protects `/admin` with `<ProtectedRoute>`
- `src/components/Nav.tsx` shows Dashboard / Sign out when logged in

### 4. Firestore Database
- `src/lib/firestoreBookings.ts`:
  - Cloud-aware service: uses Firestore when configured, falls back to `localStorage` otherwise
  - Methods: `list()`, `subscribe()`, `add()`, `update()`, `remove()`
  - Real-time listener via `onSnapshot`
- `src/pages/BookingPage.tsx`:
  - Now writes to Firestore (or local fallback)
  - Shows cloud/local status badge
- `src/pages/AdminPage.tsx`:
  - Real-time subscription
  - Update status, delete, view details
  - Stats, calendar, Firebase status panel
  - Preserves all original UI

**Firestore Rules** (`firestore.rules`):
- Anyone can `create` a booking (guest form)
- Only authenticated users can `read/update/delete`
- Validation for required fields
- Example for future collections (gallery, site_config)

**Indexes** (`firestore.indexes.json`):
- `status + created_at` and `check_in + check_out`

### 5. Firebase Hosting
- `firebase.json`:
  - Serves `dist` (Vite build)
  - SPA rewrite to `index.html`
  - Cache headers for JS/CSS
  - Security headers
- `.firebaserc.example`: Template for project ID
- `storage.rules`: Public read for gallery, auth write

## 🚀 Quick Start

### 1. Create Firebase Project
1. Go to https://console.firebase.google.com
2. Create new project (e.g., `hacienda-de-luisana`)
3. Enable services:
   - **Authentication**: Email/Password + Google
   - **Firestore**: Start in production mode, choose region
   - **Storage**: Start in production mode
   - **Hosting** (optional): For deployment

### 2. Get Config
Project Settings → General → Your apps → Web app → SDK config

### 3. Configure Local Env
```bash
cp .env.example .env.local
# Edit .env.local with your keys
npm run dev
```

### 4. Deploy Firestore Rules & Indexes
```bash
npm install -g firebase-tools
firebase login
firebase use --add  # select your project, alias default
# copy .firebaserc.example to .firebaserc and set your projectId
cp .firebaserc.example .firebaserc
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 5. Deploy Hosting
```bash
npm run build
firebase deploy --only hosting
```

## 🔐 Security Notes

- API keys in `.env.local` are safe to expose client-side; security is enforced by Firestore Rules & Auth
- Never commit `.env.local`
- Firestore Rules currently allow public booking creation but restrict read/update to authenticated users
- For stricter owner-only access, uncomment email whitelist in `firestore.rules`:
  ```js
  allow read, update, delete: if isSignedIn() && request.auth.token.email in ['owner@example.com'];
  ```
- Storage Rules limit uploads to 10MB images, avatars to 2MB

## 📁 Files Added/Modified

**Added:**
- `src/lib/firebase.ts`
- `src/context/AuthContext.tsx`
- `src/hooks/useAuth.ts`
- `src/components/Auth/LoginForm.tsx`
- `src/components/Auth/ProtectedRoute.tsx`
- `src/lib/firestoreBookings.ts`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `.firebaserc.example`
- `.env.example`
- `FIREBASE_SETUP.md`

**Modified:**
- `src/main.tsx` (AuthProvider wrapper)
- `src/App.tsx` (ProtectedRoute for /admin)
- `src/pages/BookingPage.tsx` (Firestore integration)
- `src/pages/AdminPage.tsx` (real-time + auth + cloud-aware)
- `src/components/Nav.tsx` (auth state)
- `src/vite-env.d.ts` (env types)
- `package.json` (firebase dependency)

## 🧪 Build Test

```bash
npm install
npm run build
# Should compile with no errors
```

## 🛠 Troubleshooting

- **"Firebase not configured" warning**: Create `.env.local` from `.env.example`
- **Auth popup blocked**: Allow popups or use email login
- **Firestore permission denied**: Check `firestore.rules` deployed, user is logged in
- **Google login fails**: Add authorized domain in Firebase Console → Auth → Settings → Authorized domains (include your preview host)
- **Hosting 404 on refresh**: Ensure `firebase.json` rewrite to `/index.html` is deployed

## 📚 Next Steps (Optional)

- Add Cloud Functions for email notifications on new booking
- Add Firebase Storage upload for gallery management in admin
- Add role-based access (admin vs staff) using custom claims
- Add Analytics events for booking funnel
- Add offline persistence: `enableIndexedDbPersistence(db)`

---

Built for Hacienda de LuisAna — private countryside escape in Luisiana, Laguna.
