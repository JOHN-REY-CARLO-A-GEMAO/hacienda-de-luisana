# Firebase Integration — Hacienda de LuisAna

This document explains how Firebase backs the Hacienda de LuisAna system: the Guest website (`src/`) and the Admin mobile app (`lib/`).

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

### 3. Authentication & roles (Email + Google for people, Anonymous for web Guests)

Two roles, from `CONTEXT.md` § People: **Guest** and **Admin** — no Staff, no Host
([ADR-0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)). A role is
stored at `profiles/{uid}` and bootstrapped by an email allowlist
([ADR-0005](./adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md));
`firestore.rules` enforces it. The website signs Guests in; the Admin signs in on the Flutter app.

**`src/lib/auth/` — the website's authorization core (pure: no Firebase, no browser APIs)**
- `roles.ts`: the two roles, the permission catalogue, `can(role, permission)`
- `pages.ts`: which page a permission opens (`/account`) and where each role lands (`homeForRole`)
- `profile.ts`: `resolveRole()` — bootstrap allowlist (`BOOTSTRAP_ROLES`), then Profile, then Guest
- `credentials.ts`: input validation/sanitising and every failure in words (`describeAuthError`)
- `session.ts`: `createSession(authPort, profilePort)` — sign-up, sign-in, Google, sign-out, reset,
  restore, and the actor a Booking action is attributed to

**Adapters — two implementations of the same two ports**
- `src/lib/authFirebase.ts`: Firebase Auth (`browserLocalPersistence`) + Firestore `profiles`
- `src/lib/authLocal.ts`: demo mode with no Firebase — Guest accounts, PBKDF2-SHA256 (210k rounds,
  per-account salt) password hashes and the session in this browser's localStorage; every account it
  creates is a Guest
- `src/lib/authSession.ts`: picks one, once

**React seam**
- `src/context/AuthContext.tsx`: `user`, `role`, `can()`, `canOpen()`, `actor`, and the actions
- `src/hooks/useAuth.ts`: the hook every page uses
- `src/components/Auth/LoginForm.tsx`: Guest sign-in / sign-up (email + Google); sign-up makes a Guest
- `src/components/Auth/ProtectedRoute.tsx`: spinner → sign-in → **turned away for the wrong role**
  (an Admin on `/account` is told this website is for Guests and pointed to the Admin app)
- `src/lib/guestAuth.ts`: `ensureGuestUid()` is called when `/book` creates a Booking, so the
  document carries the uid that `firestore.rules` and `storage.rules` key Guest access to; in
  demo mode it returns the signed-in local account's uid instead

**Integration points:**
- `src/main.tsx` wrapped with `<AuthProvider>`
- `src/App.tsx` protects `/account` (Guest); `/admin/*` and `/app/*` render a "moved to the Admin app" notice
- `src/components/Nav.tsx` shows Book / My Bookings / Sign in / Sign out

**The Admin app (`lib/services/auth_store.dart`)**
- Google or email + password through Firebase Auth; `isAdmin` = allowlist (`AuthStore.kAdminEmails`)
  **or** `profiles/{uid}.role == 'admin'`; any other account is signed straight back out
- The Admin's writes go through `lib/services/booking_lifecycle.dart` (the same lifecycle table as
  `src/lib/booking`) and `FirestoreService.applyBookingAction`, which stores the patch and the Activity
  entry in one batch

### 4. Firestore Database
- `src/lib/firestoreBookings.ts` (website):
  - Cloud-aware service: uses Firestore when configured, falls back to `localStorage` otherwise
  - Guest scope: `listMine()`, `subscribeMine()`, `add()`, and `takeAction()` for the Guest's own
    lifecycle actions (UploadKyc, ChoosePaymentPlan, UploadPaymentProof, Cancel)
  - Real-time listener via `onSnapshot`
- `lib/services/firestore_service.dart` (Admin app):
  - Streams of every Booking, `tracking_sessions`, `access_logs`, `rooms`, `guest_profiles`,
    `site_config/rates`, and a Booking's `activity`
  - `applyBookingAction`, `deleteBooking`, `publishRates`; in-memory demo data when Firebase is absent

**Firestore Rules** (`firestore.rules`) — the enforcement:
- `role()` resolves a request: the bootstrap email allowlist (`adminEmails()`), then `profiles/{uid}`, then `guest`
- Anyone can `create` a Pending booking that carries a `uid` (the public booking form)
- `bookings`: read by their own Guest and the Admin; updated by the Admin (never out of a terminal
  status; `Approved` only from `KYC Submitted`; `Reserved` only from `Payment Pending`), and by a Guest
  only on their own document, only forward or out, and only within a fixed key list; deleted by the Admin
- `profiles`: you may write your own, only as a Guest; the Admin may write anybody's; nobody may
  write a role that is not `guest` or `admin`; a person may edit their own name but never their own role
- `bookings/{id}/activity`: append-only, and an entry must be written in the writer's own role
  (`system` entries are written by the Admin app)
- `access_logs`: created by any signed-in client, read and corrected by the Admin
- `site_config`: public read (the website quotes rates from it), Admin write
- `tracking_sessions`: created and deleted by the Guest's own device, read by the Admin
- `rooms`, `guest_profiles`, `gallery` writes: Admin
- Everything else is denied by a final catch-all
- `test/web/auth-firestore-rules.test.ts` asserts all of the above, and that the rules and
  `src/lib/auth` keep the same bootstrap addresses

**Indexes** (`firestore.indexes.json`):
- `status + created_at`, `check_in + check_out`, `uid + created_at`

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

### 3b. Google sign-in (powers `/guest/auth` on the web and the Admin app's gate)
1. Console → Authentication → Sign-in method → enable **Google** (Email/Password stays on).
2. Console → Authentication → Settings → Authorized domains → add every host that
   serves the site: `localhost`, your Vercel preview domain, `haciendadeluisana.com`.
   An unlisted domain fails with `auth/unauthorized-domain`, which the sign-in form
   says in words.
3. Open `/guest/auth` with keys configured: the **Continue with Google** button is
   there; without keys the same page runs in demo mode (local Guest accounts).
4. For the Admin app, register the Android app (package `com.haciendadeluisana.client2`)
   with its SHA-1 — see [ANDROID.md](./ANDROID.md). Email + password works without it.

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

### 6. Publish the rate card & cancellation policy (`site_config/rates`)

The lifecycle module moves no money on guesses: when the Admin approves a
Booking, `ChoosePaymentPlan` quotes the stay from the published figures, and a
cancellation refunds by the published policy. Until the document below exists,
the choice is refused ("The Admin has not published that payment option for
this Accommodation.") and a cancellation refunds nothing — the safe defaults,
not an error.

**Where:** one document, `site_config/rates`. The normal way to write it is the
Admin app's **Rates & Cancellation Policy** screen (`lib/views/rates/rates_screen.dart`),
which runs `validatePublishedRates` before it writes. The Firestore console
works too (Database → Firestore → `site_config` → Add document, id `rates`);
the rules grant public read and Admin-only write but do not shape-check it, so
run the checklist below before writing by hand. The same check lives in both
code bases — `src/lib/booking/rates.ts` and `lib/services/booking_lifecycle.dart`.

**Shape** (the `PublishedRates` type in `src/lib/booking/rates.ts`):

```json
{
  "version": "v2026-09",
  "effective_date": "2026-09-01",
  "accommodations": {
    "main-house": { "nightly_rate": 10000, "security_deposit": 500, "down_payment_percent": 50 },
    "house-a-camping": { "nightly_rate": 1200, "security_deposit": 0 }
  },
  "refund": {
    "tiers": [
      { "min_days_before_check_in": 14, "refund_percent": 100 },
      { "min_days_before_check_in": 7, "refund_percent": 50 }
    ],
    "deposit_refund_percent": 100
  }
}
```

**Checklist** (every line is what `validatePublishedRates` asserts):

- [ ] `version` is a non-empty string — the name the Booking is stamped with.
- [ ] `effective_date` is a real calendar date in `YYYY-MM-DD` (not `2026-02-30`).
- [ ] `accommodations` is an object keyed by the ids the site actually lists
      (`main-house`, `house-a-camping`) — a figure for an id the site does not
      list is a price nobody can be charged, and is refused.
- [ ] Each listed Accommodation: `nightly_rate` in pesos, greater than zero;
      `security_deposit` zero or more; `down_payment_percent` strictly between
      0 and 100, or **omitted** for full-payment-only.
- [ ] Every Accommodation the site lists is present — an absent one has no
      machine price, so a Guest cannot choose a plan for it.
- [ ] `refund` (optional): a flat `refund_percent` (0–100) **or** `tiers` of
      `{ min_days_before_check_in, refund_percent }` (tiers win when both are
      published); `deposit_refund_percent` 0–100 (defaults to 100). Omit
      `refund` entirely to publish rates without a refund policy — then a
      cancellation refunds nothing.

**Semantics the Admin should know:**

- `ChoosePaymentPlan` stamps `policy_version` and `policy_effective_date` on
  the Booking at the moment the Guest commits to a plan. **Republishing later
  (a new `version`) changes the terms of future choices only — never the
  refund terms of a stay already promised.** The stamped Booking settles its
  refund by the policy it was stamped under.
- A Booking chosen while nothing was published carries nulls in both fields
  and refunds nothing — the same as an unpublished policy.
- The website reads the document (`src/lib/ratesDB.ts`, read-only) to offer
  payment plans on `/account`; `src/config/site.ts` prices are display copy only.

## 🔐 Security Notes

- API keys in `.env.local` are safe to expose client-side; security is enforced by Firestore Rules & Auth.
  Never commit `.env.local`, and never put a secret in a `VITE_` variable — anything Vite exposes is public.
- Passwords are never stored by this app. Firebase hashes them server-side; the demo-mode adapter hashes
  them with PBKDF2-SHA256 (210,000 rounds, a 16-byte salt per account) and stores only the derived key.
- Public booking creation stays public, but only as a `Pending` Booking with the required fields; every
  read and write past that needs a role the rules can see.
- Admin access is the `adminEmails()` allowlist plus `profiles/{uid}` — edit `adminEmails()` in
  `firestore.rules`, `isAdminEmail()` in `storage.rules`, `BOOTSTRAP_ROLES` in `src/lib/auth/profile.ts`
  and `AuthStore.kAdminEmails` in the Flutter app, then `firebase deploy --only firestore:rules,storage`.
- A role is never read from the body of a request: the rules take it from the signed-in identity's own
  Profile, and the test suite asserts that `request.resource.data.role` appears nowhere else.
- Storage Rules limit uploads to 10MB site images, 2MB avatars and 5MB KYC / payment documents; `/kyc`
  and `/payments` are readable only by the Guest they belong to and the Admin, who may also delete them
  (the purge after a stay).

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
- `src/App.tsx` (ProtectedRoute for /account; `/admin`, `/app` signpost to the Admin app)
- `src/pages/BookingPage.tsx` (Firestore integration)
- `src/pages/AccountPage.tsx` (the Guest's own Bookings, real-time)
- `lib/services/auth_store.dart`, `lib/services/firestore_service.dart` (Admin app)
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
- Add Firebase Storage upload for gallery management in the Admin app
- Move roles from `profiles/{uid}` to custom claims (one `role()` implementation changes; no caller does) —
  worth it only once rule-evaluation reads on `profiles` show up in the bill
- Run the Admin app's Approve inside a Firestore transaction (ADR-0006 describes the web protocol)
- Add Analytics events for booking funnel
- Add offline persistence: `enableIndexedDbPersistence(db)`

---

Built for Hacienda de LuisAna — private countryside escape in Luisiana, Laguna.
