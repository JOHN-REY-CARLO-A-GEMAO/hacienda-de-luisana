// ----------------------------------------------------------------------------
// Live location — the cloud half.
//
// What this module does, and nothing else:
//
//   startSharing()  one Firestore write: the session's metadata, no coordinate
//   publishFix()    one Realtime Database write: the position, TTL'd server-side
//   stopSharing()   the Firestore session is closed and the stream node removed
//
// What it deliberately does not do: keep a history. There is no `points`, no
// append, no trail — a position is overwritten by the next one and deleted by
// the server when the window closes. Everything a position passes through is
// written once and lives at most as long as the Guest chose to share.
//
// Which store carries the stream, and why:
//
//   **Firebase Realtime Database**, not Firestore. The choice is made by three
//   properties the Admin's position feed needs and Firestore does not have:
//
//     1. *It is deleted for us.* Every write carries a server-side TTL equal to
//        the session's `expires_at`, so the data is gone whether or not the tab
//        closes, the phone dies, or the Guest forgets to press Stop. Firestore
//        has no per-document TTL you can attach to a document you overwrite —
//        and an overwritten document is a *stored* document, billed and readable
//        to anyone the rules admit.
//     2. *It is charged differently.* Firestore bills a write per fix. A Guest
//        standing still, watched at a 3-second cadence, is 20 writes a minute —
//        28,800 a day — for one field that changes. Realtime Database bills
//        storage and download, and a 200-byte node held for ninety seconds
//        costs nothing anyone notices.
//     3. *It needs no new vendor.* The same Firebase project, the same Auth
//        tokens, the same console, the same deployment. The web SDK already
//        ships `firebase/database` in the installed `firebase` package, so this
//        adds no npm dependency at all.
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

import { doc as fsDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, ensureRealtimeDatabase, hasRealtimeDatabaseConfig, isFirebaseConfigured } from './firebase'
import {
  MAX_SHARE_MINUTES,
  checkFix,
  expiryFor,
  isExpired,
  newSessionSecret,
  type LocationFix,
  type LocationSession,
  type ShareDuration,
  type StartFailure,
} from './liveLocationPolicy'

/** Where the session's metadata lives. The document id IS the conversation id. */
export const LOCATION_SESSIONS_COLLECTION = 'location_sessions'

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
 * Open a sharing session for a conversation.
 *
 * The write carries the metadata and nothing else: no coordinate goes near
 * Firestore, ever. `firestore.rules` re-checks every field of it, refuses a
 * window past an hour, and refuses a document that has smuggled a position in.
 */
export async function startSharing(input: {
  convoId: string
  uid: string
  minutes: ShareDuration
  nowMs: number
}): Promise<StartResult> {
  const unavailable = unavailableReason(input.uid)
  if (unavailable) return { ok: false, reason: unavailable }
  if (!db || input.convoId.startsWith('local:')) return { ok: false, reason: 'no-firebase' }

  const minutes = Math.min(MAX_SHARE_MINUTES, Math.max(1, Math.floor(input.minutes)))
  const secret = newSessionSecret()
  if (!secret) return { ok: false, reason: 'refused' }
  const expiresAtMs = expiryFor(input.nowMs, minutes)

  const session: LocationSession = {
    id: input.convoId,
    conversation_id: input.convoId,
    guest_uid: input.uid,
    active: true,
    started_at_ms: input.nowMs,
    expires_at_ms: expiresAtMs,
    duration_minutes: minutes,
    stream_secret: secret,
  }

  try {
    await setDoc(fsDoc(db, LOCATION_SESSIONS_COLLECTION, input.convoId), {
      guest_uid: session.guest_uid,
      conversation_id: session.conversation_id,
      active: true,
      started_at: serverTimestamp(),
      expires_at: new Date(expiresAtMs),
      duration_minutes: minutes,
      stream_secret: secret,
    })
  } catch (error) {
    return { ok: false, reason: isPermissionError(error) ? 'refused' : 'unavailable' }
  }
  return { ok: true, session }
}

/** The path one Guest's position lives at, or null with no transport. */
async function streamRef(convoId: string, uid: string) {
  const realtime = await ensureRealtimeDatabase()
  if (!realtime) return null
  const { ref } = await import('firebase/database')
  return ref(realtime, `${LIVE_LOCATION_PATH}/${convoId}/${uid}`)
}

/**
 * Close the session: the Firestore document is marked ended and the stream node
 * is removed.
 *
 * The removal is best-effort on purpose. If the device is offline when the
 * Guest presses Stop, the session document is still updated (Firestore queues
 * it) and the node is swept by the server TTL that was already on it — so a
 * Guest who stops sharing offline is not still being streamed.
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
 * The write carries `.ttl`, the Realtime Database's server-side expiry, set to
 * the session's `expires_at`: the server deletes the node at that instant even
 * if the device never comes back. Publishing past the window is refused here as
 * well as by the rules, because a refused write that throws inside a geolocation
 * callback is a crash, not a security control.
 */
export async function publishFix(
  session: LocationSession,
  fix: Pick<LocationFix, 'lat' | 'lng' | 'accuracy_m' | 'seq'>,
  nowMs: number,
): Promise<'sent' | 'stopped'> {
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
    // The server deletes the node at the session's own expiry. This is the
    // mechanism that makes "ephemeral" true rather than aspirational.
    '.ttl': session.expires_at_ms,
  }
  const { set } = await import('firebase/database')
  await set(reference, payload)
  return 'sent'
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return code === 'permission-denied' || code === 'unauthenticated' || code === 'unauthorized'
}
