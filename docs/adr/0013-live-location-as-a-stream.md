# Live location is a stream, not a record

**Status**: accepted, 2026-09-29. **Supersedes** ADR-0009 (`no live location tracking`) for the *shape and the transport* of the feature — and reverses its decision that the system does not collect, store, transmit or display a Guest's location. What ADR-0009 got right is kept and is the reason this one is written the way it is: a position written to Firestore is a position stored forever.

**Amended, 2026-09-30.** The decision stands; one of the three mechanisms that carried it did not exist. See [How a position is actually made to disappear](#how-a-position-is-actually-made-to-disappear).

**Amended, 2026-09-30 (second).** The rules were changed and the suite was made decidable. The rules gain a denylist for movement-log fields, which is the most the rule language can express — see [What the rules cannot say about "a position and nothing else"](#what-the-rules-cannot-say-about-a-position-and-nothing-else) — and `test/emulator/realtime-rules.emulator.test.ts` no longer accepts *any* rejection as a refusal. That second change is the one that matters: `@firebase/rules-unit-testing`'s `assertFails` is satisfied by a client-side validation error just as happily as by a rules decision, and a `.`-bearing child name is one of those. The `.ttl` bug above threw on the very first case and the suite around it was capable of passing anyway.

## What changed, and what did not

ADR-0009 withdrew the module for three reasons. Two of them are answered by how this feature is built; the third is answered by consent.

| ADR-0009's reason | Today |
| --- | --- |
| *"A live position feed needs a consent record, a retention rule, an expiry, an encryption-at-rest claim and a purge path to be lawful."* | There is now a consent record (`location_sessions`), an expiry the backend enforces at both ends, and a read that the rules refuse the moment the window closes — so there is nothing to purge for anyone but the owner looking in the console. The feed is opt-in per share, from inside a conversation, for 15/30/60 minutes. |
| *"The operation never depended on it."* | Still true. The Access log remains the answer to *is the Guest here*. This is a convenience for the Admin watching a thread, not a control surface. |
| *"Dead code is a liability."* | There is no dead code. The stream, the session, the rules and the tests all run. |

**Unchanged:** the Access log (`access_logs`) is still door events only. The retired `tracking_sessions` collection stays closed to every reader and writer (Admin delete only) — a leftover from before the withdrawal can still be cleared, and a stale build cannot write a position there by accident. Nothing about Bookings, payments, the lifecycle, rates, stays or the smart lock is touched.

## The rule the whole design turns on

> **A position is never a record.**

Two stores, and a line between them:

```
conversations/{convoId}                     Firestore   the conversation
conversations/{convoId}/messages/{id}       Firestore   the messages (≤1,000 chars, immutable)
location_sessions/{convoId}                 Firestore   the CONSENT: who, since when, until when,
                                                        and a 32-character secret. No coordinate.
live_location/{convoId}/{guestUid}          RTDB        the POSITION: overwritten every few seconds,
                                                        deleted server-side at the expiry.
```

`firestore.rules` refuses a `location_sessions` document that carries `lat`, `lng`, `latitude`, `longitude`, `position`, `fix`, `points` or `trail` — there is no shape of position the backend will store. The position goes to a Realtime Database leaf node that is overwritten in place, and `database.rules.json` refuses to *read* it once `expires_at_ms` is in the past.

## How a position is actually made to disappear

This section replaces the original claim that "the server deletes it whether or not the tab closes, the phone dies, or the Guest never presses Stop". **That was not true.** Realtime Database has no per-node TTL, on the free plan or any other; Firestore TTL policies require billing. What happened instead is worse than a leak and better than a leak:

`publishFix` wrote a `'.ttl'` field beside the nine real ones, on the belief that the server would honour it. It did not — and it never even reached the server, because a key containing `.` is rejected by the Firebase client SDK *before the write leaves the browser* (`validateFirebaseData`). Every fix threw `contains an invalid key (.ttl)`. **The feature had never once published a position.** The Realtime Database instance was never created, so the control was disabled and nobody saw it fail; the emulator suite that would have caught it on its first case had never been run, because the Database emulator had never been downloaded.

Three mechanisms carry the property instead, in the order they are trusted:

1. **The rules — the actual guarantee.** The Admin's `.read` sits on the leaf node and is refused the moment `expires_at_ms` is in the past. A `.read` in Realtime Database cascades downward and a deeper rule cannot revoke a shallower one, so this only works because the grant was moved off the conversation subtree. An expired position is unreadable by the server itself: no sweeper, no card, no dependency.
2. **`onDisconnect().remove()`**, registered when the session opens. The server deletes the node when the connection drops — tab closed, battery dead, network lost — which is the case the Guest's own device cannot be trusted to handle.
3. **`stopSharing()`**, an explicit client remove, for the ordinary path.

**The honest residual.** An abandoned node's *bytes* can still exist, and the Firebase console — which bypasses rules — will show the coordinate to the owner. The property that matters holds absolutely: the Admin cannot read a position after consent ends, and no client can. But this is a weaker promise than the original text claimed, and it is weaker because the project runs without a card.

`test/web/live-location.test.ts` holds the payload to nine fields and forbids any server-expiry key; `test/web/realtime-database-rules.test.ts` and `test/emulator/realtime-rules.emulator.test.ts` hold the rules.

### What the rules cannot say about "a position and nothing else"

`.validate` asserts `hasChildren([...nine])`, and `hasChildren` is a **floor, not a ceiling**: Firebase's own data-validation guide documents it as "has these children", with `!newData.hasChild(x)` as the way to refuse something. The Realtime Database rule language has no `hasOnly` and no child count — `newData.numChildren()` does not exist, and asking for it makes the emulator refuse to compile the file.

So the node's shape is held from below and by denylist, not from above. `.validate` refuses `trail`, `points`, `history`, `track` and `path` by name — the accumulation shapes, and the Realtime Database counterpart to Firestore's `location_sessions` rule refusing eight coordinate-ish keys — and the nine required fields are checked individually. **That is a denylist, and it is not airtight.** A Guest who owns the path (the only writer `.write` authorises) could park data in their own node under a name nobody thought to list. What bounds it is everything else: only that Guest can write it, only the Admin can read it, and the read dies with `expires_at_ms` whether or not the node does. Recorded here rather than asserted as a guarantee the language cannot make.

## Why the Realtime Database and not Firestore

The audit found the project already on Firebase Auth, Firestore, Storage and (for payment proofs) Supabase Storage. No realtime transport existed beyond Firestore's `onSnapshot` listeners. Three properties decided it:

1. **It is overwritten, not appended.** A fix replaces the last one at the same path, so there is no trail to grow and nothing to query later. *(The original wording here was "the data is deleted for us", resting on a server-side TTL that does not exist. See above.)*
2. **It is charged differently — and this is now the load-bearing argument.** Firestore charges a write per fix. Watching a stationary Guest at a 3-second cadence is 20 writes a minute, 28,800 a day, for one field that keeps changing. Firestore's free tier allows 20,000 writes a day, and that budget is **shared** with bookings, messages, activity entries and access logs: at ~600 fix-writes per 30-minute walking session, a position feed would exhaust it at roughly **16.7 guest-hours of continuous movement in a single day**, and the thing that would break is new booking requests. Realtime Database on the free plan has no daily operation quota at all (1,000 writes/second, 1 GB stored, 10 GB/month downloaded, 100 simultaneous connections), so this traffic is four orders of magnitude inside its limits and can never spend anyone else's budget.
3. **It is the same vendor and the same project.** The installed `firebase` npm package already ships `firebase/database` — **no new JavaScript dependency at all**. The Flutter app adds one first-party plugin, `firebase_database`, beside `cloud_firestore` and `firebase_auth`. No second account, no second console, no second billing relationship.

Supabase Realtime was the runner-up and is already a dependency of the website — but every channel there is reachable with the `anon` key, and turning that into an authenticated channel needs an Edge Function that exchanges a Firebase ID token for a Supabase session. That is new infrastructure and a new trust boundary, for a stream that Firebase already carries. Not worth it. (Re-confirmed under a free-tier constraint: a Supabase free project is also **paused after 7 days of inactivity**, and its broadcast self-replay retention is 72 hours, which would turn an ephemeral stream into a position log.)

## The rules the stream actually depends on

`database.rules.json`:

- the root is closed, and anything not named below is denied
- `live_location/{conversationId}/{guestUid}`: a signed-in Guest may write only into their own uid's path, and the node must carry exactly nine fields, a position inside the Philippines, and a window that is open and no more than 90 seconds ahead
- the same node grants the **Admin's** read, and that read is refused once `expires_at_ms` has passed — this is the expiry guarantee
- there is no read grant on the conversation subtree, so there is no way to enumerate who is sharing
- `live_location_admins/{uid}` is how a Profile-promoted Admin is recognised, written only by an allowlisted address

`firestore.rules` on `location_sessions/{sessionId}`: only the conversation's own Guest may create it, `duration_minutes` is capped at 1..60, `expires_at` may not be more than an hour past `request.time`, `guest_uid` / `conversation_id` / `stream_secret` / `duration_minutes` are immutable on update, and any coordinate-shaped field is refused.

## The secret: what binds a position to a consent

`live_location_admins` and `.validate` cannot read Firestore, so they cannot check conversation membership. The design does not pretend otherwise — it moves the check to where it can be enforced:

- Firestore decides **who may start a session**: `isConversationMember(sessionId)` on a document whose id *is* the conversation id. A Guest who does not own the conversation cannot create the document at all.
- The document carries a 32-character `stream_secret`, generated by the Guest's device, immutable for the life of the document (the update rule pins it, along with `guest_uid`, `conversation_id` and `duration_minutes`).
- The Guest's stream node carries the same secret. Realtime Database rules validate the node's *shape*, its own uid and its own conversation id, and refuse a window past the clock — but they cannot know the secret is the right one.
- So the **Admin app** is the place the two are joined: `LiveFix.fromData` renders a node only when guest, conversation and secret all match the session Firestore authorised, and the session is still live.

A node nobody can correlate to a consent is inert. A Guest cannot attach a stream to somebody else's conversation, because writing the secret requires the Firestore rule that knows the conversation is theirs.

## Authorization, in one table

| Actor | Writes a session | Reads a session | Writes a position | Reads a position |
| --- | --- | --- | --- | --- |
| The sharing Guest | ✅ in their own conversation | ✅ their own | ✅ only `live_location/{theirConvo}/{theirUid}` | ❌ (they know where they are) |
| Another Guest | ❌ | ❌ | ❌ only their own path, which nobody reads | ❌ |
| The Admin | ❌ (the Guest owns the session) | ✅ any conversation | ❌ | ✅ `live_location/*`, and only nodes that match a live session |
| Signed out | ❌ | ❌ | ❌ | ❌ |

A Profile-promoted Admin is recognised by the Realtime Database through `live_location_admins/{uid}`, which only an allowlisted address may write (`database.rules.json`). The allowlist is the anchor precisely because it is the one role that needs no document to exist and so cannot be locked out of itself — the same reason `firestore.rules` bootstraps it.

## Expiry, enforced four times

1. `firestore.rules` caps `duration_minutes` at 1..60 and refuses an `expires_at` more than an hour past `request.time`.
2. `database.rules.json` refuses a write whose `expires_at_ms` is not in the future and not more than 90 seconds ahead.
3. `database.rules.json` refuses the Admin a *read* of a node whose `expires_at_ms` has passed. This is the one that survives a dead phone.
4. The Guest's client stops watching and ends the session on its own countdown, and the server removes the node when the connection drops (`onDisconnect`).

The Admin's reader compares `expires_at` against the clock as well, so an expired session is not drawable even in the window before anything else notices.

## What this costs, honestly

- One Firestore write when a share starts, one update when it stops. **Not one write per GPS fix** — that is the whole reason for the split.
- One RTDB write per published fix, which is a write no more than every three seconds and only after ten metres of movement.
- One RTDB listener on the Admin's side while a panel is open, and zero when it is closed.
- Zero long-term storage: the session document is a few hundred bytes, the position is gone within the hour.

## Consequences

- The Admin app gains one dependency (`firebase_database`) and one map surface built from OpenStreetMap raster tiles rather than `google_maps_flutter`, which would need a second API key and a per-app entitlement. Recorded in `docs/LIMITATIONS.md`.
- **Deployment requirement:** the project must have the Realtime Database created, `database.rules.json` deployed (`firebase deploy --only database`), and `VITE_FIREBASE_DATABASE_URL` set on the website. Without it the share control is disabled with a stated reason — the feature refuses rather than half-working.
- Booking lifecycle, payments, the Date hold and the Access log are untouched. A share is an act inside a conversation, not a Booking state.
