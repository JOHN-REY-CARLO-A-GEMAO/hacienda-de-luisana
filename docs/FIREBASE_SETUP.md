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

Copy-paste drafts for the Firebase Authentication email templates, their
console limitations, and a test checklist are in [FIREBASE_AUTH_TEMPLATES.md](./FIREBASE_AUTH_TEMPLATES.md).
The templates are managed in the Firebase Console, not deployed from this repository.

After a Firebase email/password Guest account is created, the website requests a
verification email using Firebase's configured template. Delivery failure does
not undo the account, and verification is not an access requirement. The Guest
can resend from My Bookings or My Profile, then use **I have verified my email**
to reload the account and refresh its ID token after opening the link. The same
request is made after a successful email link to an anonymous booking identity
when its session refresh succeeds, without changing its UID. Google and
browser-only demo sessions do not send this email. Firebase's delivery limits
and project settings still apply.

Two roles, from `CONTEXT.md` § People: **Guest** and **Admin** — no Staff, no Host
([ADR-0007](./adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md)). A role is
stored at `profiles/{uid}` and bootstrapped by an email allowlist
([ADR-0005](./adr/0005-a-person-s-role-is-stored-in-profiles-and-bootstrapped-by-an-email-allowlist.md));
`firestore.rules` enforces it. The website signs Guests in; the Admin signs in on the Flutter app.

**`src/lib/auth/` — the website's provider-independent authorization core**
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
    lifecycle actions (ChoosePaymentPlan, UploadPaymentProof, Cancel)
  - Real-time listener via `onSnapshot`
- `lib/services/firestore_service.dart` (Admin app):
  - Streams of every Booking, `access_logs`, `rooms`, `guest_profiles`,
    `site_config/rates`, and a Booking's `activity`
  - `applyBookingAction`, `deleteBooking`, `publishRates`; in-memory demo data when Firebase is absent

**Firestore Rules** (`firestore.rules`) — the enforcement:
- `role()` resolves a request: the bootstrap email allowlist (`adminEmails()`), then `profiles/{uid}`, then `guest`
- Anyone can `create` a Pending booking that carries a `uid` (the public booking form)
- `bookings`: read by their own Guest and the Admin; updated by the Admin (never out of a terminal
  status; no retired status may be written; `Reserved` only from `Payment Pending`), and by a Guest
  only on their own document, only forward or out, and only within a fixed key list; deleted by the Admin
- `profiles`: you may write your own, only as a Guest; the Admin may write anybody's; nobody may
  write a role that is not `guest` or `admin`; a person may edit their own name but never their own role
- `bookings/{id}/activity`: append-only, and an entry must be written in the writer's own role
  (`system` entries are written by the Admin app)
- `access_logs`: created by any signed-in client, read and corrected by the Admin
- `site_config`: public read (the website quotes rates from it), Admin write
- `conversations/{id}/messages`: a member of that conversation or the Admin; a message
  is 1–1,000 characters, immutable, and its `sender_role` has to match the writer
- `conversations/{id}`: only the Admin writes `messages_expires_at` (the retention stamp)
- `location_sessions/{conversationId}`: created only by that conversation's own Guest,
  carrying consent metadata and **no coordinate** — a document with `lat`/`lng`/
  `position`/`points` on it is refused — capped at a 60-minute window checked against
  `request.time`; read by the Admin and by the sharing Guest
- `tracking_sessions`: **closed** — no create, read or update by anybody (ADR-0009)
- `rooms` is a status register, not a catalogue: the Admin may read it, initialize a minimal status document for a canonical Accommodation, and update only its `status`; deletion and extra catalogue fields are refused. `guest_profiles` and `gallery`: Admin writes
- Everything else is denied by a final catch-all
- `test/web/auth-firestore-rules.test.ts` asserts all of the above, and that the rules and
  `src/lib/auth` keep the same bootstrap addresses

**Realtime Database rules** (`database.rules.json`, ADR-0013) — the ephemeral live-location
stream, and the only rules file that is not Firestore or Storage:
- the root is closed; anything not named below is denied
- `live_location/{conversationId}/{guestUid}`: a signed-in Guest may write only into
  their own uid's path, and the node must carry exactly nine fields, a position inside
  the Philippines, and a window that is open and no more than 90 seconds ahead
- `live_location/*`: readable by the Admin — the bootstrap addresses in the token, or an
  address an allowlisted Admin has written to `live_location_admins/{uid}`
- the Admin's read of `live_location/{conversationId}/{guestUid}` is granted on that
  node and **refused the moment `expires_at_ms` is in the past** — that rules check
  is what makes a position unreadable when consent ends, and it is why there is no
  read grant on the conversation subtree
- there is no server-side per-node expiry in Realtime Database on any plan, and a
  client that tries to set one (`'.ttl'`) has the write refused by the SDK before
  it leaves the browser. Removal is `onDisconnect().remove()` plus the client's
  own `stopSharing`; see `docs/adr/0013-live-location-as-a-stream.md`

- `clock_probes/{probeId}`: one throwaway document per share, written by the
  signed-in Guest, carrying `uid` and a `serverTimestamp()` and nothing else
  (`hasOnly(['uid', 'probed_at'])`), readable only by its owner, never updated.
  It exists because `location_sessions` and the stream compare a sharing window
  with the **server's** clock, and a browser can only be told that clock by
  stamping a document. Without it a device whose clock runs fast cannot start the
  longest share at all. The probe is deleted as soon as it has been read back.

Deploy it with `firebase deploy --only database` after creating the database in the
console. (The probe lives in Firestore, so `firebase deploy --only firestore:rules`
is needed for it too — deploying only the database leaves sharing working, but a
fast clock then falls back to the wider guard band instead of being measured.) The production website's committed default URL matches the Android/iOS
value in `lib/firebase_options.dart`; set `VITE_FIREBASE_DATABASE_URL` when building
for a different project, and keep it paired with that project's `VITE_FIREBASE_PROJECT_ID`.
The resolver refuses malformed or cross-project URLs, and the share control stays off
when no valid URL is available. `npm run test:emulator` starts the Database emulator too.

**Indexes** (`firestore.indexes.json`):
- Bookings: `status + created_at`, `check_in + check_out`, `uid + created_at`
- Conversations: `guest_uid + booking_id`, `guest_uid + updated_at DESC`

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
     (Anonymous ties a Guest's payment-proof uploads to the identity the
     Booking was created with — see `docs/adr/0004-*.md`. Without it, bookings
     are created with no guest identity and uploads cannot be attached.)
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

### 3c. Which project a *build* talks to (and why a deployment said “Demo mode”)

The web app decides this once, at build time, in one pure module
(`src/lib/firebaseConfig.ts`). Three sources, in this order:

| # | Source | When it is used | Effect |
| --- | --- | --- | --- |
| 1 | `VITE_FIREBASE_*` environment variables | whenever they are complete | that project, and nothing from anywhere else |
| 2 | `src/lib/firebaseDefaults.ts` (committed) | production builds (`vite build`) with no variables | the Hacienda's own project, so a deployment with an empty dashboard still reaches the Admin app |
| 3 | nothing | `npm run dev`, the test run, or a build with no project anywhere | **demo mode**: accounts and Bookings live in this browser (`authLocal.ts`) |

Two consequences worth knowing:

- **A deployed site is never silently in demo mode.** If a production build has no
  project at all, the build log says so in capitals (`[firebase] This build has NO
  Firebase project…`). Set `FIREBASE_ENV_STRICT=1` in the hosting dashboard (or in
  front of `npm run build`) to make such a build *fail* instead of shipping.
- **Local development is unchanged.** `npm run dev`, `npm test` and the emulator
  workflow stay in demo mode unless `.env.local` supplies keys — no accidental writes
  to the live project from a laptop. A local `npm run build && npm run preview` *is*
  a production build, so it talks to the real project; use `.env.local` with the
  emulator flag (`VITE_USE_FIREBASE_EMULATORS=true`, §1 of `.env.example`) to keep
  practice data out of it.

**Why the committed config is not a secret** (and may be committed): a Firebase web
config identifies a project; it authorises nothing. `firestore.rules`,
`storage.rules` and Firebase Auth answer every request whether or not somebody knows
the key — see § Security Notes. The Admin app already ships the same project's keys
in `lib/firebase_options.dart`.

**Vercel** (or any host) — to override the committed values:

1. Project → Settings → Environment Variables → add `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID` (and optionally `VITE_FIREBASE_MEASUREMENT_ID`) for
   **Production and Preview**.
2. **Redeploy.** Vite reads those variables while building; adding one does nothing
   to a deployment that is already live.
3. Open `/status` on the deployment: it names the project, shows which source each
   value came from, and its **Test the connection** button signs in anonymously and
   reads Firestore to prove the wiring end to end.

### 3d. Domains Firebase will accept sign-in from

Google sign-in (and password-reset links) only work on hosts listed in
**Authentication → Settings → Authorized domains**. The list on the project
(`hacienda-de-luisana`) currently holds `localhost`, the Firebase Hosting domains,
and three older `hacienda-*.vercel.app` preview URLs — **the addresses the site is
served from today are missing**:

- `hacienda-de-luisana.vercel.app`
- `haciendadeluisana.com`
- `www.haciendadeluisana.com`

Add all three. A missing domain fails Google sign-in with
`auth/unauthorized-domain` (the form says so in words); email/password and
anonymous sign-in keep working, which is why this hides so well.

### 4. Deploy Firestore Rules & Indexes
```bash
npm install -g firebase-tools
firebase login
firebase use --add  # select your project, alias default
# copy .firebaserc.example to .firebaserc and set your projectId
cp .firebaserc.example .firebaserc
firebase deploy --only firestore:rules,firestore:indexes,storage
```

**Read the deploy output before answering anything at the prompt.** Three things
there are expected, and confusing them for failures is how a deploy gets
abandoned half-way:

| Output | What it means |
| --- | --- |
| `Invalid type. Received one of [list]. Expected one of [set]` at `pricingSnapshotImmutable()` | Expected, and deliberately not silenced. The compiler resolves `intersection()`'s argument before the `.toSet()` on it runs. Cosmetic: the file compiles and the guard evaluates. **Two "fixes" are wrong** — (a) moving `toSet()` onto `keys()`, because `keys()` already returns a Set and `toSet()` on a Set is the error that made this guard unevaluable (docs/VERIFICATION.md records the outage as fixed); (b) flattening to `affectedKeys().hasAny([…])`, which also reports keys a write *adds* and so refuses a legacy Booking that adds a snapshot key it never had — verified 2026-10-29, it fails three cases in `test/rules/firestore-rules.test.ts` including "lets a historical unclassified Booking choose a plan from its saved total". |
| `Invalid type. Received one of [null]. Expected one of [map]` at `validGuestQuote()` | Should no longer appear: the attestation now defaults to `{}` in the binding instead of `null`. If it does appear, the `{}` default was lost — that is a real bug, because a null dereference throws and a throw reads as a refusal. |
| `The following indexes are defined in your project but are not present in your firestore indexes file … Would you like to delete these indexes? (y/N)` | Answer **N** unless you have decided to drop that index. Deleting one is a separate, disruptive change — it has to be rebuilt from scratch if it is ever needed again — and `N` still finishes the rest of the deployment. `cases` is genuinely retired (ADR-0020) but prune it deliberately, from the Console, once nothing queries it. |

Never add `--force` to skip that prompt: for indexes, `--force` *means* "yes,
delete them". To deploy rules alone, with no index reconciliation and no prompt:

```bash
firebase deploy --only firestore:rules --project <project-id>
```

A rules deploy replaces the whole ruleset rather than merging into it, so deploy
from the commit you intend. Rollback: Console → Firestore → Rules → version
history → restore the previous ruleset, or redeploy `firestore.rules` from the
previous commit.

#### `PERMISSION_DENIED` when the Admin app saves receipt evidence or a reference

Symptom: ML Kit reads the receipt (for example `Ref: 8159662488150`,
`₱5000.00`) and then

```
W/Firestore: Write failed at bookings/EFWlBlZN72rBnVjfaLFK:
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}
```

comes from `PaymentReferenceService._storeExtraction()`'s `update()`. The read
is fine; the write is being judged by the **deployed** rules and the
**signed-in identity**. A failure after **I-confirm o itama ang reference** is a
different write, `saveCorrection()`, and needs the same checks. Its generic
retry notice alone does not establish a permission error: look for
`[PaymentReference Save Error]` in the device log for the actual exception and
stack. Keyboard open/close events alone do not prove that a save was submitted.

**Do not paste a generic `allow read, write: if isAdmin()` snippet into
`firestore.rules`.** It does not describe this project:

| Generic snippet | This repository |
| --- | --- |
| `users/{uid}.role`, `request.auth.token.admin` | No `users` collection and no `admin` custom claim. A role is `profiles/{uid}.role == 'admin'`, or a **verified** address in `adminEmails()` (`src/config/admin-roles.json`) — ADR-0005. |
| `resource.data.userId` | A Booking's owner is `uid` (ADR-0004), and it is the **Guest's** uid, not the Admin's. |
| `paymentReference`, `receiptAmount`, `paymentProofUrl`, `ocrData`, `updatedAt` | Snake case: `payment_reference`, `ocr_amount`, `payment_proof_url`, `ocr_*`. The OCR patch writes exactly nine `ocr_*` keys (ADR-0023). |
| `allow read, write: if isAdmin()` | Would replace ~1,900 lines of Guest self-serve, lifecycle and money invariants (ADR-0001, 0012, 0018) with a two-line rule — and would still not help a session the rules read as Guest. |

Work through these in order:

The same diagnosis answers a refused **Approve / Verify / Reject** action on a
Booking: those go through `FirestoreService.applyBookingAction()`, which
classifies the refusal into an actionable message (`bookingWriteRefusalMessage`)
and, in a debug build, prints the raw exception code and the identity facts
Firestore judged under the `[BookingAction]` tag (`logBookingActionRefusal`).
A debug build also shows that message as written — the admin screens pass a
service refusal straight through instead of letting `ErrorUtils` collapse it
into "You do not have permission to perform this action."

0. **Build a debug app and repeat the action.** The `[BookingAction]` log lines
   from `applyBookingAction` answer step 2 below without any console work:

1. **Deploy the ruleset from this commit, to the right project.**
   ```bash
   firebase deploy --only firestore:rules --project hacienda-de-luisana
   ```
   `.firebaserc`, `lib/firebase_options.dart` and
   `src/lib/firebaseDefaults.ts` must all name the same `projectId`; rules
   deployed to a different project change nothing the app can see. In Console →
   Firestore → Rules, confirm the live text contains
   `adminOcrEvidenceUpdate()` and `adminReferenceCorrectionUpdate()`. A rules
   deploy replaces the whole file — a stale or hand-edited console ruleset is
   the commonest cause.
2. **Verify the signed-in account** — the app logs its uid, email,
   `user.emailVerified` and the token's `email_verified` claim on a refused
   write. For the UID in the Auth log (for example
   `e3t0myCwUNSWDKpdhk4h42pOyt02`):
   - Authentication → Users: if the address is the allowlisted one, make sure
     **Email verified** is true. `firestore.rules` reads `email_verified` from
     the ID **token**, not from `User.emailVerified`; after verifying, sign out
     and back in (the app also refreshes a stale token when it restores a
     session). An unverified allowlisted address is deliberately **not** Admin.
   - Otherwise, create `profiles/<uid>` with
     `{ "uid": "<uid>", "role": "admin" }`. `users/<uid>` is never read.
     Custom claims grant nothing here; the rules never read `token.admin`.
   - `bookings/<id>.uid` names the Guest. It will not equal the Admin's uid,
     and that is correct — the Admin is recognised by role, not by ownership.
3. **Check the rule that decides this write.** `match /bookings/{bookingId}`
   has `adminOcrEvidenceUpdate()`: an Admin-only door that accepts a patch
   changing **only** the nine `ocr_*` evidence keys. It exists because the
   general Admin update rule also asks about the *stored* state —
   `reservedIsPaidFor()` refuses every write to a historical `Reserved` Booking
   whose `payment_status` is not `verified`, even for a patch that touches no
   status, no money and no marker. Guests keep
   their own seven-key OCR vocabulary in `guestSelfServeUpdate()` for the
   website's re-send; `ocr_recipient_name` and `ocr_extracted_at` stay
   Admin-only. **I-confirm o itama ang reference** uses the separate
   `adminReferenceCorrectionUpdate()` door: only the seven reference/sender/date
   keys from `saveCorrection()`, with `payment_reference_source` set to
   `admin_corrected` and `payment_reference_corrected_by` equal to the caller's
   uid. It also leaves status, money, proof and OCR evidence untouched. The
   service's duplicate and verified-overwrite confirmations still apply.
4. **Verify before closing the ticket.**
   ```bash
   npm run test:rules          # supplemental rules suite: both evidence doors
   npm run test:emulator       # real rules evaluation, if the emulator + Java are available
   npm run test:flutter       # Dart error mapping, with the Flutter SDK installed
   ```
   Rebuild/reinstall the Admin app to get the new save diagnostics, then reopen
   the proof and try **Basahin muli** and **I-confirm o itama ang reference**.
   Rules deployment alone does not update the installed Dart code. If a write
   still fails, compare the classified notice and device-log exception with the
   identity facts above; the shorter retry message is not a diagnosis by itself.

See [RECEIPT_OCR_GUIDE.md](./RECEIPT_OCR_GUIDE.md) § 9 and
[ADR-0023](./adr/0023-receipt-ocr-on-the-admins-device.md).

### 5. Deploy Hosting
```bash
npm run build
firebase deploy --only hosting
```

### 6. Publish rates, holidays and cancellation policy (`site_config/rates`)

New guest bookings use an Admin-published per-property guest-count schedule.
Firestore independently recomputes the check-in classification, stay total and
50% down payment; the browser cannot supply authoritative money. Until a valid
schedule is published, direct online booking cannot submit payment. Each new
Booking stores its rate classification and financial figures plus the exact
published refund terms in `refund_policy_snapshot` (or `null` if none were
published). These snapshots are immutable; existing bookings are not migrated,
rewritten or recalculated when a new version is published.

**Where:** `site_config/rates`, normally published through the Admin app's
**Rates & Cancellation Policy** screen (`lib/views/rates/rates_screen.dart`).
The website validates reads with `src/lib/booking/rates.ts`; the Admin app
validates writes with `lib/services/booking_lifecycle.dart`. The Firestore
rules independently validate guest-submitted booking money. The console can
still be used by an Admin, but use the same shape and validation before writing.
A legacy flat nightly-rate document remains stored as-is but is not accepted as
a new guest quote; review it in the Admin app and publish a new version rather
than migrating or recalculating historical bookings.

**Shape sketch** (not paste-ready: replace each security-deposit placeholder
with the current Admin-confirmed figure, and fill the holiday list from the
Admin-configured dates; do not guess either):

```text
{
  version: "guest-count-v2",
  effective_date: "YYYY-MM-DD",
  holiday_dates: [],
  accommodations: {
    "main-house": {
      rate_unit: "standard_stay", security_deposit: <confirmed amount>,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 }
      }
    },
    "annex": {
      rate_unit: "standard_stay", security_deposit: <confirmed amount>,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 }
      }
    },
    "house-a-camping": {
      rate_unit: "standard_stay", security_deposit: <confirmed amount>,
      down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 4, base_rate: 1000, excess_per_guest: 500 }
      }
    }
  }
}
```

**Validation and schedule rules:**

- `holiday_dates` is an explicit, unique list of real `YYYY-MM-DD` dates
  maintained by the Admin; `[]` means no dates are currently configured.
- The check-in night sets the standard-stay rate: Sunday night through
  Thursday night is weekday; Friday and Saturday check-in nights are weekend;
  a configured holiday uses weekend/holiday pricing. Sunday morning checkout
  completes the Saturday stay. Standard check-in is 2:00 PM and check-out is
  12:00 noon (about 22 hours).
- Main House has 10 guests included; Annex has 6 included. These are base-rate
  thresholds, not booking caps. No physical/safety maximum is published here.
  A-House is one unit per booking, ₱1,000 per unit, up to 3 guests.
- The rate unit must be `standard_stay`; retired `nightly_rate`, fixed
  `reservation_fee_amount`, upper brackets, non-50% down-payment percentages,
  and Main/Annex caps are rejected for new quotes.
- The stay total is computed first. `amount_due` is 50% of that total, rounded
  down to centavos; the remaining 50% is due at check-in. The refundable
  Security deposit is a separate Admin-confirmed amount.
- `refund` is optional. If used, publish a 0–100 `refund_percent` or `tiers`
  of `{ min_days_before_check_in, refund_percent }`; `deposit_refund_percent`
  is also 0–100. Omit `refund` to publish no cancellation refund policy.

Payment channels and instructions remain separately configurable in
`site_config/payment`; they are not pricing inputs. Publish only guest-visible
payment details there—never passwords, PINs, OTPs, API keys or credentials.

Each channel may publish `qr_image` — a site path (`/images/payment/gcash-qr.png`)
or an https URL — plus an optional `qr_instructions` line. When a channel has a
QR code, the website shows the image and stops printing that channel's
`account_identifier`; the account may then be left out of the document entirely
(`firestore.rules` accepts a channel that has only a QR code). The GCash image is
the owner's own QR code, committed under `public/images/payment/` (website) and
`assets/images/payment/` (Admin app); it is not generated, and a document
published before the QR code existed still picks it up from
`OFFICIAL_PAYMENT_INFORMATION` in `src/config/officialBusiness.ts`. Never draw,
regenerate or re-encode that code — see `public/images/payment/README.md`.

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
- Storage Rules limit uploads to 10MB site images and 5MB payment documents. The legacy
  `/payments` path is readable only by the Guest it belongs to and the Admin, who may also delete them.
  (Government ID KYC is gone: the `/kyc` path was removed from the rules entirely — new payment proofs
  live in Supabase Storage's `payment-proofs` bucket, ADR-0011.)
- `admin_security/{uid}` (the Admin's Security PIN) is own-document-only and, since ADR-0027,
  **not deletable by any client at all**. A forgotten PIN is reset through the Supabase Edge Function
  `admin-pin-reset`, which mails six digits to the Admin's Firebase-verified address and disposes of
  the record only when those digits come back. See the deployment block in `docs/adr/0027-a-forgotten-pin-is-reset-by-an-emailed-code.md`
  — it needs `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD` and `BOOTSTRAP_ADMIN_EMAILS` as function secrets, or
  the reset sheet reports that sending is not configured. `admin_security_events` stays append-only
  (`create`, `update` and `delete` refused to every client), and the function writes the line, so the
  trail that a PIN was reset outlives the record. `admin_security_resets/{uid}` holds the reset code's
  salted hash and counters, and is refused to every client in the rules.
- **No server-side infrastructure is required for anything on this page.** In particular there is no
  `functions/` directory and no Cloud Function anywhere in this project: Firebase Cloud Functions have
  no free tier, and nothing in the booking, payment, chat, review, live-location or PIN-reset flows
  depends on one.

## 📁 Files Added/Modified

**Added:**
- `src/lib/firebase.ts`
- `src/lib/firebaseConfig.ts` (which project a build talks to — pure, tested)
- `src/lib/firebaseDefaults.ts` (the committed project, used by production builds)
- `src/lib/firebaseFailure.ts` (Firebase's refusals in words)
- `src/lib/connectionCheck.ts` (`/status`'s "Test the connection")
- `src/pages/StatusPage.tsx` (`/status` — where a deployment explains itself)
- `src/lib/guestAuth.ts` (the anonymous Guest identity)
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

## 📱 Building the Admin app (Flutter)

The app is a separate build from the website, and it needs two things the website
does not.

**1. `android/app/google-services.json`.** The Google Services Gradle plugin
refuses to configure the project without it, and the build fails at
`:app:processDebugGoogleServices`. It is per-project and per-machine, so it is
gitignored — download it from Firebase console → Project settings → Your apps →
Android app, and drop it in.

Its `package_name` must equal `applicationId` in `android/app/build.gradle`, or the
plugin reports `No matching client found for package name '…'`. The same values are
in `lib/firebase_options.dart`, which is what the Dart side actually reads; the
JSON mainly exists to satisfy Gradle.

**2. `databaseURL`, for live location.** `lib/firebase_options.dart` carries it for
both platform blocks; the website uses the same committed default, with
`VITE_FIREBASE_DATABASE_URL` available as a same-project override. Without a valid
URL the feature is switched off and says so, rather than half-working (ADR-0013).

```bash
flutter pub get
flutter analyze lib          # must be 0 errors
flutter build apk --debug
```

If Gradle reports `AndroidLocationsBuildService` / `AndroidDirectoryCreator`,
that is **not** a missing SDK and not usually just a stale daemon. AGP is
failing to resolve the Android preferences folder (`%USERPROFILE%\.android`),
normally because `ANDROID_USER_HOME`, `ANDROID_PREFS_ROOT` / `ANDROID_SDK_HOME`
disagree, `.android` is unwritable, or a JVM option overrides `user.home`. Run
`node scripts/check-android-env.mjs` and follow `docs/ANDROID.md` § 5.1;
`android\gradlew.bat --stop` is one step of that repair (daemons keep the old
environment), not the whole fix.

## 🛠 Troubleshooting

- **A deployed site says "Demo mode"**: open `/status` on that deployment. It reports
  which values the build carries and where each came from. Usual causes: the build
  ran before the dashboard variables were added (redeploy), a variable is still the
  `.env.example` placeholder (it is refused and named on `/status`), or the project
  was never filled in. See § 3c.
- **Guests cannot sign in / bookings do not arrive**: run **Test the connection** on
  `/status`. It names the switch that is off — Anonymous sign-in, the rules not
  deployed, or a domain missing from Authorized domains (§ 3d).
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
