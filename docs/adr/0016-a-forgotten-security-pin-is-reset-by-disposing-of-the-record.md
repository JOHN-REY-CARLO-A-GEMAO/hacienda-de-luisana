# A forgotten Security PIN is reset by disposing of the record

**Status**: accepted, 2026-10-06. **Contradicts ADR-0015 §4** (the PIN record is never deletable; rotation is refused while a lock is live) — deliberately, and only for this one door. **Extends** ADR-0015 and does not change its tiers, its lockout ladder, its ticket, or any Booking rule. Touches nothing on the website.

## The problem this settles

ADR-0015 built a Security PIN that is deliberately **not** self-service. Its two update doors are a counter that only moves forward, and a rotation that the app offers only after a current-PIN check — and the rules refuse that rotation outright while a lock is live, so rotating cannot become the way around the wait.

The cost of that design is a dead end. A PIN is six digits chosen once and not written down. Forget it and the gate screen offers six dots with no exit:

- the device copy cannot be trusted into minting a new record — `PinSetupState.unreachable` refuses rather than fails open (ADR-0015 §5);
- the server record exists, so `setupState` returns `ready` and asks for the very PIN nobody has;
- rotation needs the current PIN;
- the delete is `if false` — "a lockout record is evidence" — so there is no server-side way out either.

The only recovery in the whole system is out of band: the Firebase console bypasses rules, so an operator can delete `admin_security/{uid}` by hand. That is a 2 a.m. answer, not a product.

## What this is, and what it honestly is not

**This closes a lockout, and it is not an authentication factor.** ADR-0015 is explicit that the PIN is "a guard rail, not a trust boundary" and that the rules are the enforcement. That framing is unchanged and it is what makes this decision cheap to justify:

- the proof of identity here is a **signed-in Firebase Admin session**, not the PIN;
- the PIN never was the thing standing between a thief and the hacienda's money — ADR-0010's money invariants are, and they are untouched;
- so this feature cannot become a way to defeat the PIN, because the PIN was never what defeated an attacker anyway. **What it does stop is a locked-out operator.**

And the honest limit: **anyone holding a signed-in, unlocked phone can wipe the record and set a new PIN.** That is true of the PIN already — a PIN cannot stop a person holding the device — and ADR-0015 says so in its own §2. This does not make the phone threat worse. What it removes is the permanent lockout.

## Contradicts ADR-0015 §4 — stated plainly

ADR-0015 chose two properties this ADR gives up, and `docs/agents/domain.md` requires that a contradiction be surfaced rather than silently overridden:

| ADR-0015 §4 says | This ADR does |
| --- | --- |
| "the document is never deletable — a lockout record is evidence" | Adds one bounded door: `allow delete` when the Admin's own signed-in session owns the document and 24 h have passed since it was last stamped. The record can now be disposed of. |
| rotation is "refused outright while a lock is live, so rotating cannot become the way around the wait" | The delete door **ignores a live lock**, which is the entire purpose. The 24 h cooldown is what replaces the wait as the brake. |

The second row is the one to argue about, so: the rotation door's reason for refusing a live lock was to stop *the same person* from using a PIN change to skip the penalty for guessing. Here the person is not guessing — they are locked out and cannot authenticate at all. A 24-hour cooldown that keys off a stamp only a genuine PIN change can move is the brake that replaces the lock check, and it is far slower than the 5-minute lockout cap, so a guesser gains nothing by choosing this door over waiting.

What is **not** given up: ADR-0015 §5's guarantee stands verbatim — *"a fresh install cannot mint a new PIN for an account the server has a record for without being able to reach the server."* The reset requires the server. It is an online operation, and `PinGatePhase.blocked` (the unreachable state) still offers only Try again and Sign out.

## What is decided

### 1. The third door

`firestore.rules`, in the existing `match /admin_security/{uid}` block:

```rules
allow delete: if isAdmin()
  && request.auth.uid == uid
  && resource.data.pin_updated_at is timestamp
  && request.time > resource.data.pin_updated_at + duration.value(24, 'h');
```

Two spellings here that are not interchangeable, both found by running the engine rather than by reading:

- **`duration.value(24, 'h')`, not `duration(hours: 24)`.** Both are real rules syntax, but `test/rules/engine.ts` parses rules through `@firebase/eslint-plugin-security-rules/parser`, which **rejects the named-argument form**. This is the first `duration()` in the repository's rules, so nothing else would have caught it — writing the prettier version would have made `npm run test:rules` fail to compile for everyone. `engine.ts:121` documents the positional form as the one the language spells.
- **`>` not `>=`.** At exactly 24 h the comparison is false and the reset is refused; it opens one millisecond later. That is deliberate and matches the ratchet everywhere else in this file — never equal, only later.

Three bounds, all of them doing work:

- **`isAdmin() && request.auth.uid == uid`** — the identity proof is a signed-in Admin, only ever on their own record. A Guest cannot reach this block at all; another Admin cannot touch it.
- **the 24 h cooldown, keyed off `pin_updated_at`** — the same stamp the rotation door already trusts, and that **only a stamped rotation moves** (`request.resource.data.pin_updated_at == request.time`). Failures do not advance it, so five wrong guesses cannot buy a wipe. This mirrors the existing ratchet: the server watermark moves forward only on something real.
- **`is timestamp` is required, not assumed** — a record without the stamp is not deletable, so this cannot become a way to clear a malformed document.

### 2. The wipe is self-limiting

The 24 h is not a rate limit bolted on afterwards; it restarts itself. After a delete the document is gone, so `setupState` returns `setUpNeeded` and the operator sets a new PIN — and a new `pin_updated_at` starts the clock again. One wipe per 24 h per device-with-a-session, and a wipe buys the holder of the phone a fresh PIN, which is precisely what the PIN's threat model already allows.

### 3. The event survives the record it describes

`activity` is a Booking subcollection with a closed `knownAction()` vocabulary, and there is no shape in it for a non-Booking event — so **it is not extended**. A new append-only collection carries the fact:

```
admin_security_events/{eventId} = { uid, action, at }
```

`create` for the Admin on their own uid with `action == 'PinReset'` and `at == request.time`; `read` for the Admin; **`update, delete: if false`** — the same append-only posture as `access_logs`, for the same reason.

The point is that the evidence outlives the deletion. The Firebase console can delete a record and leave no trace; this cannot. The console route remains the heavier hammer for a genuinely lost account, and it is now the *second* door rather than the only one.

**What the rule does not do, said plainly:** it does not prove the delete happened alongside this line. A rule evaluating a `create` has no pre-write `resource` for the document being created, so it cannot read the stamp off the record that was just disposed of — an earlier draft of this ADR claimed a cross-document binding that the rule language cannot express. The two are tied by the app writing them in one batch and by nothing else. An Admin could file a `PinReset` line without deleting anything; that is a noisy trail rather than an escalation, because the delete is gated on its own.

### 4. One batch

The delete and its `PinReset` event are written in a single `writeBatch`. A record that vanished with no companion line, or an event with no record gone, is not a state this system can be in.

### 5. Not a gated action

Recovery is not in `security_gate.dart` and gets no `GateAction`. `gateFor()` throws on an unmapped action by design (ADR-0015 §1), so admitting recovery there would change the tier map's contract to accommodate something that is not a sensitive action. The sheet that drives the reset is a normal sheet in `lib/views/security/`, in the house style of ADR-0015 §6.

### 6. Demo mode hides it

`PinGate.remote == null` means there is no Firestore to dispose of, and no dead end either — `setupState` already returns `setUpNeeded`. The affordance is not rendered.

## Consequences

- `admin_security` gains a third door and `admin_security_events` is a new collection with its own rules block, a `test/rules/` mirror, and an entry in `docs/DATA_STORES.md`.
- `PinSecurityRemote` gains `forgetPin`; `FirestoreService`, `test/pin_policy_test.dart`'s `_RecordingRemote` and `test/pin_gate_screen_test.dart`'s `_DeadRemote` implement it. A **refused** reset leaves the local record and the ticket exactly as they were — only a server-confirmed delete clears them.
- The Admin app gains a "Can't remember your PIN?" affordance on the gate's *enter* phase only, and `lib/views/security/forgot_pin_sheet.dart`.
- **Verification is supplemental.** The canonical Firebase Emulator Suite still does not run in this environment (no Java — `docs/LIMITATIONS.md`), so the new rule cases are written into `test/emulator/rules.emulator.test.ts` unexecuted, and the Dart was written and reviewed without a compiler (no Flutter SDK). Every verdict below is the in-repo evaluator reading the rule text.
- What this does **not** settle: the Admin's **Firebase sign-in password** still has no recovery in the app. `sendPasswordResetEmail` would fix that natively and free, but it is a different credential and a separate decision. An Admin locked out of Firebase cannot reach the PIN gate at all, so this ADR does not help them.

## Alternatives rejected

- **An email-based reset with a one-time code** (a Cloud Function, an SMTP provider, a hashed code, a 15-minute expiry, an attempts ladder). Rejected as unreachable infrastructure: Cloud Functions have no free tier on the Firebase Spark plan, and this project is not on Blaze. It is the fuller answer for a multi-operator business with a real backend; it is not available to this one.
- **A second Admin resets the first** — the Admin is one person. There is no second Admin to ask.
- **Wiping the device copy alone** — the server record would still answer `ready` and the gate would keep asking for a PIN nobody has. This is the dead end, not a fix for it.
- **Widening the rotation door to accept a fresh PIN without the current one** — that deletes the PIN as a second input entirely. `setPin` is called from the setup sheet after `setupState` says `setUpNeeded`; making it callable on demand would let a stolen phone rotate without knowing anything.
- **Clearing the lockout at the same time as forgetting** — the same delete does both, and saying so in the rule rather than pretending otherwise is the point of this ADR.
- **Calling it a password reset** — CONTEXT.md owns the word. This is a **PIN reset**: the PIN is not a credential (ADR-0015 §3).
