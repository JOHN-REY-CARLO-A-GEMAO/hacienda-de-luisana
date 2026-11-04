# Prompt to send another AI — live-location stream is empty

Copy everything between the lines.

---

## Context (read all of this first — the details matter)

I maintain a small vacation-rental site for a private hacienda in the Philippines
(PHP 0 budget, Firebase free tier, no credit card on the project). It has two
clients: a **web app** (React + TypeScript + Vite, deployed as a static build) and
a **Flutter mobile app** used by the owner/admin. Both talk to the same Firebase
project. The app is **English-only** copy; there is no Taglish in the UI by design.

I built a "share my live location" feature between a Guest and the Admin during an
active chat conversation. Its hard design requirements, all deliberate:

1. **No location history.** Nothing is appended, ever. A position overwrites the
   previous one at the same path and is deleted when sharing stops. An Admin must
   never be able to query where a Guest *was*.
2. **No new vendor.** Same Firebase project, same Auth, same console. Firebase is
   already the only backend.
3. **Free tier must not be at risk.** A Guest standing still, published at a
   3-second cadence, is ~20 writes/minute. Firestore bills per write and the
   project is on the free daily quota, shared with bookings and chat messages, so a
   position feed on Firestore would be able to stop the hacienda taking bookings.
   The **Realtime Database** was chosen for the position stream specifically because
   it has no daily operation quota on the free plan; Firestore carries only the
   session metadata (one write at start, one at stop).

### How it is wired

- `startSharing()` writes **one Firestore doc** (`location_sessions/{convoId}`):
  `guest_uid`, `conversation_id`, `stream_secret`, `expires_at_ms`, `started_at_ms`,
  `active`. It contains **no coordinate**. It then registers a server-side
  `onDisconnect().remove()` on the RTDB position path.
- `publishFix()` writes **one RTDB node** at
  `live_location/{convoId}/{guestUid}` with exactly: `lat`, `lng`, `accuracy_m`,
  `at_ms`, `seq`, `guest_uid`, `conversation_id`, `session_secret`,
  `expires_at_ms`.
- The source of positions is `navigator.geolocation.watchPosition(...)` in a React
  hook, with `{ enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }`.
  Published only when the fix moved far enough or enough time passed
  (`shouldPublishFix`). On a failed write it does **not** end the session: it
  clears the "last fix" and sets an "offline — not updating" flag so the next GPS
  tick retries.
- The Admin side has two readers: a Flutter panel inside the chat (a raster
  OpenStreetMap tile with the Guest's marker, plus coordinates, accuracy, age) and
  a web page at `/admin/live-location/:convoId`. Both subscribe to the Firestore
  session doc *and* to the RTDB node.
- Point B: the reader also computes straight-line distance and an 8-point compass
  bearing from the Guest to the hacienda's fixed pin, client-side, from a constant.
  Explicitly caveated as straight-line, never called a road distance, with an
  outbound OpenStreetMap directions link as the only way to a road distance. No
  routing API is ever called.

### The relevant deployed security rules

RTDB (`database.rules.json`, deployed and confirmed live):

- read on `live_location/{convoId}/{guestUid}`: signed in, AND
  `(!data.exists() || data.child('expires_at_ms').val() > now)`, AND the reader is
  either a hardcoded owner email or present in a `live_location_admins/{uid}` allowlist
  (that node is `".read": false`, owner-writable only).
- write on the same path: `auth.uid == $guestUid` only.
- validate: rejects any child named `trail`/`points`/`history`/`track`/`path`;
  requires all nine fields present and correctly typed; pins `guest_uid` to
  `auth.uid` and `conversation_id` to the path segment; bounds lat to 4.0–21.5 and
  lng to 116.0–126.5 (the Philippines); requires
  `expires_at_ms > now && expires_at_ms <= now + 3600000`; and contains a
  deliberate **"no extend"** clause:
  `!data.child('expires_at_ms').exists() || newData.child('expires_at_ms').val() <= data.child('expires_at_ms').val()`
  — a Guest may not push the window later than the window already stored.

Firestore has `clock_probes/{probeId}` (create/read/delete own, no update) used by a
`/status` page that probes each backend and reports what it actually found. The
Firestore session read works.

### What actually happens

Consent and all of this worked end to end **except the position**. Testing on a
Samsung Android phone in Chrome, as the Admin:

- the chat header shows **"Live location active, 13:58 remaining…"** with a ticking
  countdown — so the Firestore session doc is being read, live, by the Admin;
- a "Hide Map" toggle works;
- the panel body sits on **"Waiting for the Guest's first position…"** and never
  advances.

Reading the code, that string is the "consent is live, node is absent, waiting for
the first fix" state. So: **the RTDB position node is empty.** Firestore is fine.

### What I have already found and fixed

Two bugs were found by reading, both now fixed and deployed:

1. `onDisconnect().remove()` only *schedules* a removal; it writes nothing. If a fix
   lands before the server executes the pending removal, the removal fires and
   deletes it — every fix, forever. The position could never appear.
2. The "no extend" rule clamps `expires_at_ms` to the value already stored, so a
   **restart** (a new, later `expires_at_ms`) could never be written at all: the
   restarted stream was permanently un-writable while the old, later-expiring node
   was still present or still remembered by the server. Fixed by making a restart
   explicitly `remove()` the node first and only then arm the disconnect cleanup
   (order is deliberate and is the fix).

Both are deployed. The symptom above persists, so there is at least one more cause,
or one of these fixes is not actually running.

### Live suspects, unranked

- **A stale build.** The static site is deployed by CI on push to a `main` branch;
  there is also a `vercel.json`. If the origin the Guest actually loaded was not
  rebuilt, the running bundle predates the fixes — including the ordering fix.
- Geolocation never produced a fix: permission denied at the OS/browser level, GPS
  off, or an **insecure origin** (no HTTPS / not a secure context), in which case
  `watchPosition` can fail or never call back.
- The write was produced and refused by the RTDB rules (wrong `auth.uid` vs path,
  a field missing/extra, a `conversation_id` that does not match the path segment,
  the device clock making `expires_at_ms` look out of window, or the no-extend
  clause).
- **Path mismatch between the two clients.** The Flutter reader builds
  `live_location/{conversationId}/{guestUid ?? session.guestUid}` from `convId` and
  `widget.guestUid`; the web writer builds
  `live_location/{session.conversation_id}/{session.guest_uid}`. If these disagree
  (e.g. `booking-<id>` vs `<id>`, or an empty guest uid falling back oddly) the Admin
  subscribes to a path nobody writes to — and the panel **cannot distinguish
  "wrong path" from "nothing written yet"**, which is exactly the infinite spinner.

Constraints on any advice: no paid services, no new vendor, no new npm/Flutter
dependency unless it is genuinely free and small, no location history, and do not
weaken the "no extend" or the "no history" rules.

## What I want from you

1. **Ranked hypotheses** for how a live Firestore session doc and a working Admin
   reader can coexist with a permanently empty RTDB node — ordered by likelihood,
   each with the specific mechanism that would produce *this exact* signature.
   Include causes I have not listed if you see any.
2. **The cheapest discriminating test for each**, ideally something the user can
   run in a phone browser with no code change — I want a decision tree that
   separates "stale build" from "geolocation never fired" from "write refused" from
   "wrong path", not a list of things to try.
3. **Is the rules design itself unsound?** In particular: (a) does the "no extend"
   clause interact badly with `onDisconnect` in any way I have not fixed; (b) can a
   *restart* still deadlock if the node was deleted by the server between the
   `remove()` and the re-arm; (c) is the read rule's
   `!data.exists() || expires_at_ms > now` a sane way to make an expired node
   unreadable, or does it create a state where an Admin silently sees "nothing"
   when the truth is "expired"?
4. **Should the diagnostics be built into the product?** I am considering making the
   Flutter panel print the exact path it is listening on, and its last error, so
   "wrong path" is visible instead of an infinite spinner. Tell me the smallest
   version of that which would have caught this, and whether there is a better place
   for it (e.g. an `/status` probe that round-trips a throwaway path).
5. **Anything about the design that you think is wrong outright** — including the
   choice of RTDB over Firestore, the 3-second cadence, the accuracy/`at_property`
   logic, or anything in the rules above that looks like it will bite at scale.

Be concrete and be blunt about what you think is wrong. Assume I can read code but
have limited ability to debug on a real device, so prioritise tests that need only
a phone browser and the Firebase console.
