# The guest-history migration — runbook

Folding every Guest's scattered threads into the one conversation their account
has (`guest-<uid>`). Read [ADR-0025](adr/0025-one-conversation-per-guest-account.md)
for *why*; this document is *how*, in the order an operator does it.

**Nothing in this job deletes anything.** Every source thread stays where it is
with its messages and private attachments intact, annotated `superseded_by` so a
reader knows where its history went. That is what makes the run recoverable and
reversible by hand, and it is why the job is safe to rehearse.

---

## 0. Before anything moves

The code change lands first and is safe on its own:

- **`firestore.rules`** — clients may create exactly one conversation id,
  `guest-<uid>`. Until the migration runs, a Guest's existing `booking-*` and
  `inquiry-*` threads stay readable (and writable by old app versions), and new
  Guests get one thread from the start.
- **Both apps** — resolve `guest-<uid>` and carry the Booking as message
  context. A Guest whose history has not been folded in yet still sees their old
  threads, read-only, underneath the account conversation.

So the order is: **deploy → audit → dry-run → apply → verify.** Deploying
without migrating is a supported state; migrating without deploying is not.

**One cutover cost, stated up front.** Live location is keyed by conversation
id: `location_sessions/{conversationId}` and the Realtime Database node
`live_location/{conversationId}/{guestUid}`. Consolidating to `guest-<uid>`
moves those paths, so a session that is *in flight* when a Guest is switched to
the account thread stops being found where either app is looking. Sessions
expire on their own — 15, 30 or 60 minutes — so the exposure is bounded, and
the Guest can simply start a new one. Migrate outside check-in hours and there
is nothing to see.

## 1. Audit — read the structures, change nothing

```bash
cd functions && npm run build
node lib/src/scripts/migrateGuestHistory.js --audit
node lib/src/scripts/migrateGuestHistory.js --audit --uid=<uid>
node lib/src/scripts/migrateGuestHistory.js --audit --json > audit.json
```

This writes nothing at all. It reports, per Guest:

| Field | Meaning |
| --- | --- |
| `canonicalExists` | Whether `guest-<uid>` is there yet |
| `sources` | Threads a run would fold in, with message and attachment counts |
| `alreadySuperseded` | Threads a previous run already folded in |
| `plannedCopies` / `plannedAttachments` | What the copy would move |
| `canonicalMessageCount` | What is already in the account thread |

Conversations that name **no** `guest_uid` are reported as orphans and left
alone. An unattributable thread is never merged into somebody's account on a
guess — that is the one thing this job must not get wrong.

## 2. Dry-run — plan the fold, still change nothing

```bash
node lib/src/scripts/migrateGuestHistory.js --uid=<uid>            # one Guest
node lib/src/scripts/migrateGuestHistory.js --all                  # everyone
```

Dry-run is the **default**. It writes nothing — not the lock, not the canonical
thread, not a single message. It stops before the lease is even considered.

## 3. Apply — the only step that writes

```bash
node lib/src/scripts/migrateGuestHistory.js --uid=<uid> --apply --confirm <projectId>
node lib/src/scripts/migrateGuestHistory.js --all   --apply --confirm <projectId>
```

`--apply` **refuses to start** unless `--confirm` repeats the project id the
process is pointed at, and resolves one at all:

| Situation | Result |
| --- | --- |
| `--apply` without `--confirm` | exits 3, refuses |
| `--confirm` ≠ `GCLOUD_PROJECT` | exits 3, refuses |
| no project id resolvable | exits 3, refuses |
| `FIRESTORE_EMULATOR_HOST` set | `--confirm` not required |

What it does, in order:

1. Takes a **leased lock** at `migration_runs/guest-<uid>` (15 minutes,
   renewed every 25 copies).
2. Creates the canonical `guest-<uid>` thread if it is missing.
3. Copies each message with its **original** `sender_uid`, `sender_role`,
   `text`, `created_at` and `booking_id`, plus `migrated: true` and a
   `migration` provenance map.
4. Copies each private image to `messageAttachments/guest-<uid>/<newId>` and
   verifies its size.
5. Annotates each source thread `superseded_by`, `superseded_at`, `archived`.
6. Marks the run complete with the plan hash and the counts.

It never touches `unread_admin` or `unread_guest` — a copy is not something
unread. It moves the inbox preview only when the copied message really is the
newest thing in the thread, so a run over three-year-old history cannot bury
this morning's conversation.

## 4. Recovery

Every copy answers to an id derived from its source
(`migrated-<sha256(source, message)>`), so a retry lands on the same document
instead of creating a second copy. That makes all of these safe:

| What happened | What to do | What happens |
| --- | --- | --- |
| The run finished | run it again | `already-complete`. No writes. |
| It crashed halfway | wait for the lease, or run with `--resume` | copies only what is missing; the crash is recorded on the lock |
| Two operators started | nothing | the second gets `locked` and writes nothing |
| A source thread received a new message after being merged | `--resume` | the plan is recomputed; only the new message is copied |
| An attachment object is missing | the run fails | fix Storage, re-run; the message metadata is untouched |

A failed run leaves the lock **held**, deliberately: a half-finished job must not
look finished. After `DEFAULT_LEASE_MS` (15 min) the lease expires and the next
run takes over on its own. `--resume` takes it over immediately.

## 5. Verify

```bash
node lib/src/scripts/migrateGuestHistory.js --audit --uid=<uid>
```

- `sources` is empty, `alreadySuperseded` lists the old threads.
- `canonicalMessageCount` equals the sum of the source message counts before
  the run.
- The source threads still exist, still hold their messages, and carry
  `superseded_by`.

Then, in the apps: the Guest's thread shows the whole history in one timeline,
each message labelled with the reservation it is about; the Admin's inbox shows
one row for that Guest; and **no push notification was sent for any copied
message** — the provenance check in `evaluateGuestMessageCreated` is what
guarantees that, and it is asserted in
`functions/test/guest-history-migration.test.ts`.

## 6. Rollback

There is nothing to roll back in the data. Every source thread is still there,
untouched. To undo the *view*, delete `guest-<uid>` and clear `superseded_by`
on the sources; both are ordinary Firestore operations, and neither is needed
to recover, because the sources were never modified.

---

## Testing performed

| Suite | Run by | Covers |
| --- | --- | --- |
| `functions/test/guest-history-migration.test.ts` | `npm --prefix functions test` | audit writes nothing; dry-run writes nothing; copies keep sender/role/text/timestamp/booking; nothing is deleted; a retry duplicates nothing; a crash resumes; a second worker is locked out; a message that cannot be reproduced stops the run; copies never notify |
| `test/web/guest-conversation-identity.test.ts` | `npm test` | the id formula, its stability, classification, and what counts as usable booking context |
| `test/web/chat-messaging.test.ts` | `npm test` | one conversation per account, booking context on messages, superseded threads still readable |
| `test/rules/firestore-rules.test.ts` | `npm run test:rules` | no client creates a non-account conversation id; message booking context is validated; clients cannot stamp migration provenance |

**Not run here:** `flutter test` and `flutter analyze` (no Flutter/Dart SDK in
this environment), and the emulator suite (no Java runtime). The migration is
exercised against in-memory doubles of the Firestore, Storage and lease ports;
`functions/src/guestHistoryAdapter.ts` is the only file that touches the real
SDK, and the emulator is where its behaviour should be confirmed before a
production run.
