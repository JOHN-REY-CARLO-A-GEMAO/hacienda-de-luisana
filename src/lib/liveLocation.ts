// ----------------------------------------------------------------------------
// Live location — the cloud half.
//
// What this module does, and nothing else:
//
//   startSharing()  one Firestore write: the session's metadata, no coordinate,
//                    then arms the server-side disconnect cleanup
//   publishFix()    one Realtime Database write: the position, now
//   stopSharing()   the Firestore session is closed and the stream node removed
//
// What it deliberately does not do: keep a history. There is no `points`, no
// append, no trail — a position is overwritten by the next one and deleted when
// the Guest stops, when their connection drops, or when the window closes.
// Everything a position passes through is written once and lives at most as long
// as the Guest chose to share.
//
// Which store carries the stream, and why:
//
//   **Firebase Realtime Database**, not Firestore. The choice is made by three
//   properties the Admin's position feed needs and Firestore does not have:
//
//     1. *It is overwritten, not appended.* A fix replaces the last one at the
//        same path, so there is no trail to grow and nothing to query later.
//        (An earlier draft of this module leaned on a server-side TTL that
//        Realtime Database does not have on any plan — see the note below.)
//     2. *It is charged differently.* Firestore bills a write per fix. A Guest
//        standing still, watched at a 3-second cadence, is 20 writes a minute —
//        28,800 a day — for one field that changes, and that 20,000/day budget
//        is shared with bookings, messages and activity, so a position feed that
//        exhausted it would stop the hacienda taking reservations. Realtime
//        Database on the free plan has no daily operation quota at all.
//     3. *It needs no new vendor.* The same Firebase project, the same Auth
//        tokens, the same console, the same deployment. The web SDK already
//        ships `firebase/database` in the installed `firebase` package, so this
//        adds no npm dependency at all.
//
// How a position is actually made to disappear — the honest version
// ------------------------------------------------------------------
// Three mechanisms, and only the first is a guarantee:
//
//   1. **The rules.** The Admin's `.read` lives on the leaf node and is refused
//      the moment `expires_at_ms` is in the past, so an expired position is
//      unreadable by anybody, by the server, with no sweeper and no card.
//   2. **`onDisconnect().remove()`**, registered when the session opens. The
//      server deletes the node when the connection drops — tab closed, phone
//      killed, network lost — which is the case the client cannot handle.
//   3. **`stopSharing()`**, an explicit client remove, for the ordinary path.
//
// What is NOT true, and used to be claimed here: Realtime Database has no
// per-node TTL, on the free plan or any other. Firestore TTL policies require
// billing. An earlier revision of this file wrote a `'.ttl'` field on every
// fix, which was not merely ignored — a key containing `.` is rejected by the
// client SDK before the write leaves the browser, so every fix threw and the
// feature never worked. Nothing in this module sends a server-expiry key, and
// `test/web/live-location.test.ts` holds it to that.
//
// The split this leaves:
//   Firestore  `location_sessions/{conversationId}` — who, since when, until
//              when, and the secret that binds a stream to this consent.
//   RTDB       `live_location/{conversationId}/{guestUid}` — the position, now.
//   Admin app  reads the session (rules-checked), then the node, and renders it
//              only when `checkFix` accepts it against that session.
//
// See docs/adr/0013-live-location-as-a-stream.md.
// ----------------------------------------------------------------------------

import { deleteDoc, doc as fsDoc, getDoc, getDocFromServer, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, ensureRealtimeDatabase, hasRealtimeDatabaseConfig, isFirebaseConfigured } from './firebase'
import {
  MAX_SHARE_MINUTES,
  checkFix,
  clockSkewFrom,
  isExpired,
  newSessionSecret,
  resumableSession,
  shareWindow,
  type ClockSkew,
  type LocationFix,
  type LocationSession,
  type ShareDuration,
  type StartFailure,
} from './liveLocationPolicy'

/** Where the session's metadata lives. The document id IS the conversation id. */
export const LOCATION_SESSIONS_COLLECTION = 'location_sessions'

/**
 * Where a clock probe is written, one throwaway document per share, deleted as
 * soon as it has been read back.
 *
 * A probe needs the server to stamp something, and only a write gets a
 * `serverTimestamp()`. This is the narrowest write in the app: the Guest writes
 * it under their own uid with one field, reads it back, and removes it. Nothing
 * else is stored, and `firestore.rules` refuses any other shape.
 */
export const CLOCK_PROBES_COLLECTION = 'clock_probes'

/** Where the ephemeral position lives. */
export const LIVE_LOCATION_PATH = 'live_location'

export type StartResult =
  | { ok: true; session: LocationSession }
  | { ok: false; reason: StartFailure }

/** Why this build cannot share at all, before the Guest even presses the button. */
export function unavailableReason(uid: string | undefined): StartFailure | null {
  if (!uid) return 'signed-out'
  if (!isFirebaseConfigured) return 'no-firebase'
  if (!hasRealtimeDatabaseConfig()) return 'no-database'
  return null
}

/** Is the stream transport configured in this build? */
export function canShareLocation(uid: string | undefined): boolean {
  return unavailableReason(uid) === null
}

/**
 * The Guest's own consent, if it is still one they may carry on with.
 *
 * Read from the store rather than from memory, because the cases this exists
 * for have no memory: a reload, a tab restored from the back/forward cache, a
 * second tab opened on the same conversation. The rules already let the owning
 * Guest read `location_sessions/{convoId}` for this, and nothing else on the
 * website used to.
 *
 * Returns null for "nothing to resume", which is not an error: no document, a
 * document somebody else owns, a session the Guest already stopped, or a window
 * that has closed (`resumableSession` has the rules for that).
 */
export async function resumeSharing(input: { convoId: string; uid: string; nowMs: number }): Promise<LocationSession | null> {
  if (!db || input.convoId.startsWith('local:')) return null
  if (unavailableReason(input.uid)) return null
  try {
    const snapshot = await getDoc(fsDoc(db, LOCATION_SESSIONS_COLLECTION, input.convoId))
    if (!snapshot.exists()) return null
    const data = snapshot.data() as Record<string, unknown>
    const startedAt = timestampToMs(data.started_at)
    const expiresAt = timestampToMs(data.expires_at)
    const session = resumableSession(
      {
        conversation_id: data.conversation_id ?? input.convoId,
        guest_uid: data.guest_uid,
        active: data.active,
        started_at_ms: startedAt,
        expires_at_ms: expiresAt,
        duration_minutes: data.duration_minutes,
        stream_secret: data.stream_secret,
      },
      input.nowMs,
    )
    // A consent belonging to somebody else is not this Guest's to resume, even
    // if the rules would let the Admin read it.
    if (!session || session.guest_uid !== input.uid) return null
    return session
  } catch {
    // No connection, or no permission: there is nothing to resume, and the
    // control stays available to start a fresh share when that changes.
    return null
  }
}

/** A Firestore `Timestamp` as milliseconds, or null when it is not one. */
function timestampToMs(value: unknown): number | null {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/**
 * Ask the server what time it is, by stamping a document and reading the stamp
 * back.
 *
 * The round trip is what makes the answer usable: `getDocFromServer` bypasses
 * the local cache, so the `serverTimestamp()` this writes is read back from the
 * server rather than from a local guess, and `clockSkewFrom` brackets the offset
 * between the two clocks using the moment the write left and the moment the
 * stamp arrived.
 *
 * Deliberately best-effort in every direction. It writes one throwaway document
 * under the Guest's own uid (the rules' `clock_probes` block is what lets it),
 * it never throws, and a build or a network where it cannot work simply shares
 * on the device's clock with a wider guard band — which is what the feature did
 * before, and is a share that can still be refused, rather than no share at all.
 */
export async function estimateClockSkew(uid: string): Promise<ClockSkew | null> {
  if (!db || !uid) return null
  const requestedAtMs = Date.now()
  try {
    const reference = fsDoc(db, CLOCK_PROBES_COLLECTION, `${uid}-${requestedAtMs}`)
    await setDoc(reference, { uid, probed_at: serverTimestamp() })
    const snapshot = await getDocFromServer(reference)
    const receivedAtMs = Date.now()
    const stampMs = timestampToMs(snapshot.data()?.probed_at)
    // The probe has one caller and one purpose; it is not a record.
    void deleteDoc(reference).catch(() => {})
    if (stampMs === null) return null
    return clockSkewFrom({ requestedAtMs, receivedAtMs, stampMs })
  } catch {
    return null
  }
}

/**
 * Open a sharing session for a conversation.
 *
 * The write carries the metadata and nothing else: no coordinate goes near
 * Firestore, ever. `firestore.rules` re-checks every field of it, refuses a
 * window past an hour, and refuses a document that has smuggled a position in.
 *
 * The window is stated on the server's clock when the offset is known
 * (`estimateClockSkew`), because that is the clock `firestore.rules` and
 * `database.rules.json` both compare it with. Without that, a phone a second
 * fast could not start the share it asked for — see `shareWindow`.
 */
export async function startSharing(input: {
  convoId: string
  uid: string
  minutes: ShareDuration
  nowMs: number
  skew?: ClockSkew | null
}): Promise<StartResult> {
  const unavailable = unavailableReason(input.uid)
  if (unavailable) return { ok: false, reason: unavailable }
  if (!db || input.convoId.startsWith('local:')) return { ok: false, reason: 'no-firebase' }

  const minutes = Math.min(MAX_SHARE_MINUTES, Math.max(1, Math.floor(input.minutes)))
  const secret = newSessionSecret()
  if (!secret) return { ok: false, reason: 'refused' }
  const window = shareWindow({ nowMs: input.nowMs, minutes, skew: input.skew })

  const session: LocationSession = {
    id: input.convoId,
    conversation_id: input.convoId,
    guest_uid: input.uid,
    active: true,
    started_at_ms: input.nowMs,
    expires_at_ms: window.localMs,
    duration_minutes: minutes,
    stream_secret: secret,
  }

  try {
    const reference = fsDoc(db, LOCATION_SESSIONS_COLLECTION, input.convoId)
    // A stopped or expired consent is deliberately immutable: Firestore rules
    // refuse to reopen it with a different secret. `setDoc` at that same id is
    // therefore an UPDATE on every restart, not the CREATE the Guest just asked
    // for. Complete the approved two-step restart instead: remove only the old
    // consent owned by this Guest, then create a fresh one. Deleting a missing
    // document is not permitted by these rules, so the existence read matters.
    const previous = await getDoc(reference)
    if (previous.exists()) await deleteDoc(reference)
    await setDoc(reference, {
      guest_uid: session.guest_uid,
      conversation_id: session.conversation_id,
      active: true,
      started_at: serverTimestamp(),
      expires_at: new Date(window.serverMs),
      duration_minutes: minutes,
      stream_secret: secret,
    })
  } catch (error) {
    return { ok: false, reason: isPermissionError(error) ? 'refused' : 'unavailable' }
  }

  // The session is open, so clear any node the last share left behind, then arm
  // the server-side cleanup before any fix is sent.
  void resetStream(input.convoId, input.uid)
  return { ok: true, session }
}

/**
 * Make a conversation's stream empty, then arm the disconnect cleanup on it.
 *
 * Order matters, and it is the whole reason this is one function rather than two
 * calls. `armDisconnectCleanup` only *schedules* a removal; it writes nothing. So
 * a first fix that arrives before the server has executed the `onDisconnect`
 * triggers it immediately — the server sees a new node appear and deletes it, and
 * the next fix deletes again, forever. The position never lands.
 *
 * That was invisible while `database.rules.json` had never been deployed: the
 * write was refused anyway, so nothing could observe the ordering. Deploying the
 * rules turned the stream on and with it this failure, on *every restart*, because
 * a restart carries a new `expires_at_ms` and `database.rules.json` refuses a fix
 * that pushes the window past the one already stored — the Guest's own no-extend
 * rule. The fix could never be written, so it could never be the thing that
 * triggered the pending removal.
 *
 * So: remove first and wait, which clears the stale window and the stale
 * position together; only then arm. A `remove()` on a node that does not exist is
 * a no-op, so the ordinary first share pays nothing for this.
 *
 * Best-effort at every step, as before: the rules are what make an expired
 * position unreadable, and this only decides whether a live one can be written.
 */
export async function resetStream(convoId: string, uid: string): Promise<void> {
  try {
    const reference = await streamRef(convoId, uid)
    if (!reference) return
    const { remove } = await import('firebase/database')
    await remove(reference).catch(() => {})
  } catch {
    // No transport. `armDisconnectCleanup` will no-op for the same reason.
  }
  await armDisconnectCleanup(convoId, uid)
}

/** The path one Guest's position lives at, or null with no transport. */
async function streamRef(convoId: string, uid: string) {
  const realtime = await ensureRealtimeDatabase()
  if (!realtime) return null
  const { ref } = await import('firebase/database')
  return ref(realtime, `${LIVE_LOCATION_PATH}/${convoId}/${uid}`)
}

/**
 * Arm the server-side cleanup for this session's node, once, at the moment the
 * session opens.
 *
 * `onDisconnect().remove()` tells the server to delete the node if this client
 * goes away without the code ever running again — the tab closed, the phone
 * killed, the network dropped mid-walk. It is the one deletion the Guest's own
 * device cannot be trusted to perform.
 *
 * It is not the whole guarantee and does not pretend to be: the rules make an
 * expired position unreadable whatever happens to the bytes, and that is the
 * property the feature actually rests on. This just keeps an abandoned node from
 * sitting in the database waiting for the Admin's next visit.
 *
 * Best-effort, and never fatal: a session that cannot arm this is still a valid
 * session, and the rules already refuse to show anyone an expired position.
 */
export async function armDisconnectCleanup(convoId: string, uid: string): Promise<void> {
  try {
    const reference = await streamRef(convoId, uid)
    if (!reference) return
    const { onDisconnect, remove } = await import('firebase/database')
    await onDisconnect(reference).remove()
  } catch {
    // No transport, or the registration was refused. The expiry rule stands.
  }
}

/**
 * Close the session: the Firestore document is marked ended and the stream node
 * is removed.
 *
 * The removal is best-effort on purpose. If the device is offline when the
 * Guest presses Stop, the session document is still updated (Firestore queues
 * it) and the node is removed by the server when the connection drops — so a
 * Guest who stops sharing offline is not still being streamed. The rules refuse
 * the Admin a read past `expires_at_ms` either way, so the position is not
 * drawable even if the node is somehow still there.
 */
export async function stopSharing(input: { convoId: string; uid: string; nowMs: number }): Promise<void> {
  if (!db) return
  await updateDoc(fsDoc(db, LOCATION_SESSIONS_COLLECTION, input.convoId), {
    active: false,
    expires_at: new Date(input.nowMs),
  }).catch(() => {})
  const guestRef = await streamRef(input.convoId, input.uid)
  if (guestRef) {
    const { remove } = await import('firebase/database')
    await remove(guestRef).catch(() => {})
  }
}

/**
 * Publish one position.
 *
 * The write carries nine fields and no server-expiry key. There is no such thing
 * in Realtime Database: a key containing `.` is rejected by the client SDK
 * before the write leaves the browser, so the earlier `'.ttl'` field made every
 * fix throw. Expiry is enforced where it can actually be enforced — the rules
 * refuse a read past `expires_at_ms` — and the node itself is removed by
 * `onDisconnect`, by `stopSharing`, and by the next session overwriting it.
 * Publishing past the window is refused here as well as by the rules, because a
 * refused write that throws inside a geolocation callback is a crash, not a
 * security control.
 */
/*
 * The three answers, and why "it threw" is not one of them:
 *
 *   'sent'      the position is in the database
 *   'stopped'   the session is over — expired, or the node is unreachable —
 *               so there is nothing left to stream and the panel must say so
 *   'retry'     the write failed for a reason that may not be there in three
 *               seconds: a dropped connection, or a refusal that the next fix
 *               will not repeat
 *
 * The distinction is the fix for a share that ended itself over one bad write.
 * A rules rejection (a race with a re-started session, a device clock that had
 * not settled on the probe's answer) used to be read as "the hacienda ended
 * the session", which tore down a share that was working. Now only an actual
 * end — the Guest's window closing, or no transport at all — ends it; a refusal
 * is retried, and the panel keeps saying it is offline rather than that it
 * stopped.
 */
export type PublishOutcome = 'sent' | 'stopped' | 'retry'

export async function publishFix(
  session: LocationSession,
  fix: Pick<LocationFix, 'lat' | 'lng' | 'accuracy_m' | 'seq'>,
  nowMs: number,
): Promise<PublishOutcome> {
  if (isExpired(session.expires_at_ms, nowMs)) return 'stopped'
  const reference = await streamRef(session.conversation_id, session.guest_uid)
  if (!reference) return 'stopped'

  const payload = {
    lat: fix.lat,
    lng: fix.lng,
    accuracy_m: fix.accuracy_m,
    at_ms: nowMs,
    seq: fix.seq,
    guest_uid: session.guest_uid,
    conversation_id: session.conversation_id,
    session_secret: session.stream_secret,
    expires_at_ms: session.expires_at_ms,
  }
  const { set } = await import('firebase/database')
  try {
    await set(reference, payload)
    return 'sent'
  } catch (error) {
    // An expired node (the window closed between the check above and the
    // write) is the one refusal that really is an ending. Everything else —
    // permission, a dropped socket, the SDK's own offline queue — is worth
    // another fix, and the caller can tell the Guest it is offline meanwhile.
    const code = (error as { code?: string } | null)?.code ?? ''
    if (code === 'database/permission-denied' && isExpired(session.expires_at_ms, Date.now())) {
      return 'stopped'
    }
    return 'retry'
  }
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return code === 'permission-denied' || code === 'unauthenticated' || code === 'unauthorized'
}
