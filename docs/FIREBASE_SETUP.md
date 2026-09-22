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

### 3. Authentication & RBAC (Email + Google for people, Anonymous for guests)

Three roles, from `CONTEXT.md` § People: **Guest**, **Host**, **Staff**. A role is stored at
`profiles/{uid}` and enforced by `firestore.rules` — see
[ADR-0005](./adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md).

**`src/lib/auth/` — the authorization core (pure: no Firebase, no browser APIs)**
- `roles.ts`: the three roles, the permission catalogue, `can(role, permission)`
- `pages.ts`: which page each permission opens (`/admin`, `/app`, `/app/tracking`, `/account`)
- `profile.ts`: `resolveRole()` — bootstrap allowlist, then Profile, then Guest
- `credentials.ts`: input validation/sanitising and every failure in words (`describeAuthError`)
- `session.ts`: `createSession(authPort, profilePort)` — sign-up, sign-in, sign-out, restore,
  role changes, and the actor a Booking action is attributed to

**Adapters — two implementations of the same two ports**
- `src/lib/authFirebase.ts`: Firebase Auth (`browserLocalPersistence`, so a reload keeps the
  session) + Firestore `profiles`
- `src/lib/authLocal.ts`: demo mode with no Firebase — accounts, PBKDF2-SHA256 (210k rounds,
  per-account salt) password hashes, Profiles and the session in this browser's localStorage
- `src/lib/authSession.ts`: picks one, once

**React seam**
- `src/context/AuthContext.tsx`: `user`, `role`, `can()`, `canOpen()`, `actor`, and the actions
- `src/hooks/useAuth.ts`: the hook every page uses
- `src/components/Auth/LoginForm.tsx`: one form for all three roles; sign-up makes a Guest
- `src/components/Auth/ProtectedRoute.tsx`: spinner → sign-in → **403 for the wrong role**,
  reading the path it stands on, so a nested page answers from its own rule
- `src/components/Auth/TeamPanel.tsx`: the Host's `/admin?tab=team` list — who has which role
- `src/lib/guestAuth.ts`: `ensureGuestUid()` is called when `/book` creates a Booking, so the
  document carries the uid that `firestore.rules` and `storage.rules` key guest access to; in
  demo mode it returns the signed-in local account's uid instead

**Integration points:**
- `src/main.tsx` wrapped with `<AuthProvider>`
- `src/App.tsx` protects `/admin` (Host), `/app` and its tabs (Host + Staff), `/account` (Guest)
- `src/components/Nav.tsx` shows only the links this role may open, plus Sign in / Sign out
- `src/components/Booking/BookingReview.tsx` reads its own actor's role: a Staff session sees the
  Booking without the approve/refuse controls and without the government ID

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

**Firestore Rules** (`firestore.rules`) — the enforcement:
- `role()` resolves a request: the bootstrap email allowlist, then `profiles/{uid}`, then `guest`
- Anyone can `create` a Pending booking (the public inquiry form)
- Bookings: read by their own Guest, the Host and Staff; updated by the Host freely, by **Staff
  only** to move `Checked-Out → Completed`, and by a Guest only on their own document, only
  forward or out, and only within a fixed key list; deleted by the Host
- `profiles`: you may write your own, only as a Guest; the Host may write anybody's; nobody may
  write a role that is not one of the three; a person may edit their own name but never their own role
- `bookings/{id}/activity`: append-only, and an entry must be written in the writer's own role
- `access_logs`: created by any signed-in client, read by Host + Staff, corrected by the Host
- Everything else is denied by a final catch-all
- `test/web/auth-firestore-rules.test.ts` asserts all of the above, and that the rules and
  `src/lib/auth` keep the same two bootstrap addresses

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
   - **Authentication**: Email/Password + Google + **Anonymous**
     (Anonymous is required for guest KYC uploads from the website — see
     `docs/adr/0004-*.md`. Without it, bookings are created with no guest
     identity and the site cannot attach an ID to them.)
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

### 3b. Google sign-in (powers `/guest/auth` and `/admin/auth`)
1. Console → Authentication → Sign-in method → enable **Google** (Email/Password stays on).
2. Console → Authentication → Settings → Authorized domains → add every host that
   serves the site: `localhost`, your Vercel preview domain, `haciendadeluisana.com`.
   An unlisted domain fails with `auth/unauthorized-domain`, which the sign-in form
   says in words.
3. Open `/guest/auth` (or `/admin/auth`) with keys configured: the
   **Continue with Google** button is there; without keys the same pages run in demo
   mode and offer the three demo roles instead.

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

- API keys in `.env.local` are safe to expose client-side; security is enforced by Firestore Rules & Auth.
  Never commit `.env.local`, and never put a secret in a `VITE_` variable — anything Vite exposes is public.
- Passwords are never stored by this app. Firebase hashes them server-side; the demo-mode adapter hashes
  them with PBKDF2-SHA256 (210,000 rounds, a 16-byte salt per account) and stores only the derived key.
- Public booking creation stays public, but only as a `Pending` Booking with the required fields; every
  read and write past that needs a role the rules can see.
- Owner-only access is the `hostEmails()` allowlist plus `profiles/{uid}` — edit `hostEmails()` in
  `firestore.rules`, `storage.rules`, `BOOTSTRAP_ROLES` in `src/lib/auth/profile.ts` and
  `AuthStore.kOwnerEmail` in the Flutter app, then `firebase deploy --only firestore:rules,storage`.
- A role is never read from the body of a request: the rules take it from the signed-in identity's own
  Profile, and the test suite asserts that `request.resource.data.role` appears nowhere else.
- Storage Rules limit uploads to 10MB site images, 2MB avatars and 5MB KYC documents; `/kyc` is readable
  only by the Guest it belongs to and the Host — Staff are deliberately absent.

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
- Move roles from `profiles/{uid}` to custom claims (one `role()` implementation changes; no caller does) —
  worth it only once rule-evaluation reads on `profiles` show up in the bill
- Let the Host create a Staff account directly (needs the Admin SDK, i.e. a Cloud Function)
- Mirror the three roles in the Flutter app: it already refuses what the rules refuse, but its screens
  still read `AuthStore.isOwner` / `isAnak` rather than a stored Role
- Add Analytics events for booking funnel
- Add offline persistence: `enableIndexedDbPersistence(db)`

---

Built for Hacienda de LuisAna — private countryside escape in Luisiana, Laguna.
