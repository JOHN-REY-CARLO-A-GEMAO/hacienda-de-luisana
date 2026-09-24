# The money and audit invariants are enforced in the rule layer, not only in the apps

**Status**: accepted, 2026-09-24. Resolves the six findings of the verification pass (PR #28, `docs/VERIFICATION.md` §3.3).

The application's lifecycle module — `src/lib/booking/` on the website,
`lib/services/booking_lifecycle.dart` in the Admin app — remains the **single
source of truth for the booking lifecycle**: which action, from which status, by
which actor, into which status. Nothing about that table is copied into
`firestore.rules`.

What *is* enforced in the rule layer is a short list of invariants that a client
talking straight to Firestore must not be able to break, because a browser
console never loads the module:

| Invariant | Rule |
| --- | --- |
| A Guest claims money, the Admin verifies it (ADR-0001) | A Guest's self-serve write may only put `payment_status` at `unpaid` or `pending`, or leave the stored value alone. `verified` is the Admin's word. |
| A Booking is born with nothing claimed and nothing reviewed | `create` accepts `payment_status` ∈ {`unpaid`, `none`, absent} and `kyc_status` ∈ {`required`, `submitted`, absent}. |
| `verified` is a claim that names its author | A document left saying `payment_status: 'verified'` must carry `amount_verified > 0`, a `payment_verified_at`, and `payment_verified_by == request.auth.uid`. A console cannot verify in another Admin's name, and a Guest cannot produce the marker at all. |
| `Reserved` is what verified money buys | The first clause of the update rule: no writer — Guest or Admin — may leave a Booking at `Reserved` unless it says `verified`. It also refuses a write that would un-verify money a Reserved Booking stands on. |
| Decisions are not undone by the person they were made about | A Guest's write may not move `payment_status` or `kyc_status` off an Admin-set value (`verified`, `rejected`, `approved`), and may not clear an Admin's rejection note except by attaching a fresh document in the same write. |
| A refund never exceeds the money that came in | A Guest withdrawing a paid Booking may record `refund_status: 'initiated'` with `refund_total ≤ amount_verified`, and a breakdown that agrees with the total. `refunded` — the money went back — is the Admin's to record. |
| The audit log is signed by whoever wrote it | An `activity` entry must carry the writer's own role *and* uid; the one exception is the `system` entry the Admin app files when a Date hold runs out (ADR-0002), and the unauthenticated submission entry a Booking made before sign-in writes. |
| A conversation belongs to one Guest | Reading or posting requires `guest_uid == request.auth.uid`; the Admin role is the only other door. A message must be signed by its sender (`sender_uid == auth.uid`) and labelled with the sender's real role. |
| A Review is one per stay, by the Guest who stayed | The document id is the Booking id, and the rule reads that Booking: it must exist, belong to the author, and be `Checked-Out`/`Completed`. Updates are closed, so the id being taken is the duplicate check. |

## Why

- **The rule file is the only layer a malicious client cannot route around.** Every
  finding in the verification pass was the same shape: the app checked something,
  the database did not, and a browser console does not run the app.
- **The alternative — moving the lifecycle into the rules — was rejected.** A
  transition table in the rules language would be a second copy that would drift
  from the module the Admin app and the website share, and the two apps would then
  disagree with the database in ways nothing tests. The boundaries above are
  deliberately *invariants about money and identity*, not a state-machine table.
- **Values, not key names.** The high finding was a key allowlist: the rule asked
  *which* keys a Guest touched, never *what they wrote into them*. Every money
  bound above constrains the value.

## What the decision means in code

- **`firestore.rules`**: new helpers `hasVerificationMarker()` and
  `reservedIsPaidFor()` (the update rule's first clause), `isConversationMember()`
  with an `exists()`/`get()` read of the conversation, and the value bounds in the
  Guest branch. Comments in the file name the module each invariant mirrors.
- **`src/lib/booking/actions.ts` and `lib/services/booking_lifecycle.dart`**: the
  `VerifyPayment` patch writes `payment_verified_at` and `payment_verified_by` —
  the same four fields on both sides, so neither can drift into a write the rules
  refuse. (The app's Admin UI already recorded the verifier; the website now does
  too.)
- **`src/lib/firestoreBookings.ts`**: a submission entry is signed with the uid the
  Booking belongs to, and `signActivityEntries()` signs an entry with the identity
  actually connected to Firestore, because the rules bind `actor_id` to the writer.
- **`src/lib/reviewsCloud.ts`**: a Review is written with `setDoc` at the Booking's
  id (`reviewDocId`), read back with one `getDoc`, and updates are closed — so the
  app's duplicate check and the database's refusal are the same fact.
- **Tests**: `test/rules/firestore-rules.test.ts` (executed rule text),
  `test/web/authorization-regressions.test.ts` (the application half of each
  finding) and `test/emulator/rules.emulator.test.ts` (the canonical suite, for a
  machine with Java and the emulator download).

## Consequences

- **A Guest cannot withdraw a paid Reservation without the settlement being
  checked.** The website's cancel path sends the settlement the lifecycle computes;
  the rule accepts it only up to the verified amount. A Guest who never paid has
  nothing to settle.
- **An Admin's verification is attributable.** If a verification exists, it names
  the Admin who made it — a document that says `verified` without that marker is
  refused, which also means a manual console edit cannot leave a half-verified
  Booking behind.
- **The unauthenticated submission path is narrower.** A Booking created before any
  sign-in can file exactly the `Submit` entry and nothing else.
- **Some writes that used to succeed now fail loudly**: a Guest pushing a
  `verified` Booking back to `pending`, a stranger posting into a conversation they
  do not own, a second Review for the same stay. Each has a regression test in the
  three suites above.
- **The rules are still not emulator-verified on this machine** (Java absent, JAR
  unreachable — `docs/VERIFICATION.md` §3.1). The rule text is executed by the
  in-repo evaluator, which is *supplemental* verification; `npm run test:emulator`
  is the canonical one.
