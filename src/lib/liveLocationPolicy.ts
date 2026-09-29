// ----------------------------------------------------------------------------
// Live location — the policy, with no cloud in it.
//
// A Guest who shares their live location for 30 minutes produces a position
// every few seconds. None of it is a record: this module decides *whether a fix
// is worth sending*, *how long a session may run*, and *what the Admin is
// allowed to see*, and every one of those decisions is a function of its
// arguments so a test can pin it without a device, a browser or a network.
//
// The two halves that need authority — who may start a session, and what the
// Admin may read — are Firestore's job (firestore.rules, `location_sessions`)
// and the stream's own rules (`database.rules.json`). The rule that the whole
// feature rests on is:
//
//   **a position is never a record.** Firestore stores the session's metadata
//   (active, started_at, expires_at, guest_uid, stream_secret) and nothing else;
//   every coordinate goes to a Realtime Database node carrying a server-side
//   TTL, so the server deletes it whether or not the Guest ever presses Stop.
//
// See docs/MESSAGING.md and docs/adr/0013-live-location-as-a-stream.md.
// ----------------------------------------------------------------------------

/** The three windows the Guest picks between, in minutes. */
export const SHARE_DURATIONS = [15, 30, 60] as const
export type ShareDuration = (typeof SHARE_DURATIONS)[number]

/** Longest a session may run, whatever the Guest asked for. The rules enforce it. */
export const MAX_SHARE_MINUTES = 60
export const MIN_SHARE_MINUTES = 1

/** How often a fix may be sent at most, in milliseconds. */
export const MIN_PUBLISH_INTERVAL_MS = 3_000

/**
 * …and how far the Guest has to have moved before a fix is worth sending even
 * after the interval has passed. Ten metres is roughly the GPS error of a
 * phone outdoors, so anything finer is noise; a guest walking to the gate does
 * not move ten metres, and the Admin still sees the gate, thirty seconds late
 * rather than never.
 */
export const MIN_PUBLISH_DISTANCE_M = 10

/** A position older than this is "stale" and the Admin is told so. */
export const STALE_AFTER_MS = 20_000

/** Radius of the earth, metres. Shared with the Admin app's Dart copy. */
const EARTH_RADIUS_M = 6_371_008.8

export type LatLng = { lat: number; lng: number }

/**
 * A published fix, in the shape that crosses the wire to the Admin.
 *
 * `session_secret` is what binds an ephemeral node to a consented Firestore
 * session: the secret is written to `location_sessions/{convoId}` by the rules
 * that know who the Guest is, and the Admin only renders a node whose secret
 * matches. A node nobody can correlate to a session is inert.
 */
export type LocationFix = {
  lat: number
  lng: number
  accuracy_m: number
  at_ms: number
  seq: number
  guest_uid: string
  conversation_id: string
  session_secret: string
  expires_at_ms: number
}

/** The metadata Firestore keeps. Deliberately carries no coordinate. */
export type LocationSession = {
  id: string
  conversation_id: string
  guest_uid: string
  active: boolean
  started_at_ms: number
  expires_at_ms: number
  duration_minutes: number
  stream_secret: string
}

export type ShareResult = { ok: true; value: ShareDuration } | { ok: false; message: string }

/** Is this one of the windows the Guest may choose? */
export function isShareDuration(minutes: number): minutes is ShareDuration {
  return (SHARE_DURATIONS as readonly number[]).includes(minutes)
}

/**
 * Accept a chosen duration, clamped to what the session may actually run.
 * The clamp is a courtesy — `firestore.rules` refuses anything past
 * `MAX_SHARE_MINUTES` whatever the browser asked for.
 */
export function chooseDuration(minutes: number): ShareResult {
  if (!Number.isFinite(minutes)) return { ok: false, message: 'Choose how long to share for.' }
  if (minutes < MIN_SHARE_MINUTES) return { ok: false, message: 'Choose a sharing time.' }
  const clamped = Math.min(Math.floor(minutes), MAX_SHARE_MINUTES)
  return { ok: true, value: clamped as ShareDuration }
}

/** When a session started sharing, when it stops on its own. */
export function expiryFor(startedAtMs: number, minutes: number): number {
  return startedAtMs + Math.min(Math.max(1, Math.floor(minutes)), MAX_SHARE_MINUTES) * 60_000
}

/** Has the window closed? A millisecond early is still sharing. */
export function isExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs
}

/** Seconds left, floored at 0 — what both screens count down. */
export function secondsLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000))
}

/** `27:43`, the way the Guest's panel shows it. */
export function formatCountdown(expiresAtMs: number, nowMs: number): string {
  const total = secondsLeft(expiresAtMs, nowMs)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** `3 seconds ago` / `2 minutes ago` — how stale a fix is, in words. */
export function formatAge(atMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type PublishDecision = { publish: true } | { publish: false; reason: string }

/**
 * Should this fix be sent?
 *
 * A GPS chip reports a position every second whether or not the Guest moved.
 * Sending all of them would be a few hundred writes a minute for a signal that
 * repeats, so a fix is sent when it is **both** old enough and somewhere new:
 * the first fix always goes (otherwise a stationary Guest would never be seen),
 * and after that three seconds and ten metres, whichever is the later.
 */
export function shouldPublishFix(input: {
  next: LatLng
  last?: { at: LatLng; atMs: number } | null
  nowMs: number
  minIntervalMs?: number
  minDistanceM?: number
}): PublishDecision {
  const interval = input.minIntervalMs ?? MIN_PUBLISH_INTERVAL_MS
  const floor = input.minDistanceM ?? MIN_PUBLISH_DISTANCE_M
  if (!isFinite(input.next.lat) || !isFinite(input.next.lng)) {
    return { publish: false, reason: 'The device reported a position that is not a number.' }
  }
  if (input.next.lat < -90 || input.next.lat > 90 || input.next.lng < -180 || input.next.lng > 180) {
    return { publish: false, reason: 'The device reported a position outside the world.' }
  }
  if (!input.last) return { publish: true }
  if (input.nowMs - input.last.atMs < interval) {
    return { publish: false, reason: 'too soon' }
  }
  if (distanceM(input.last.at, input.next) < floor) {
    return { publish: false, reason: 'not far enough' }
  }
  return { publish: true }
}

/** 32 hex characters — 128 bits from `crypto.getRandomValues`. */
export const SESSION_SECRET_LENGTH = 32

/** A session secret, or null when the browser has no secure randomness. */
export function newSessionSecret(): string | null {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c?.getRandomValues) return null
  const bytes = new Uint8Array(SESSION_SECRET_LENGTH / 2)
  c.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type FixRejection =
  | 'shape'
  | 'guest'
  | 'conversation'
  | 'secret'
  | 'expired'
  | 'future'
  | 'position'

/**
 * May the Admin render this node?
 *
 * The mirror of `database.rules.json` `.validate` on the write side, and the
 * gate on the read side: a node is only drawn when it is shaped correctly, is
 * the fix of the Guest who owns the conversation, carries the secret that
 * Firestore's `location_sessions` document carries, and has not expired. The
 * last one matters most — an expired session must stop being readable even if
 * the node has not been swept yet.
 *
 * Returns the reason so the Admin's screen can say *why* it closed rather than
 * silently going blank.
 */
export function checkFix(
  raw: unknown,
  session: Pick<LocationSession, 'guest_uid' | 'conversation_id' | 'stream_secret' | 'expires_at_ms' | 'active'>,
  nowMs: number,
): { ok: true; fix: LocationFix } | { ok: false; reason: FixRejection } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'shape' }
  const f = raw as Record<string, unknown>
  const num = (k: string) => (typeof f[k] === 'number' && Number.isFinite(f[k] as number) ? (f[k] as number) : null)
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : null)
  const lat = num('lat')
  const lng = num('lng')
  const at = num('at_ms')
  const seq = num('seq')
  const expires = num('expires_at_ms')
  const accuracy = num('accuracy_m')
  const guest = str('guest_uid')
  const convo = str('conversation_id')
  const secret = str('session_secret')
  if (lat === null || lng === null || at === null || seq === null || expires === null || accuracy === null) {
    return { ok: false, reason: 'shape' }
  }
  if (guest === null || convo === null || secret === null) return { ok: false, reason: 'shape' }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, reason: 'position' }
  if (guest !== session.guest_uid) return { ok: false, reason: 'guest' }
  if (convo !== session.conversation_id) return { ok: false, reason: 'conversation' }
  if (secret !== session.stream_secret) return { ok: false, reason: 'secret' }
  if (at > nowMs + 30_000) return { ok: false, reason: 'future' }
  if (at > expires) return { ok: false, reason: 'future' }
  if (isExpired(expires, nowMs) || isExpired(session.expires_at_ms, nowMs) || !session.active) {
    return { ok: false, reason: 'expired' }
  }
  return {
    ok: true,
    fix: {
      lat,
      lng,
      accuracy_m: accuracy,
      at_ms: at,
      seq,
      guest_uid: guest,
      conversation_id: convo,
      session_secret: secret,
      expires_at_ms: expires,
    },
  }
}

/** Is a fix old enough that the Admin should stop treating it as "live"? */
export function isStale(atMs: number, nowMs: number, staleAfterMs = STALE_AFTER_MS): boolean {
  return nowMs - atMs > staleAfterMs
}

export type SharingStatus = 'off' | 'starting' | 'active' | 'error'

/** The reason a share never started, as the Guest is told it. */
export type StartFailure =
  | 'signed-out'
  | 'no-firebase'
  | 'no-database'
  | 'permission-denied'
  | 'unavailable'
  | 'refused'

/**
 * Why this build cannot share, read as a sentence for the Guest.
 *
 * A share that pretends to work is worse than one that says no: the Guest would
 * believe the Admin can see them, and the Admin would not. So every one of these
 * is a refusal with words attached, never a silent no-op.
 */
export function startFailureMessage(reason: StartFailure): string {
  switch (reason) {
    case 'signed-out':
      return 'Sign in to share your live location.'
    case 'no-firebase':
      return 'Live location needs the Hacienda\'s cloud connection, which this browser is not configured for.'
    case 'no-database':
      return 'This deployment has no live-location channel configured, so sharing is off.'
    case 'permission-denied':
      return 'Location permission was refused, so nothing is being shared. Allow it in your browser settings to try again.'
    case 'unavailable':
      return 'Your device could not get a position (GPS may be off, or you may be indoors). Nothing is being shared.'
    case 'refused':
      return 'The Hacienda\'s server refused to start the session. Nothing is being shared.'
    default:
      return 'Live location could not be started.'
  }
}
