// ----------------------------------------------------------------------------
// Live location — the Admin's half, on the web.
//
// The Guest's side has always said "the Admin can see your location while this
// is on". Until this module existed that sentence was only true inside the
// Flutter app: the website could *start* a share and could never read one, so
// `checkFix` — the gate that decides whether a position may be drawn at all —
// was written, tested, and called by nothing but its own tests.
//
// Two pieces, deliberately separated:
//
//   `evaluateReader()`  pure. Given the session document, the stream node and a
//                       clock, it says what the Admin may see: nothing yet, a
//                       position, the same position stale, or the reason the
//                       watch is over. No SDK, no network, so every refusal is
//                       a unit test.
//   `watchLiveLocation()` the lifecycle: one Firestore listener on the consent,
//                       one Realtime Database listener on the node, both closed
//                       when the panel closes or the window does.
//
// What it does not do is decide who may read. That is `firestore.rules` (the
// Admin, and the sharing Guest) and `database.rules.json` (the Admin, and not
// after `expires_at_ms`). This module only refuses to *draw* what those rules
// would already have refused to hand over, and says which check said so.
// ----------------------------------------------------------------------------

import { doc as fsDoc, onSnapshot } from 'firebase/firestore'
import { db, ensureRealtimeDatabase } from './firebase'
import {
  LOCATION_SESSIONS_COLLECTION,
  LIVE_LOCATION_PATH,
} from './liveLocation'
import {
  checkFix,
  isExpired,
  isStale,
  proximityTo,
  resumableSession,
  type FixRejection,
  type LatLng,
  type LocationFix,
  type LocationSession,
  type Proximity,
} from './liveLocationPolicy'

/** Why an Admin is no longer looking at a position. */
export type ReaderStop =
  | FixRejection
  | 'expired'
  | 'stopped'
  | 'denied'
  | 'offline'
  | 'no-transport'

/**
 * What the Admin's panel is showing. Every state is a fact, so the panel never
 * has to say "loading" for something that is not loading.
 */
export type ReaderFrame =
  /** No consent on record: the Guest has not started, or has cleared it. */
  | { kind: 'no-session' }
  /** The consent is live and the first fix has not landed yet. */
  | { kind: 'waiting'; session: LocationSession }
  /**
   * A position `checkFix` accepted. `stale` means the Guest's device stopped
   * reporting; `proximity` is where that position is relative to point B, or
   * null when the caller did not supply one.
   */
  | { kind: 'live'; session: LocationSession; fix: LocationFix; stale: boolean; proximity: Proximity | null }
  /** The watch is over, and this is why. */
  | { kind: 'ended'; reason: ReaderStop; fix?: LocationFix }

/** The stored consent, as `location_sessions/{convoId}` holds it. */
export type StoredSession = {
  active?: unknown
  guest_uid?: unknown
  conversation_id?: unknown
  duration_minutes?: unknown
  stream_secret?: unknown
  started_at_ms?: unknown
  expires_at_ms?: unknown
}

/**
 * Decide what the Admin may draw, from the two stores and a clock.
 *
 * The order matters and is the feature's whole promise:
 *
 *   1. no consent, or one that is stopped or past its window → nothing is drawn;
 *   2. no position yet → "waiting", which is true and is not an error;
 *   3. a position `checkFix` rejects → the watch is over, and the reason is
 *      carried out so the panel can say *why* rather than going blank.
 *
 * `checkFix` is the same function the Guest's tests exercise: it requires the
 * node's `guest_uid`, `conversation_id` and `session_secret` to match the
 * consent, and the consent to still be active and unexpired. A node nobody can
 * correlate to a live session is inert.
 */
export function evaluateReader(input: {
  session: StoredSession | null | undefined
  fix: unknown
  nowMs: number
  /**
   * Point B — the hacienda's own pin, from the site config. Passed in rather
   * than imported so this stays a pure function of its arguments, and so the
   * reader can be tested without a business address.
   */
  destination?: LatLng | null
}): ReaderFrame {
  const session = resumableSession(input.session, input.nowMs)
  if (!session) {
    // Distinguish "the Guest ended it" from "it ran out" from "never started",
    // because the panel's sentence differs and only the last is neutral.
    const ended = input.session != null
    if (!ended) return { kind: 'no-session' }
    const expired = typeof input.session?.expires_at_ms === 'number'
      ? isExpired(input.session.expires_at_ms as number, input.nowMs)
      : true
    return { kind: 'ended', reason: expired ? 'expired' : 'stopped' }
  }

  if (input.fix == null) return { kind: 'waiting', session }

  const checked = checkFix(input.fix, session, input.nowMs)
  if (!checked.ok) return { kind: 'ended', reason: checked.reason }

  return {
    kind: 'live',
    session,
    fix: checked.fix,
    stale: isStale(checked.fix.at_ms, input.nowMs),
    proximity: input.destination
      ? proximityTo(
          { lat: checked.fix.lat, lng: checked.fix.lng },
          input.destination,
          checked.fix.accuracy_m,
        )
      : null,
  }
}

/**
 * A directions link the Admin can press, with both ends filled in.
 *
 * Point A is the Guest's *accepted* position; point B is the hacienda. This is
 * the only place the two ever leave the app together, and they leave only as a
 * string a person must choose to open — never a background request. That is
 * what keeps a routing provider from becoming a fourth party that sees a live
 * Guest position (ADR-0013, "Point B").
 *
 * OpenStreetMap rather than Google: it needs no key, and the site already links
 * to it for the hacienda's own address. Google Maps is a second constant away if
 * the owner prefers it.
 */
export function directionsUrl(from: LatLng, to: LatLng): string {
  const a = `${from.lat},${from.lng}`
  const b = `${to.lat},${to.lng}`
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a}%3B${b}`
}

/** A sentence for each ending, in the Admin's words rather than a rule's. */
export function readerStopMessage(reason: ReaderStop): string {
  switch (reason) {
    case 'expired':
      return 'The sharing window closed. Nothing is being shared now.'
    case 'stopped':
      return 'The Guest stopped sharing.'
    case 'denied':
      return 'This Admin account cannot read live locations yet. An allowlisted Admin must open the Admin app once to admit it.'
    case 'offline':
      return 'The connection dropped, so the position stopped updating.'
    case 'no-transport':
      return 'This build has no live-location channel configured, so there is nothing to read.'
    case 'secret':
    case 'guest':
    case 'conversation':
      return 'The position in the stream does not belong to this session, so it was not drawn.'
    case 'future':
      return 'The stream reported a position dated in the future, which no device produces. It was not drawn.'
    case 'position':
      return 'The stream reported a position outside the world. It was not drawn.'
    default:
      return 'The position could not be accepted, so it was not drawn.'
  }
}

export type ReaderHandle = { close: () => void }

/**
 * Follow one conversation's live location until the panel closes.
 *
 * Both listeners are torn down together, so closing the panel is the whole of
 * "stop watching" — the same contract the Flutter panel has. `onFrame` is
 * called on every change of either store and never with a frame the rules
 * would not have allowed.
 *
 * A missing node is not an ending: the panel opens before the Guest's first fix
 * and must wait for it. The consent listener owns the ending.
 */
export function watchLiveLocation(input: {
  convoId: string
  now: () => number
  onFrame: (frame: ReaderFrame) => void
  /** Point B, if the reader has one. Omitted, the frames carry no proximity. */
  destination?: LatLng | null
}): ReaderHandle {
  let closed = false
  let session: StoredSession | null = null
  let fix: unknown = null
  const emit = (frame: ReaderFrame) => {
    if (!closed) input.onFrame(frame)
  }
  const recheck = () =>
    emit(evaluateReader({ session, fix, nowMs: input.now(), destination: input.destination }))

  const unsubscribes: Array<() => void> = []
  let positionUnsubscribe: (() => void) | null = null
  let lastGuestUid: string | null = null

  if (!db) {
    emit({ kind: 'ended', reason: 'no-transport' })
    return { close: () => { closed = true } }
  }

  unsubscribes.push(
    onSnapshot(
      fsDoc(db, LOCATION_SESSIONS_COLLECTION, input.convoId),
      (snapshot) => {
        session = snapshot.exists() ? (snapshot.data() as StoredSession) : null

        // Re-point the position listener when the Guest of this session changes,
        // which happens when a conversation is reopened by its owner after a
        // restart. Same Guest: the node is the same node, so nothing is done.
        const guestUid = typeof session?.guest_uid === 'string' ? session.guest_uid : null
        if (guestUid !== lastGuestUid) {
          lastGuestUid = guestUid
          positionUnsubscribe?.()
          positionUnsubscribe = null
          fix = null
          if (guestUid) {
            void ensureRealtimeDatabase().then((realtime) => {
              if (closed || !realtime) return
              void import('firebase/database').then(({ onValue, ref }) => {
                if (closed) return
                positionUnsubscribe = onValue(
                  ref(realtime, `${LIVE_LOCATION_PATH}/${input.convoId}/${guestUid}`),
                  (event) => {
                    fix = event.val()
                    recheck()
                  },
                  (error) => {
                    const code = (error as { code?: string })?.code ?? ''
                    emit({ kind: 'ended', reason: code.includes('permission') ? 'denied' : 'offline' })
                  },
                )
              })
            })
          }
        }
        recheck()
      },
      (error) => {
        const code = (error as { code?: string })?.code ?? ''
        emit({ kind: 'ended', reason: code === 'permission-denied' ? 'denied' : 'offline' })
      },
    ),
  )

  return {
    close: () => {
      closed = true
      for (const unsubscribe of unsubscribes) unsubscribe()
      positionUnsubscribe?.()
    },
  }
}
