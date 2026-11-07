# A forgotten Security PIN is reset by a code mailed to the Admin's own address

**Status**: accepted, 2026-11-07. **Reverses ADR-0016 §1 and §4** (the Admin's own signed-in session may delete `admin_security/{uid}` after 24 h) and **narrows ADR-0016 §3** (the `PinReset` trail line is now written by the server, not by the app). Restores ADR-0015 §4 for every client: the PIN record is not deletable from a phone. Leaves ADR-0015's tiers, lockout ladder, ticket and offline checking untouched. Touches nothing on the website.

## The problem this settles

ADR-0016 closed a real dead end — a PIN chosen once and forgotten left the operator in front of six dots with no exit — and it was honest about the price in its own §"What this is, and what it honestly is not":

> **anyone holding a signed-in, unlocked phone can wipe the record and set a new PIN.**

That sentence is the door the product owner sent back. A 24-hour cooldown is not proof of anything: it delays the person holding the phone by a day and asks for nothing they do not already have. In a household where the Admin's phone is left on a table, on a desk, or charging in the office, "signed in on this device" is not an identity — it is a location.

So the reset needs something the phone cannot supply by itself, and the system already has the one thing that qualifies: **the Admin's registered email address**, the same address Firebase Auth verifies and the same account this app signs in with.

## What is decided

### 1. The reset is an emailed one-time code, checked by the server

A new Supabase Edge Function, `supabase/functions/admin-pin-reset/`, in two calls:

| Call | What the server does | What it does **not** do |
| --- | --- | --- |
| `{ action: 'request' }` | verifies the caller's Firebase ID token, requires `profiles/{uid}.role == 'admin'` or the bootstrap allowlist, requires `email_verified`, mints six digits, stores a **salted SHA-256** of them, mails them to the address **on the token** | it does not touch the PIN record, and it accepts no recipient from the client |
| `{ action: 'verify', code }` | checks the digest inside a transaction, spends the code, then deletes `admin_security/{uid}`, deletes the reset record, and files one `admin_security_events` line, in one batch | it does not read or write the PIN itself — a fresh one is chosen on the phone afterwards |

The Admin app never hashes a code. Six digits typed into the sheet go straight up the wire over TLS and are compared where they were made, so a patched phone has nothing to skip.

### 2. The address is the one Firebase verified, never one the phone names

`decoded.email` with `decoded.email_verified === true`. An unverified address is refused with its own message ("Verify your email address first — the code is sent there"), because an unverified address is an address anybody could have typed. The app is shown a masked form (`g***s@gmail.com`) so it can say which inbox to open without printing the address on a screen a stranger may be holding.

**This is the whole security story and it is worth stating plainly:** a person with the Admin's phone and no access to the Admin's inbox cannot reset the PIN. That is the difference between this and ADR-0016, and it is the only reason the door can be open at all.

### 3. The code is six digits, fifteen minutes, single-use, and never stored

- six digits from `crypto.getRandomValues` with rejection sampling (not `Math.random`, and not `% 1000000`, which biases the low end);
- `PIN_RESET_CODE_TTL_MS` = 15 minutes;
- `admin_security_resets/{uid}` holds `code_hash`, `code_salt`, `attempts`, `issued_at`, `expires_at`, `consumed_at` and the pace counters — **never the digits**;
- five wrong entries spend it (`PIN_RESET_MAX_ATTEMPTS`), and a correct entry stamps `consumed_at` in the same transaction that settles the PIN, so it cannot be spent twice;
- a new request overwrites the old record, so there is only ever one live code per Admin.

A million values is small enough that the attempts ladder is not optional; it is also small enough that guessing is never cheaper than asking for a new code, which is what keeps the ceiling honest.

### 4. The send button has two brakes, both server-side

`admin_security_resets/{uid}` also carries `window_started_at`, `sent` and `last_sent_at`, written inside the same transaction that mints the code:

- **one minute between sends** (`PIN_RESET_REQUEST_COOLDOWN_MS`), so a held button cannot spam an inbox;
- **three sends per window of an hour** (`PIN_RESET_REQUESTS_PER_HOUR`), anchored on the first send rather than on the clock, so two requests cannot land either side of an hour boundary and deliver four in two minutes.

Neither counter is client-writable — the rules refuse every client operation on the collection — so clearing app data or reinstalling does not refill the budget.

### 5. The self-service delete is closed for clients

`firestore.rules`, in `match /admin_security/{uid}`:

```rules
allow delete: if false;
```

ADR-0016's door — `isAdmin() && request.auth.uid == uid && request.time > pin_updated_at + duration.value(24, 'h')` — is gone. ADR-0015 §4's *"the document is never deletable — a lockout record is evidence"* is true for every client again, and the only delete left is the Admin SDK's inside `admin-pin-reset`, which the rules do not govern and which requires the mailbox.

The rest of the block is untouched: the counter ratchet, the rotation door, the live-lock refusal, own-doc `read`, own-doc `create`. A phone that cannot reset the PIN also cannot lower its lockout watermark.

### 6. The trail line moves to the server

ADR-0016 §3 had to admit a gap: a rule evaluating a `create` has no pre-write `resource`, so it could not bind a `PinReset` line to the delete it describes, and an Admin could file a line without disposing of anything. That gap is closed by taking the pen away from the client:

```rules
match /admin_security_events/{eventId} {
  allow read: if isAdmin();
  allow create: if false;
  allow update, delete: if false;
}
```

The function writes the line with the Admin SDK, in the same batch as the delete. The document keeps its documented three fields (`uid`, `action: 'PinReset'`, `at`) — nothing extra — so `docs/DATA_STORES.md` still describes it correctly. Read stays Admin-wide, so a second Admin promoted later can see what happened to the first one's gate.

### 7. The app side is deliberately thin

- `PinSecurityRemote` loses `forgetPin` entirely; `FirestoreService.forgetPin` and its batch are deleted. A client that *can* delete the record is a client a stolen phone can drive, so the capability is removed rather than merely unused.
- `PinGate` gains a `PinResetRemote` (the HTTP) and two methods: `requestPinResetCode()` and `confirmPinResetCode(uid, code)`. The second clears the device cache and voids the session ticket **only** when the server answers `{ reset: true }`. A refusal changes nothing, so a reset that did not happen cannot read as one that did — ADR-0016's rule, kept.
- `lib/views/security/forgot_pin_sheet.dart` is rewritten as the two-step sheet: *Send the code* → masked address → six digits → *Set the PIN aside*. The 24-hour countdown copy is gone because there is no longer a wait to count.
- The gate's trigger renders only when there is a server record to dispose of **and** a reset service to mail from. Demo mode has neither, so it has no dead end and no affordance.

### 8. Delivery is Resend, and an unconfigured deployment says so

`POST https://api.resend.com/emails` with `RESEND_API_KEY`. There is no mail transport in this repository otherwise, and a Cloud Function was never an option (ADR-0016's rejected alternative, and this project is not on Blaze); the Supabase function is the host the payment-proof read already uses, with the same `verify_jwt = false` reasoning and the same self-authentication.

With `RESEND_API_KEY` unset the function answers **503** with *"Sending codes is not configured yet"* rather than a cheerful `sent: true`. A screen that claims a code was mailed when nothing was mailed strands the Admin at six dots with a wait that never ends — worse than the dead end this ADR is closing.

The email carries the digits and no link. A link in a reset email is a phishing habit to teach, and the code is typed into the app that asked for it.

## What this costs, stated plainly

- **A deployment step.** The function has to be deployed and three secrets set — `RESEND_API_KEY`, `PIN_RESET_FROM`, `BOOTSTRAP_ADMIN_EMAILS` — or the sheet cannot send anything. Until then the reset is unavailable, which the sheet says out loud. The old door needed only a rules deploy; this one needs a mailbox and an API key.
- **A dependency.** Resend is a third-party mailer. Its free tier sends from `onboarding@resend.dev` and, in test mode, **only to the account owner's own address** — which happens to be exactly right for a single-Admin hacienda, and is a hard limit to remember if a second Admin is ever promoted. A custom sender domain is the production answer.
- **A verified address is now required.** An Admin whose Firebase `email_verified` is false cannot use the reset at all. That is deliberate (see §2), and it is a support conversation the operator should have once, up front.
- **The PIN is still not a credential.** Nothing here makes the PIN stronger. It makes *forgetting it* recoverable without handing the recovery to a phone.

## Alternatives rejected

- **Keep ADR-0016's 24-hour self-service delete** — it is the thing this ADR exists to remove. A cooldown is not proof of identity.
- **Firebase's built-in `sendPasswordResetEmail` only** — it recovers the *sign-in password*, not the PIN, and it does not prove anything about the person holding the phone either (anybody with the phone can request the mail and, if they also have the inbox, reset the password and sign back in). It is a good idea for a locked-out *sign-in*, and it remains the separate decision ADR-0016 §"Consequences" left open; it is not this door.
- **A code checked on the phone** — a verifier that runs on the device is a verifier a patched device skips. The digest lives on the server, and so does the delete.
- **A recovery email field stored in Firestore** — an address the app can edit is an address a phone can redirect. The verified Firebase address is the one an outsider cannot change from the app.
- **SMS** — a second vendor, a per-message cost, and a phone number that a SIM swap defeats. The Admin has an email account already.
- **Calling it a password reset** — CONTEXT.md owns the word, and this is a **PIN reset**: the PIN is not a credential (ADR-0015 §3).

## Verification

- **Rules**: `test/rules/firestore-rules.test.ts` — the delete is refused for the Admin, another Admin, a Guest and a signed-out caller at 0 s, 24 h, 24 h + 1 ms and a year; `admin_security_events` accepts no client write and no update or delete; `admin_security_resets` refuses every read and every write, including an Admin lowering their own attempt counter. Run with `npm run test:rules`.
- **The code itself**: `test/web/pin-reset.test.ts` — 28 cases over `supabase/functions/`: shape, generation, digest, digest verification, the Admin gate, request pacing, code usability, address masking, the app's mirrored constants, and the function's wiring — no plaintext code in a write or a log, no client-named recipient, the delete is a server write, every imported name is really exported (see below), and the verify verdict is the transaction's return value.
- **The BOOT_ERROR that testing had missed.** The first deployment of this function answered `503 BOOT_ERROR` on every request. Two helpers had moved from `admin-gate.ts` to `pin-reset-code.ts` and the function's import list had not followed; `tsc` typechecks the *shared* modules against the app rather than the function's own imports, and Deno only complains at boot, so nothing in this repository saw it. `test/web/pin-reset.test.ts` now resolves every relative import against the module it names, and the case was proved by reintroducing the bug: the suite fails and prints the two offending names.
- **The app**: `test/pin_policy_test.dart` and `test/pin_gate_screen_test.dart` — asking for a code deletes nothing; a wrong code leaves the record and the ticket alone; a confirmed code clears both and reaches `setUpNeeded`; an offline or unconfigured build is refused rather than pretended away.
- **Not verified here**: the Edge Function has no Deno runtime in this environment, so it is typechecked by the app's `tsc` (for the shared modules) and read, not executed. See `docs/LIMITATIONS.md`.
