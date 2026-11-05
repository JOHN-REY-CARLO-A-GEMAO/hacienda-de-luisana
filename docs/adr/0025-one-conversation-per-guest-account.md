# One conversation per Guest account

**Status**: accepted, 2026-11-05. Retires booking-scoped and topic-scoped
threads (`booking-<bookingId>`, `inquiry-<uid>-<topic>`) as writable shapes, and
makes a Booking *context* a message carries rather than the identity of the
thread.

## The circumstance

Threads were filed per Booking. A Guest with five reservations therefore had
five conversations, plus a general one, and the correspondence about a single
stay was spread across whatever the Guest happened to open at the time:

- The Guest could not see what they had already asked about another stay.
- The Admin's inbox showed five rows for one person, none of them the whole
  story, and no way to tell which was current.
- A general question — "do you allow day tours?", asked before any Booking
  exists — had nowhere to live at all, because a thread was keyed by a Booking
  id that did not exist yet.

The per-Booking shape also made duplicates structural rather than accidental:
two tabs, two devices, or a retry could each open their own `booking-<id>`
document, and nothing in the data model said that was wrong.

## The decision

**1. A Conversation is identified by the Guest account: `guest-<uid>`.**
One per account. Not one per Booking, not one per topic. The id is derived, not
looked up, and both apps write the formula down independently
(`src/lib/conversationIdentity.ts`, `AppConstants.guestConversationId`).

**2. A Booking is context a message carries.**
`conversations/{guest-<uid>}/messages/{messageId}` may carry a `booking_id`
field naming the stay that message is about. It is optional: a message with no
booking is a general inquiry, which is a first-class case. Several bookings may
be discussed in one thread, and the Admin sees which is which per message.

**3. No client may create any other conversation id.**
`firestore.rules` allows exactly `convoId == 'guest-' + request.auth.uid`.
This is stronger than reserving the prefix: it removes the superseded shapes
from the writable surface, so the duplicate thread this refactor retires cannot
come back — not from a new Booking, not from a retry, not from a race.

**4. History is migrated, never deleted.**
`functions/src/guestConversationMigration.ts` copies the messages of the
superseded threads into the account conversation, preserving sender, role, text,
original timestamp, booking context and private attachments, then annotates each
source thread `superseded_by` and leaves it in place. Nothing is removed. The
runbook is `docs/MESSAGING-MIGRATION.md`.

**5. History does not notify.**
Every copy carries `migrated: true` and a `migration` provenance map. The
notification trigger refuses anything carrying it, so folding years of chat into
one thread does not send years of push notifications. A client cannot stamp
those fields: `firestore.rules` omits them from the message's allowed keys.

## Consequences

**What gets easier**

- One Guest, one thread: the Admin sees the whole correspondence, and the Guest
  sees it too.
- A general inquiry is just a message with no `booking_id`.
- The inbox has one row per person.

**What gets harder**

- Threads are no longer cheap to enumerate per Booking. Anything that wants
  "the conversation about this reservation" now wants a *query over messages*
  (`booking_id == …`), not a document lookup. Nothing in the product needs that
  today; a Firestore composite index on `(booking_id, created_at)` inside the
  messages subcollection is the answer if it ever does.
- The migration is a backend job with a lease. It is not something a client can
  do on open, and it must not be: two clients folding the same history at once
  is the failure the lease exists to prevent.

**What is deliberately unchanged**

- Booking and payment workflows. No Booking document, status transition, payment
  reference or Activity-log entry is touched by this change.
- Retention. `messages_expires_at` still belongs to the Admin, and is still
  stamped per conversation — the conversation is now the account's, which is
  what makes a single 90-day window coherent across all of a Guest's stays.
- Live location. `location_sessions/{conversationId}` and
  `live_location/{conversationId}/{guestUid}` key off the conversation id, which
  is now always `guest-<uid>`. That is a real cutover cost, and the migration
  is **gated on it**: a run refuses to fold a Guest's threads while a session is
  live on any of them, waits for sessions to end on their own, rechecks both
  databases immediately before its first write, and aborts — copying nothing and
  touching no session — if one is still running. It does not treat the time of
  day as evidence that nobody is sharing.

  Closing that gate took three mechanisms, because no one of them is sufficient
  alone. The copies take time, so a Guest can begin sharing after every check
  has passed; the run therefore rechecks before retiring anything, retires each
  thread inside a transaction that refuses if a session is live on it, and
  relies on `firestore.rules` thereafter — no client may create a
  `location_sessions` document on a conversation carrying `superseded_by`.
  That last one is the only mechanism an old browser bundle cannot argue with,
  and it is on `create` only: a Guest must always be able to stop sharing, and
  gating `update` would strand the sessions this exists to protect.

  A fourth closes the position side, which the Firestore rules cannot reach: the
  migration records each retired id in the Realtime Database, and
  `database.rules.json` refuses any position under an id carrying it. That guard
  sits in `.validate` rather than `.write`, for the same reason from the other
  side — a delete has no `newData`, so `stopSharing` and `onDisconnect` keep
  working on a retired thread.

  Complete prevention of a stranded position is not technically possible without
  a cross-database transaction, which neither product offers. A Realtime
  Database rule cannot read Firestore, so the mirror can be a moment stale; the
  residual is a node that cannot be refreshed, cannot be rendered without a
  matching session, and expires on the schedule its own session set. See
  `docs/MESSAGING-MIGRATION.md` § 2b.
- Pagination, the 1,000-character limit, and the 5 MiB private image rules.

## Contradictions, stated

ADR-0007 (two roles, two apps) is not contradicted; the Admin app and the
website simply resolve the same document by the same formula.

`docs/MESSAGING.md` § 1 previously recorded that "no existing messages or
attachments are migrated or combined into the new general conversation". That
sentence is superseded by this ADR: this is the migration it was waiting for.
