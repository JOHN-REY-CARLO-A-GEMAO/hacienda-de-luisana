# A sensitive Admin action needs a deliberate second input

**Status**: accepted, 2026-10-05. **Extends** ADR-0007 (two roles, two apps) and ADR-0010 (money and audit invariants live in the rule layer). **Does not** move any invariant out of `firestore.rules`, and **does not** touch `booking_lifecycle.dart` — the shared lifecycle is unchanged, byte for byte, and the website never sees any of this.

## The problem this settles

An audit of every mutating control in the admin app found confirmation coverage that was patchy and, in one place, absent:

| Action | Before this ADR |
| --- | --- |
| Approve (quick-tap on the bookings card) | Nothing — the card button called the service directly |
| Check in / Begin stay / Check out / Complete | Nothing, on the list and the detail screen |
| Expire (writes a terminal status) | Nothing |
| Publish payment info (GCash/bank numbers → every visitor) | Nothing |
| Review publish / take down (take down = a hard `delete()`) | Nothing |
| Sign out, live-location reader grant | Nothing |
| Delete Booking | A dialog — but the service swallowed the error and the screen popped anyway |

Approving a Booking verifies money and firms the dates. One mis-tap on the bookings list did it with no prompt at all.

## What this is, and what it honestly is not

**This is a guard rail, not a trust boundary.** The money invariants live in `firestore.rules` (ADR-0010) and nothing here adds to them — anyone with the device can bypass the app entirely. What a PIN in the app genuinely buys:

- it stops **accidents** — a tap that was meant for the row above;
- it stops a **borrowed unlocked phone** — the second-most-likely threat after accidents;
- the server-side lockout makes **online guessing** impractical rather than instant.

Nobody reading this ADR should later mistake the PIN for enforcement. The rules are the enforcement; this is the deliberate second input.

## What is decided

### 1. Two tiers, one pure map

`lib/services/security_gate.dart` holds the whole policy as data — no Flutter, no Firebase, exhaustively unit-tested like `review_policy.dart`:

- `GateLevel.pin` — the Security PIN, typed on a keypad sheet. Approve, verify payment, cancel, mark refunded, reject-proof-when-it-cancels, delete Booking, revoke Credential, publish rates, publish payment info, publish a review, take a review down. These are the actions that commit money, firm dates, delete, or speak to every visitor.
- `GateLevel.confirm` — a modal that names the consequence and waits. Reject (its reason dialog already is the deliberate input), the stay transitions, the recorded expiry, room status and price override, payment-reference add and delete, sign out, the live-location reader grant.

`gateFor()` **throws on an unmapped `GateAction`**. A future action cannot silently default to no gate; it fails the tier-map test instead. Screens map their own controls onto `GateAction`s — `adminActionsFor()` in the shared lifecycle is never consulted by the gate.

### 2. The check stays out of the shared lifecycle

`booking_lifecycle.dart` is the single source of truth for what a transition *does*, shared in spirit (and mirrored in tests) with the website, and a Guest has no PIN. The gate lives beside it, imports it, and is never imported by it.

The structural backstop is in the admin app's own service: `FirestoreService.applyBookingAction` re-asks `gateForBookingAction()` on every call — cloud and demo path — and **refuses any PIN-tier action without a fresh ticket**. So `_runQuick`, or any call site added next quarter, cannot become a bypass by forgetting the sheet: the service refuses, loudly.

### 3. Not a Credential

`Credential` is taken (CONTEXT.md § Access): the door RFID / Mobile Key. The words here are **Security PIN** and **Security gate**, and CONTEXT.md says so with its `_Avoid_` lines.

### 4. Storage: `admin_security/{uid}`, PBKDF2, and the device as cache

`profiles/{uid}` was not an option: its rule enforces a closed key list, and a hash would need the role document rewritten. New collection:

```
admin_security/{uid} = { uid, pin_hash, salt, iterations, failed_attempts,
                         locked_until, pin_updated_at, pin_updated_by }
```

- **PBKDF2-HMAC-SHA256**, 16-byte `Random.secure()` salt, 100,000 iterations (stored per record, so the default can rise without stranding records), plaintext never written. Same stretch and same base64 shape as the website's demo-mode passwords (`src/lib/authLocal.ts`) — one hashing convention in the repo.
- The device copy (SharedPreferences, the same house triple as `tutorial_store.dart`) is a **cache** so the check works offline. Firestore is the source of truth and reconciles on the next successful write.
- Rules beside the profiles block: Admin-only, own-doc-only, **never deletable**, and an update takes one of two doors —
  1. **the counter door**: only `failed_attempts` / `locked_until` move, and only *forward*. The server counter is a **ratchet**: failures record, locks push later, nothing lowers, and clearing app data or writing Firestore directly clears nothing. (This is a deliberate sharpening of the original sketch's "reset on success in Firestore": a reset the server cannot distinguish from tampering is not a reset worth having, so the friendly reset lives on the device counter, which is what the ladder reads, while the server holds the tamper-evident watermark.)
  2. **the rotation door**: a real PIN change — new hash, stamped `pin_updated_at == request.time` by the writer, counters born zero — and **refused while a lock is live**, so rotating cannot become the way around the wait. The app offers rotation only after a current-PIN check.

### 5. Lockout, and the grace ticket

- 5 wrong entries start the ladder: 30 s, doubling per subsequent failure, capped at 5 min. The device enforces it; every failure also writes the counters to Firestore (best-effort, never blocking), so a lockout survives an app-data clear.
- Offline with no cached record **refuses** — the sheet says the PIN could not be checked and sensitive actions stay locked. It never fails open, and a fresh install cannot mint a new PIN for an account the server has a record for without being able to reach the server.
- A correct PIN mints a **ticket valid 120 s**, so approving a morning's arrivals costs one entry. `AuthGate` wipes it on `AppLifecycleState.paused` — the exact boundary of "signed in".

### 6. The sheets

`lib/views/security/` — house style (Cinzel titles, Inter body, the app's palette, `Back` as the cancel word):

- **PIN sheet** — the action's name, one line of consequence ("This verifies ₱8,000 and firms the dates. It cannot be undone."), six dots, a 3×4 keypad with 64 px targets, a haptic per digit, auto-submit at six. Wrong PIN → shake, heavy haptic, the dots flash alert red. Locked → a live countdown, a dead keypad, and a sheet that does not dismiss. Every key and the dot row carry Semantics.
- **Confirm sheet** — one confirm modal, built once, absorbing the Booking detail screen's private `_confirm`, used at every Tier-2 site.
- **Setup sheet** — forced create-then-confirm on first Admin sign-in. Changed in Settings, **never disabled** — a gate that can be turned off is itself a bypass.

## Consequences

- Every mutating call site in the app goes through the gate first, and the Booking service backstops it regardless.
- `admin_security` is one more collection in `firestore.rules`, with a mirror suite in `test/rules/firestore-rules.test.ts` and the shape documented in `docs/DATA_STORES.md`.
- Bundled in the same change, because failing silently right after someone entered a PIN is the worst possible outcome: `deleteBooking`, `updateRoomStatus` and `recordSmartLockEvent` return their errors instead of swallowing them; `publishRates` / `publishPaymentInformation` roll the in-memory copy back when the network write fails; the room-status write is awaited and typed at its call sites; and the smart-lock simulator's rows are stamped `simulated: true` and run behind a confirm, so demonstration rows never pass as door history.
- What this does **not** settle: `payment_references` still exists in the rules while the Payment references screen holds an in-memory list — a confirmation guarding something that was never saved. Persisting that list is its own decision, not a rider on this one.

## Alternatives rejected

- **The check inside `booking_lifecycle.dart`** — rejected: that module is shared with the website (ADR-0007/0010) and a Guest has no PIN. The lifecycle stays pure; the gate is admin-app-only.
- **Biometrics** — rejected for now: device-local, plugin-dependent, and it answers "whose finger is this", not "does this session mean to spend the resort's money". The ladder and the ticket do more of the work for less.
- **Calling it a Credential** — rejected: the word is owned by the door (CONTEXT.md § Access).
- **Reset-on-success written to Firestore** — rejected in favour of the ratchet (see § 4): the rules cannot tell a legitimate reset from a tampered one, so the server counter only ever moves forward.
