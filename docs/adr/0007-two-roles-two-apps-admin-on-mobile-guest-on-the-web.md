# Two roles, two apps: the Admin runs everything from the mobile app, the Guest uses the website

**Status**: accepted, 2026-09-24. Supersedes the three-role model of ADR-0005 (the storage and bootstrap of a role in that ADR stand; the set of roles does not).

The system has exactly two roles and exactly two applications, and each application belongs to one role:

| Role | Application | What it does |
| --- | --- | --- |
| **Guest** (the client) | **Website** (`src/`, React + Vite) | Reads availability and rates, submits a Booking, uploads the documents the lifecycle asks of them (government ID for KYC, Payment proof), chooses a Payment plan, follows the status of their own Bookings, withdraws one, and optionally shares their live location on the way. |
| **Admin** | **Flutter mobile app** (`lib/`) | Everything else: reviews KYC and approves or rejects, verifies or rejects Payment proof, cancels and settles Refunds, records check-in / stay / check-out / completion, purges IDs after a stay, revokes a Credential, publishes the Published rates and cancellation policy, and reads the arrival radar, Access log, rooms, CRM and analytics. |

There is no **Staff** role and no **Host** role. The person formerly called the Host *is* the Admin; the work formerly imagined for Staff (marking a cleaned stay complete, reading records) is done by the Admin in the same app. No role-based access control exists *among* operators because there is only one operator role.

## Why

- **The former three-role split existed to protect a shared web dashboard.** Host, Staff and a view-only "anak" account each needed a slice of `/admin` and `/app`, so a permission matrix, a team-management tab and role-scoped sign-in pages grew around them. For a property of this size that machinery had more moving parts than the operation it protected, and every part was a place the two apps could disagree.
- **Two surfaces for one job drift.** The web dashboard and the Flutter app both wrote Booking statuses, with two spellings of the same lifecycle. Giving the Admin one app means one lifecycle implementation on the operator side (`lib/services/booking_lifecycle.dart`), mirroring the Guest side (`src/lib/booking`), with `firestore.rules` as the arbiter both must satisfy.
- **The website is the public face.** Everything a stranger can reach should be Guest-facing. A management dashboard behind a login on the same origin is an attack surface the operation gains nothing from, once a mobile app exists that the Admin already carries.

## What the decision means in code

- **Roles**: `guest` | `admin` (`src/lib/auth/roles.ts`; `role()` in `firestore.rules`). Signing up on the website makes a Guest and cannot make anything else. The Admin is recognised by the bootstrap email allowlist — which lives in `firestore.rules` (`adminEmails()`), `storage.rules` (`isAdminEmail()`), `src/lib/auth/profile.ts` (`BOOTSTRAP_ROLES`) and `lib/services/auth_store.dart` (`AuthStore.kAdminEmails`) — or by `profiles/{uid}.role == 'admin'`.
- **Actors on the Activity log**: `guest`, `admin`, `system`. Old entries written by `host` or `staff` are read as `admin`.
- **Website routes**: `/`, `/book`, `/track`, `/login`, `/guest/auth`, `/account`. `/admin/*` and `/app/*` answer with a notice that the Admin dashboard moved to the mobile app; an Admin who signs in on the website is turned away from `/account` (it is a Guest page) and pointed to the app.
- **Mobile app**: only the Admin may pass the sign-in gate; any other account is signed straight back out. The app has no Guest screens.
- **Firestore rules**: `isAdmin()` replaces `isHost()` / `isStaff()` / `isAnak()`; a Guest may only create a Booking, read and update their own, and append Guest-signed Activity entries. Only the Admin writes `site_config/rates`, reads every Booking, every `access_logs` entry and every `tracking_sessions` document, and deletes a Booking.

## Consequences

- One person, one device: if the phone is lost, so is the operator's access until they sign in elsewhere. The email + password sign-in on the app exists for exactly that; nothing about the decision needs a second role to recover.
- The Admin's write paths in the app are checked by `firestore.rules` for the moves that must never go wrong (nothing leaves a terminal status; `Approved` needs `KYC Submitted`; `Reserved` needs `Payment Pending`). The full transition table is enforced in the app, as it is on the web for the Guest's actions.
- Adding a second operator means giving a second account the Admin role (allowlist or Profile), not adding a role. If the operation ever genuinely needs a person who may read but not decide, that is the moment to reopen this ADR — not before.
- ADR-0001 to ADR-0006 stand; where they say "the Host", read "the Admin".
