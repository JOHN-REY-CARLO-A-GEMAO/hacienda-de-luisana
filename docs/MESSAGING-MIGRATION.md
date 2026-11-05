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

**Live location must be quiet. This is a hard gate, not a timing trick.** A
live-location session is filed under the conversation id — the consent at
`location_sessions/{conversationId}` and the position at
`live_location/{conversationId}/{guestUid}`. Consolidating a thread retires the
id that session hangs on, so migrating under a running session would leave a
Guest sharing into a thread neither app reads any more: the Admin's panel would
simply stop showing them, with no error anywhere.

The job therefore refuses to migrate a Guest while a session is live on any of
the threads it is about to fold. It does not stop sessions, does not shorten
them, and does not assume anything about the time of day — a Guest can share at
03:00, and "it is outside check-in hours" is not evidence that nobody is. The
full procedure is [§ 2b](#2b-live-location-the-gate-that-decides-when).

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

## 2a. Dry-run — plan the fold, still change nothing

```bash
node lib/src/scripts/migrateGuestHistory.js --uid=<uid>            # one Guest
node lib/src/scripts/migrateGuestHistory.js --all                  # everyone
```

Dry-run is the **default**. It writes nothing — not the lock, not the canonical
thread, not a single message. It stops before the lease is even considered.

It *does* report the live-location state, because "this Guest is sharing right
now, you will have to wait" is exactly what an operator planning a run needs to
know. It does not wait, and it does not block: a dry run moves nothing, and a
plan that hangs for an hour helps nobody.

```bash
node lib/src/scripts/migrateGuestHistory.js --all            # plan + live-location state
node lib/src/scripts/migrateGuestHistory.js --all --json     # machine-readable
```

## 2b. Live location — the gate that decides when

A session blocks the migration of every thread it is filed under. Sessions run
for **15, 30 or 60 minutes** and are ended by the Guest or by their own expiry —
never by this job.

| Step | What happens |
| --- | --- |
| **1. Detect** | Both databases are read: `location_sessions/{conversationId}` in Firestore (the consent) and `live_location/{conversationId}/{guestUid}` in the Realtime Database (the position). Doc-id lookups, not queries, so one conversation is one read each. |
| **2. Match** | The session's conversation id is compared with the threads this run is about to fold. A session on the canonical `guest-<uid>` is *reported* but does not block — that path is the destination, not one being retired. |
| **3. Wait** | With `--wait=<minutes>` the run re-checks every `--poll-seconds` until the sessions end on their own. It polls up to a wall-clock deadline, and never longer than 61 minutes, which is the longest a session can be. |
| **4. Recheck** | Immediately before the first write — after the lease is taken — both databases are read again. A Guest can have pressed "share" during the wait, and the lease is not permission to ignore that. |
| **5. Recheck again** | Before any thread is marked, because the copies below take time — one round trip per message — and a Guest can start sharing in the middle of them. |
| **6. Retire atomically** | Each thread is marked superseded inside a transaction that first reads `location_sessions/{conversationId}` and refuses if a session is live. Check and write are one step, so there is no instant in which a thread is retired and a live session is filed under it. |
| **7. Abort** | If anything is still live, the run annotates nothing more, and records the block with the reason on it. No session is stopped, invalidated or touched. |
| **8. Verify** | After a successful run, the check in [§ 5](#5-verify) confirms no live session is left on a retired thread. |

A session counts as live until **one minute after** its own expiry: the rules
stop serving a position at expiry, but `stopSharing()` and
`onDisconnect().remove()` are what actually sweep the node, and either can land
a moment late.

### The race, and why the gate is where it is

The copy loop is not instantaneous. A Guest can press "share my location"
*after* the checks in steps 1–4 have all passed and *before* the thread is
retired — and then the run would mark it superseded with a live session filed
under it. Both apps have moved to `guest-<uid>`; the Guest believes they are
being watched; nobody is watching anything, and no error appears anywhere.

Three things close it, because no single one can:

| | Closes | How |
| --- | --- | --- |
| **Recheck before annotating** | The copy loop | One more read of both databases before the first thread is marked, so the common case blocks before anything is retired. |
| **Atomic retirement** | The instant of retirement | `superseded_by` is written inside a transaction that first reads the session. A Firestore transaction cannot read the Realtime Database, so the *consent* is what is made atomic — and the consent is the half that matters: `startSharing` writes it before publishing any position, so a consent the transaction cannot see has not put anyone on the map. |
| **A rule, in `firestore.rules`** | Everything after | No client may create a `location_sessions` document on a conversation carrying `superseded_by`. This is the only one an old browser bundle cannot argue with, and it holds for as long as the thread exists. |

The rule is on **`create` only, never `update`**. A Guest must always be able to
*stop* sharing, on any thread, forever — gating `update` would strand the very
sessions this is meant to protect. It costs nothing before a thread is folded,
because `superseded_by` does not exist until then.

**If the race cannot be closed, the run aborts.** It does not mark the thread,
does not copy over the top of a live session, and does not guess. Copies already
made are kept — they are idempotent and correct — and the sources left unmarked
are retried on the next attempt. The report says which:

```
[migration] guest-uid-7: blocked-live-location — planned 11, copied 11, attachments 1
[migration]   waiting on a live-location session on booking-bk_5 (seen in firestore)
[migration]   nothing further was retired and no session was touched.
```

**If the Realtime Database cannot be reached, the run refuses to start.** Half a
picture is not a picture — the Firestore side being empty is not evidence that
no position is being shared, and a job that cannot see must not claim the coast
is clear. The check itself is the safety property, so it fails loudly.

```bash
# Check once and abort if anything is live (the default).
node lib/src/scripts/migrateGuestHistory.js --all --apply --confirm <projectId>

# Wait up to 70 minutes for sessions to end on their own, checking every 30s.
node lib/src/scripts/migrateGuestHistory.js --all --apply --confirm <projectId> --wait=70
```

With `--all`, a Guest with a live session is **skipped, not failed** — the
others go ahead, and the report names who to come back to:

```
[migration] guest-uid-7: blocked-live-location — planned 11, copied 0, attachments 0
[migration]   waiting on a live-location session on booking-bk_4 (seen in firestore + rtdb, ends 2026-11-05T14:22:31.000Z)
[migration]   nothing was copied and no session was touched. Run again when it has ended.
```

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

0. **Checks live location**, waits if asked, and rechecks immediately before
   the first write. See [§ 2b](#2b-live-location-the-gate-that-decides-when).
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
| It aborted on live location | run it again when the session has ended | nothing was retired and no session was touched |
| It aborted *mid-run* on live location | run it again when the session has ended | the copies are kept (idempotent) and the threads already retired say so in `superseded`; the rest are finished on the retry |
| A source thread received a new message after being merged | `--resume` | the plan is recomputed; only the new message is copied |
| An attachment object is missing | the run fails | fix Storage, re-run; the message metadata is untouched |

A failed run leaves the lock **held**, deliberately: a half-finished job must not
look finished. After `DEFAULT_LEASE_MS` (15 min) the lease expires and the next
run takes over on its own. `--resume` takes it over immediately.

## 5. Verify

```bash
node lib/src/scripts/migrateGuestHistory.js --verify --uid=<uid>
node lib/src/scripts/migrateGuestHistory.js --verify --all
```

Read-only and re-runnable, at any time after a run. It answers one question:
**do the paths the Guest and the Admin both use actually work now?** It is also
run automatically at the end of every applied migration, and a failure there
makes the CLI exit non-zero — the copies happened, but the post-condition did
not hold, which needs a human.

It proves:

- `conversations/guest-<uid>` exists and is owned by this Guest;
- every message in it is renderable by both apps — a sender, a role the timeline
  understands, a timestamp, and text inside the 1,000-character limit;
- every attachment sits under `messageAttachments/guest-<uid>/`, so neither app
  opens a broken image;
- every retired thread carries `superseded_by`, so a reader landing on one is
  told where the history went;
- **no live session is left on a retired thread.**

It cannot prove that the security rules answer yes for a real Guest token and a
real Admin token — that needs signed-in sessions, and `npm run test:emulator` is
where it is checked. The report prints the exact paths so you can confirm
yourself rather than trust a boolean:

```
[migration] verify guest-uid-7: OK — 11 message(s), 1 attachment(s), 5 superseded thread(s), 0 live session(s)
    conversations/guest-guest-uid-7
    conversations/guest-guest-uid-7/messages
    messageAttachments/guest-guest-uid-7/
    location_sessions/guest-guest-uid-7
    live_location/guest-guest-uid-7/{guestUid}
```

Then, by hand:

```bash
node lib/src/scripts/migrateGuestHistory.js --audit --uid=<uid>
```

- `sources` is empty, `alreadySuperseded` lists the old threads.
- `canonicalMessageCount` equals the sum of the source message counts before
  the run.
- The source threads still exist, still hold their messages, and carry
  `superseded_by`.

**Live location, by hand.** With a Guest who has just been consolidated: start
a share from the website, watch it appear in the Admin's panel, stop it, and
start again. Both ends now resolve `guest-<uid>`, which is the point — the old
`booking-<id>` stream would have had nowhere to be read from.

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
| `functions/test/guest-history-migration.test.ts` | `npm --prefix functions test` | audit writes nothing; dry-run writes nothing; copies keep sender/role/text/timestamp/booking; nothing is deleted; a retry duplicates nothing; a crash resumes; a second worker is locked out; a message that cannot be reproduced stops the run; copies never notify; **a live session blocks and writes nothing; a session on the account thread is reported not blocking; an expired session no longer blocks; waiting lets one end and the run then goes ahead; one that outlasts the wait aborts the Guest; one that starts mid-run is caught by the recheck and the lease goes back; one that starts during the copies stops every thread being retired; one that lands between the pre-annotate read and the retirement is caught by the atomic guard, which retires the four before it and not the one with the session; a session the Guest has ended is not a block; an unreachable RTDB refuses to run; verification catches a stray attachment and a session on a retired thread** |
| `test/rules/firestore-rules.test.ts` | `npm run test:rules` | **no client, including the Admin, can open a live-location session on a thread the migration has folded; the Guest can still stop one; threads that have not been folded behave exactly as before** |
| `test/web/guest-conversation-identity.test.ts` | `npm test` | the id formula, its stability, classification, and what counts as usable booking context |
| `test/web/chat-messaging.test.ts` | `npm test` | one conversation per account, booking context on messages, superseded threads still readable |
| `test/rules/firestore-rules.test.ts` | `npm run test:rules` | no client creates a non-account conversation id; message booking context is validated; clients cannot stamp migration provenance |

**Not run here:** `flutter test` and `flutter analyze` (no Flutter/Dart SDK in
this environment), and the emulator suite (no Java runtime). The migration is
exercised against in-memory doubles of the Firestore, Storage and lease ports;
`functions/src/guestHistoryAdapter.ts` is the only file that touches the real
SDK, and the emulator is where its behaviour should be confirmed before a
production run.
