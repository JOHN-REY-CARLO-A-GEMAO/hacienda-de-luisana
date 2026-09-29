# Messaging — data model, limits, pagination, retention, live location

The Guest ↔ Admin conversation, end to end: what is stored, what is refused, what is read, what is deleted, and where a Guest's live position goes.

Everything here is enforced in the backend. `src/` and `lib/` are the courtesy; `firestore.rules` and `database.rules.json` are the enforcement, because a browser or a phone can call either directly and nothing in the application stops it.

---

## 1. The data model

```
conversations/{convoId}                    Firestore
  guest_uid      string   the Guest who owns it
  category       string   an active inquiry category (src/lib/categories.ts)
  created_at     ts
  updated_at     ts       bumped on every message
  last_message   string   ≤140 chars, the Admin inbox preview
  unread_admin   int      0 | 1
  unread_guest   int      0 | 1
  messages_expires_at  ts  OPTIONAL — the retention stamp. Admin-writable only.

conversations/{convoId}/messages/{messageId}    Firestore, append-only
  sender_uid     string   the writer's own uid
  sender_role    'guest' | 'admin'   must match what the writer actually is
  text           string   1…1,000 characters
  created_at     ts
```

`location_sessions/{convoId}` (live location) and `live_location/{convoId}/{guestUid}` (Realtime Database) are in [§ 5](#5-live-location).

**Attachments: there are none.** Chat carries text only, on both sides. The website's only upload path is the Payment proof (Supabase Storage, `payment-proofs`, ADR-0011) and it is not reachable from the composer, so there is no size or type limit to set and no unlimited-upload surface to close. If attachments are ever added to the composer, they need a bucket with a size ceiling and a MIME allowlist *and* a rule that refuses a message document carrying a blob — not a client-side check.

---

## 2. Message limits

| Limit | Value | Enforced in |
| --- | --- | --- |
| Maximum message length | **1,000 characters** | `firestore.rules` (`text.size() <= 1000`) · `MESSAGE_MAX` in `src/lib/validation.ts` · `kMessageMax` in `lib/views/inbox/inbox_screen.dart` |
| Minimum message length | 1 character (after trimming) | same rule, and `validateMessage` |
| Messages per conversation | **no cap** | — deliberately. A cap makes a legitimate conversation unusable and saves nothing, because the cost is in what is *read*, not in what exists. |

1,000 is the figure because a thread is read a page at a time: every character is paid for on every page read. The number is written out in three places on purpose, and `test/web/chat-messaging.test.ts` asserts the website and the rules agree, so the two cannot drift.

The Admin is held to the same 1,000. The cap is about storage, not about role.

**What is not enforced here:** rate limiting. `LIMITS.chat` (`src/lib/rateLimit.ts`) is a client-side cooldown, and Firestore rules cannot count requests. See `docs/LIMITATIONS.md` § Rate limiting — unchanged by this work, and not claimed otherwise here.

---

## 3. Pagination

**Initial load: the newest 40 messages. Older pages: 30 at a time, on demand. Never the whole conversation.**

| | Website | Admin app |
| --- | --- | --- |
| First page | `subscribeMessages` → `limit(41)` | `orderBy('created_at', desc).limit(41)` |
| Older page | `loadMessagePage({ before: cursor })` → `startAfter(timestamp)`, `limit(31)` | `orderBy(...).limit(31).startAfterDocument(oldest)` |
| Capped at | 50 messages a page | 30 a page |
| Live updates | **one** bounded listener on the newest page | **one** bounded listener on the newest page |

The rules that keep this honest:

- **One listener, and it is bounded.** It watches the newest page only — that is what makes a reply appear without a refresh — and it is torn down with the screen. Older pages are one-shot reads: a page that has been read is finished with, so it holds no listener. The listener asks for one document more than the page holds, which is how it tells the UI an older page exists without a second read.
- **A cursor, not an offset.** `orderBy('created_at', desc)` plus the oldest loaded timestamp. A new message arriving shifts every offset; a cursor does not.
- **Merging by id.** The listener re-delivers the newest page on every change, and a page overlaps the previous one at its boundary, so the UI merges by id (`mergeMessages`). That is what stops a message appearing twice.
- **Once paged, the cursor is the reader's.** After the first "Load earlier", the live listener stops resetting the cursor — otherwise every new message would drag it back to the newest page and "load earlier" would re-fetch messages already on screen.

`test/web/chat-messaging.test.ts` walks a 500-message thread ten pages deep and asserts each message is seen exactly once, in order, with no full read. `test/web/messages-page.test.tsx` asserts the screen shows 40 of 140 and fetches 30 more on request.

**Demo mode runs the same pagination.** With no Firebase project, `loadMessagePage` and `subscribeMessages` read `hdl:chat` with the same cursor semantics, so the behaviour is covered by `npm test` and not only in a deployment.

---

## 4. Retention

A Booking is a record; a conversation is chat. They live in two collections, so the first can be kept for years and the second is disposable.

```
Active booking  →  messages kept, no expiry stamped
Booking done    →  messages_expires_at = closed_at + 90 days
After that      →  a scheduled backend job sweeps the thread
```

- The policy is `src/lib/chatRetention.ts` and its Dart copy `lib/services/chat_retention.dart`; the same 90 days and the same four terminal statuses (`Completed`, `Cancelled`, `Rejected`, `Expired`) are in both, unit-tested in both.
- **Nothing is stamped while a Booking is live.** `retentionPatch()` returns `null` for a non-terminal status, so a job that ran early cannot schedule away a thread that is still being written.
- **Only the Admin can write the stamp.** `firestore.rules` holds a Guest's update to `updated_at`, `last_message`, `unread_admin` and `unread_guest` and nothing else, and refuses a conversation *created* with `messages_expires_at` already on it. A Guest can neither shorten the window on a thread the hacienda keeps nor put an expiry on a live one.
- The Admin app shows the stamp in the inbox ("kept 62 more days") and can apply it with `stampRetention`, which is a real, working path — not a placeholder for a missing backend.

### The deletion mechanism (required, not implemented here)

**Firestore Security Rules cannot perform scheduled deletion.** They can only refuse a write. The repository has no `functions/` directory and no scheduled job, so the mechanism is specified here and **must be deployed** for the policy to have teeth:

1. **Enable a Firestore TTL policy** on the `conversations` collection, field `messages_expires_at`. The conversation document is then deleted by Firestore itself, within about 24 hours of the stamp. Firestore's TTL deletes *documents*, not subcollections, so step 2 covers the messages.
2. **A Cloud Function on conversation deletion** that removes the `messages` subcollection in batches of 500 (Firestore caps a batch at 500 operations; delete, then re-query until empty). Firestore deletes are billed and do not cascade.

```js
// functions/index.js — firebase-functions v2, Node 20
const { onDocumentDeleted } = require('firebase-functions/v2/firestore')
const { getFirestore } = require('firebase-admin/firestore')

exports.sweepMessages = onDocumentDeleted('conversations/{convoId}', async (event) => {
  const db = getFirestore()
  const convoId = event.params.convoId
  for (;;) {
    const snap = await db.collection('conversations').doc(convoId).collection('messages').limit(450).get()
    if (snap.empty) break
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
})
```

Deploy with `firebase deploy --only functions` after `firebase init functions`. Until step 2 exists, the messages survive their conversation — the stamp is then a schedule with nobody on it, and the inbox's "clearing soon" label is the truth.

**What retention never touches:** `bookings`, `access_logs`, `activity`, `payment_references`, and any Firestore TTL on those collections. Chat is disposable; a Booking, a money movement and a door event are not.

---

## 5. Live location

> **A position is never a record.**

Read [ADR-0013](adr/0013-live-location-as-a-stream.md) for why this is a stream and not a Firestore document. The shape:

```
location_sessions/{convoId}          Firestore — the CONSENT, no coordinate
  guest_uid, conversation_id, active, started_at, expires_at,
  duration_minutes (1…60), stream_secret (32 chars)

live_location/{convoId}/{guestUid}   Realtime Database — the POSITION
  lat, lng, accuracy_m, at_ms, seq, guest_uid, conversation_id,
  session_secret, expires_at_ms, .ttl
```

### What is persisted and what is ephemeral

| | Store | Lifetime | Billed as |
| --- | --- | --- | --- |
| The consent (who, until when, the secret) | Firestore | until the Admin clears it | one write on start, one on stop |
| The position | Realtime Database | until the server's `.ttl` — at most 60 minutes | storage + download, not a write per fix |
| A history of positions | **nowhere** | — | — |

There is no `points`, no `trail`, no append anywhere in the code.

### Update policy

`shouldPublishFix` (`src/lib/liveLocationPolicy.ts`) sends a fix when **both** hold:

- at least `MIN_PUBLISH_INTERVAL_MS` = **3,000 ms** since the last published fix, **and**
- the Guest has moved at least `MIN_PUBLISH_DISTANCE_M` = **10 m** (haversine) from it.

The first fix of a session always goes, otherwise a stationary Guest would never be seen. Ten metres is roughly the outdoor GPS error, so a Guest walking to the gate is shown at the gate — thirty seconds late, not never.

A device reporting a position every second therefore produces at most ~20 writes a minute, and usually far fewer.

### The lifecycle, and every way it ends

| | What happens |
| --- | --- |
| Guest chooses 15 / 30 / 60 min | `startSharing` writes the session; the secret is generated on-device |
| Permission denied | `watchPosition` errors with `PERMISSION_DENIED` → the watch is closed, the session is ended, and the Guest is told *"Location permission was refused, so nothing is being shared."* |
| GPS unavailable / timeout | Same, with the GPS wording. No fix is not a fix at the last known position. |
| The tab is backgrounded | `visibilitychange` closes the watch; reopening it resumes. Browsers throttle `watchPosition` and may suspend the permission. |
| The tab is closed | `pagehide` ends the session. The node's `.ttl` is what actually guarantees it, device or not. |
| Network drops | The state says *"You are offline, so the position is not updating."* The session is not silently extended. |
| The countdown reaches zero | The session ends itself and the Guest is told the time ran out. |
| The Guest presses **Stop Sharing** | Session marked ended, node removed, watch closed, timer cleared. |
| The device reports a position that is not a position | `shouldPublishFix` refuses it (non-numeric, or outside the world). |

**A share never reports success it did not have.** `unavailableReason()` returns `signed-out`, `no-firebase` or `no-database` before the Guest presses anything, and the control is disabled with the reason in its tooltip. A Guest who believes the Admin can see them when the Admin cannot is the one failure this feature cannot have.

### Who may see a position

| Actor | Reads the session | Reads the position |
| --- | --- | --- |
| The sharing Guest | their own | ❌ (they know where they are) |
| Another Guest | ❌ | ❌ — and cannot write into another Guest's path, or open a session in a conversation that is not theirs |
| The Admin | any conversation | ✅ `live_location/*`, and only a node that matches a live session |
| Signed out | ❌ | ❌ |

Two steps decide what the Admin may draw, and the second one is the important one:

1. **`database.rules.json`** validates the *shape* of a node: the nine required fields, the writer's own uid, the conversation in the path, a position inside the Philippines, and a window that is open and no more than 90 seconds ahead.
2. **`LiveFix.fromData`** (Dart) / **`checkFix`** (TypeScript) accept the node only when `guest_uid`, `conversation_id` and `session_secret` match the session Firestore authorised, and the session is still active and unexpired.

Realtime Database rules cannot read Firestore, so they cannot check conversation membership. The secret is the join: a node nobody can correlate to a consent is inert, and writing the secret needs the Firestore rule that knows the conversation is the Guest's own.

### Expiry, enforced four times over

1. `firestore.rules` caps `duration_minutes` at 1…60 and refuses an `expires_at` more than an hour past `request.time`.
2. `database.rules.json` refuses a write outside `(now, now + 90s]`.
3. The Guest's client stops on its own countdown.
4. The server deletes the node at the `.ttl` it was written with.

The Admin's reader compares `expires_at` against the clock as well, so an expired session is not drawable even before the sweep lands. An expired or stopped session that somehow still has a node is refused with a reason, not drawn.

### Watching is opt-in on the Admin's side too

The map panel is closed by default. Opening it is one tap; closing it releases the RTDB subscription. A notification does not drag the Admin into a map, and there is no history to go back to.

---

## 6. What is persisted vs ephemeral — the whole picture

| Thing | Store | Durable? |
| --- | --- | --- |
| Booking, its money, its Activity log | Firestore `bookings` | yes, forever |
| Door events | Firestore `access_logs` | yes, forever |
| Payment references | Firestore `payment_references` | yes (void-only once used) |
| Chat messages | Firestore `conversations/*/messages` | until the retention sweep |
| Retention stamp | Firestore `conversations.messages_expires_at` | until the sweep |
| Live-location consent | Firestore `location_sessions/{convoId}` | until the Admin or the Guest clears it |
| **Live position** | **Realtime Database** | **no — server TTL** |
| **Position history** | **nowhere** | **—** |
| Retired tracking sessions | Firestore `tracking_sessions` | closed to everyone; Admin delete only |

---

## 7. Testing performed

| Suite | Run by | Covers |
| --- | --- | --- |
| `test/web/chat-messaging.test.ts` | `npm test` | the 1,000 limit and the rules agreeing with it, empty messages, 40-message first page, a 500-message walk with no repeats or skips, the page cap, the bounded listener, merge-by-id, the whole retention policy, and the Admin-only stamp |
| `test/web/live-location.test.ts` | `npm test` | the three durations and the one-hour cap, the countdown, the publish cadence, distance, the distance maths, every `checkFix` refusal (wrong secret, wrong Guest, wrong conversation, expired, stopped, malformed, out of world, future-dated), the secret's shape, and that a build with no transport cannot share |
| `test/web/messages-page.test.tsx` | `npm test` | the composer's `maxLength` and counter, "Load earlier messages" on a 140-message thread, and the share control's disabled-and-explained state, active panel, offline wording, stop button and refusal message |
| `test/web/realtime-database-rules.test.ts` | `npm test` | reads `database.rules.json` and holds it to the claims: closed root, uid-bound write, the nine fields, the Philippine bounds, the window, the Admin read and the allowlist mirror, and that it is registered in `firebase.json` |
| `test/rules/firestore-rules.test.ts` | `npm run test:rules` | 1,000 vs 1,001 from both sides, the retention stamp's authorization, and the full `location_sessions` matrix: create, membership, impersonation, the one-hour cap, an already-expired window, a malformed secret, a smuggled coordinate in eight shapes, reads, the ending update, no reopening, and deletes |
| `test/rules/engine.test.ts` | `npm run test:rules` | the semantics this work added to the evaluator: `request.time`, `timestamp` as a type, timestamp ordering, `timestamp + int`, `timestamp - timestamp`, `keys().hasAny()` |
| `test/chat_limits_test.dart` | `flutter test` | the Dart copies: the retention policy, the 1,000 limit, and every `LiveFix.fromData` refusal |
| `test/emulator/rules.emulator.test.ts` | `npm run test:emulator` | the same chat and `location_sessions` cases against Google's own implementation |
| `test/emulator/realtime-rules.emulator.test.ts` | `npm run test:emulator` | the Realtime Database matrix against the Database emulator |

**Not run here:** `flutter test` and `flutter analyze` (no Flutter SDK in the authoring environment) and the whole emulator suite (no Java runtime, and the emulator JAR host is unreachable). `test/chat_limits_test.dart` and the two emulator files are written but unexecuted — see `docs/VERIFICATION.md`.

---

## 8. Infrastructure and deployment

1. **Create the Realtime Database** in Firebase console → Build → Realtime Database, and copy its URL (`https://<projectId>-default-rtdb.<region>.firebasedatabase.app`).
2. **Set `VITE_FIREBASE_DATABASE_URL`** on the website's host (Vercel / GitHub Actions / Firebase Hosting) and redeploy. Add it to `.env.example` for local `.env.local` work.
3. **Deploy the database rules**: `firebase deploy --only database`. Until this runs, `live_location` is unreadable and unwritable.
4. **Flutter**: `flutter pub get` picks up `firebase_database`. A `databaseURL` is not required in `google-services.json` for the plugin to build; the app degrades to "no transport" if the project has none.
5. **The Admin role mirror**: an allowlisted Admin opens the app once after step 3, which writes `live_location_admins/{uid}`. A Profile-promoted Admin becomes readable after that.
6. **Retention**: the Firestore TTL policy and the `sweepMessages` function in [§ 4](#the-deletion-mechanism-required-not-implemented-here).
