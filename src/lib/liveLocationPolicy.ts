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
//   every coordinate goes to a Realtime Database leaf node that is overwritten
//   in place, unreadable the moment `expires_at_ms` passes, and removed when the
//   Guest stops or their connection drops.
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

/**
 * How far ahead of the phone's clock the server's clock is, in milliseconds.
 *
 * Both stores check a window against **their** clock, never the device's:
 * `firestore.rules` requires `expires_at <= request.time + 1h` and
 * `database.rules.json` requires `expires_at_ms <= now + 3600000`, where `now`
 * is the Realtime Database server's. A phone whose clock runs a second fast
 * therefore asks for a window that is already past the cap, and the *longest*
 * share — the one the Guest most wants — is the one refused: the consent create
 * comes back `permission-denied`, and every fix is rejected as "the server
 * refused the update". Nothing in the browser can fix its own clock, but it can
 * be told the offset.
 *
 * The inputs are the moments one server-stamped document was asked for and the
 * moment its stamp was read back, so the offset is bracketed rather than
 * guessed and never runs ahead of the server:
 *
 *   - `offsetMs` is the *low* end of the bracket — the local time before which
 *     the server had certainly not yet reached the stamp — so a window built on
 *     it is never longer than the Guest asked for. It is off by at most the
 *     round trip, and always in the safe direction.
 *   - `serverTimeMs` is the server's clock as this call reads it now.
 *   - `certain` says whether the bracket was tight enough to be worth anything
 *     (see `SKEW_TOLERANCE_MS`). A bracket is never zero-width — a round trip
 *     takes time — so "certain" is a threshold, not a proof, and callers that
 *     can say so should.
 */
export type ClockSkew = { offsetMs: number; serverTimeMs: number; certain: boolean }

/** Wider than this and the measurement is not worth believing. */
export const SKEW_TOLERANCE_MS = 1_000

export const NO_CLOCK_SKEW: ClockSkew = { offsetMs: 0, serverTimeMs: 0, certain: false }

export function clockSkewFrom(stamp: { requestedAtMs: number; receivedAtMs: number; stampMs: number }): ClockSkew | null {
  const { requestedAtMs, receivedAtMs, stampMs } = stamp
  if (![requestedAtMs, receivedAtMs, stampMs].every((value) => Number.isFinite(value))) return null
  const low = stampMs - receivedAtMs
  const high = stampMs - requestedAtMs
  const offsetMs = Math.min(low, high)
  return { offsetMs, serverTimeMs: receivedAtMs + offsetMs, certain: high - low <= SKEW_TOLERANCE_MS }
}

/**
 * When a share should end, on **both** clocks.
 *
 * The obvious implementation — `expires_at = now + minutes` — is the bug this
 * function exists to remove. The rules compare that timestamp with the
 * server's clock, so a device whose clock is a little ahead asks for a window
 * that is already past the hour cap: the consent create comes back
 * `permission-denied` and the 60-minute option is the one that fails. So the
 * window is stated in the clock the reader will use:
 *
 *   - `serverMs` is what `expires_at` is written as. It is `now + skew + the
 *     chosen minutes`, i.e. this browser's clock converted into the server's,
 *     so the rule's `expires_at <= request.time + 1h` is satisfied by the
 *     Guest's choice rather than by a millisecond.
 *   - `localMs` is the *same instant* on the device's clock, which is what the
 *     countdown reads and what the Realtime Database node is stamped with.
 *   - both are pulled in by `guardMs`, the band that absorbs the write's own
 *     round trip (and, when the clock could not be measured at all, the whole
 *     of a possible drift).
 *
 * A share is therefore never longer than the Guest asked for, and never
 * refused for saying so.
 */
export function shareWindow(input: {
  nowMs: number
  minutes: number
  skew?: ClockSkew | null
}): { localMs: number; serverMs: number; durationMs: number; guardMs: number } {
  const minutes = Math.min(Math.max(1, Math.floor(input.minutes)), MAX_SHARE_MINUTES)
  const durationMs = minutes * 60_000
  const offset = input.skew && Number.isFinite(input.skew.offsetMs) ? input.skew.offsetMs : null
  // A measured clock is trusted to a few seconds' round trip; an unmeasured one
  // is trusted to nothing, so the window gives up a minute instead.
  const guardMs = offset === null ? CLOCK_GUARD_MS : WINDOW_GUARD_MS
  const clientMs = input.nowMs + durationMs - guardMs
  return {
    localMs: clientMs,
    serverMs: offset === null ? clientMs : clientMs + offset,
    durationMs,
    guardMs,
  }
}

/**
 * The band, in milliseconds, that a window is pulled inside when the device's
 * clock could not be measured. A minute is far more than any phone drifts and
 * far less than the shortest share the Guest may choose.
 */
export const CLOCK_GUARD_MS = 60_000

/** The band when the offset *was* measured: the write's own round trip, twice over. */
export const WINDOW_GUARD_MS = 5_000

/**
 * Is this stored consent still one the Guest may resume?
 *
 * A reload, a tab restored from the back/forward cache, a second tab: all of
 * them arrive with no memory of the session, and the store is the only place
 * that knows. The rules let the owning Guest read the consent for exactly this
 * reason, so the question is asked of the document rather than of memory.
 *
 * Two refusals that matter: a session the Guest already stopped (`active` is
 * false) is not resumable — reopening it is exactly what `firestore.rules`
 * forbids — and neither is one whose window has closed. A rotating phone that
 * re-mounts the page must not resurrect a share the Guest ended.
 */
export function resumableSession(raw: unknown, nowMs: number): LocationSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  const num = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : null)
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null)
  const startedAtMs = num('started_at_ms')
  const expiresAtMs = num('expires_at_ms')
  const durationMinutes = num('duration_minutes')
  const guestUid = str('guest_uid')
  const conversationId = str('conversation_id')
  const secret = str('stream_secret')
  if (
    startedAtMs === null || expiresAtMs === null || durationMinutes === null ||
    guestUid === null || conversationId === null || secret === null
  ) {
    return null
  }
  if (secret.length !== SESSION_SECRET_LENGTH) return null
  if (d.active !== true) return null
  if (isExpired(expiresAtMs, nowMs)) return null
  if (durationMinutes < MIN_SHARE_MINUTES || durationMinutes > MAX_SHARE_MINUTES) return null
  return {
    id: conversationId,
    conversation_id: conversationId,
    guest_uid: guestUid,
    active: true,
    started_at_ms: startedAtMs,
    expires_at_ms: expiresAtMs,
    duration_minutes: durationMinutes,
    stream_secret: secret,
  }
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

// ----------------------------------------------------------------------------
// Point B: where the Guest is relative to the hacienda
// ----------------------------------------------------------------------------
// The stream carries ONE point. On its own that is two numbers and no meaning —
// an owner asking "nasaan na ba sila?" cannot turn `14.19, 121.53` into a
// decision. Adding the hacienda's own pin turns one point into a bearing and a
// distance, which is the smallest thing that answers the question.
//
// Three deliberate limits, each of which a later edit must not relax:
//
//   1. **It is a straight line, never a route.** There is no routing engine
//      behind this and there must not appear to be one. `labelForDistance` and
//      `bearingLabel` exist so the UI has no excuse to print a bare "1.8 km"
//      that a reader takes for road distance.
//   2. **It is computed on the device, from a constant.** Both points are
//      already in the reader's memory; nothing is sent anywhere. A position
//      that is sent to a routing API is a position disclosed to a fourth party
//      the Guest never consented to — see ADR-0013.
//   3. **It answers a different question from "arrived".** A phone under a
//      metal roof in Luisiana reports ±50 m ballistically, so "close enough"
//      is a statement about the *reading*, not about the Guest, and the UI
//      says so rather than announcing an arrival.

/**
 * How close is "here", in metres.
 *
 * Two readings are deliberately treated as the same place: a fix inside the
 * accuracy it reports (the device itself says it cannot tell), and a fix inside
 * a hard floor. The floor matters because a very good fix (accuracy 5 m) would
 * otherwise put a Guest standing at the gate *outside* the threshold, and flip a
 * stable "at the property" badge back to "40 m away" on the next tick.
 */
export const AT_PROPERTY_M = 50

export type Proximity =
  /** Within the threshold, or inside the device's own error: "here". */
  | { kind: 'at-property'; distanceM: number }
  /** A direction and a straight-line distance. */
  | { kind: 'away'; distanceM: number; bearingDeg: number; bearing: BearingLabel }
  /** The point is not a position, so nothing is claimed. */
  | { kind: 'unknown' }

/**
 * Where one position is, relative to a fixed point B.
 *
 * `accuracyM` is the reading's own error. It is used only to widen the
 * "at the property" test in the safe direction — a device that says ±200 m
 * should not produce a confident "15 m away".
 */
export function proximityTo(
  point: LatLng | null | undefined,
  destination: LatLng,
  accuracyM = 0,
): Proximity {
  if (!point || !isFinite(point.lat) || !isFinite(point.lng)) return { kind: 'unknown' }
  if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return { kind: 'unknown' }
  const metres = distanceM(point, destination)
  if (metres <= Math.max(AT_PROPERTY_M, accuracyM)) {
    return { kind: 'at-property', distanceM: metres }
  }
  const bearingDeg = bearingDegrees(point, destination)
  return { kind: 'away', distanceM: metres, bearingDeg, bearing: bearingLabel(bearingDeg) }
}

/**
 * Initial bearing from `from` to `to`, degrees clockwise from north, 0–360.
 *
 * Great-circle, not rhumb line: over the few kilometres this feature deals in
 * the two agree to a degree, and the great-circle one is the honest answer for
 * "which way do I turn".
 */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLng = toRad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** The eight compass points, which is as fine as a GPS fix justifies. */
export const BEARING_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type BearingPoint = (typeof BEARING_POINTS)[number]
export type BearingLabel = { point: BearingPoint; full: string; deg: number }

const BEARING_NAMES: Record<BearingPoint, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west',
}

export function bearingLabel(deg: number): BearingLabel {
  const wrapped = ((deg % 360) + 360) % 360
  // 22.5° per sector, centred on each point, so 350° reads as north rather than
  // as north-west.
  const index = Math.round(wrapped / 45) % BEARING_POINTS.length
  const point = BEARING_POINTS[index]
  return { point, full: BEARING_NAMES[point], deg: wrapped }
}

/**
 * A distance as a sentence fragment, in the unit that suits it.
 *
 * Metres below a kilometre (a "0.4 km away" reads as further than "400 m away"
 * to everybody), one decimal above. The tilde is part of the string on purpose:
 * a GPS fix is never exact, and a bare "1.8 km" invites a precision the reading
 * does not have.
 */
export function labelForDistance(metres: number): string {
  if (!isFinite(metres) || metres < 0) return 'an unknown distance'
  if (metres < 1_000) {
    const rounded = metres < 100 ? Math.round(metres / 10) * 10 : Math.round(metres / 50) * 50
    return `~${Math.max(10, rounded)} m`
  }
  return `~${(metres / 1_000).toFixed(1)} km`
}

/**
 * The whole sentence an Admin reads, in one place.
 *
 * Kept in the policy module rather than in a component so the wording — the
 * part that decides whether an owner mistakes a straight line for a drive — is
 * unit-tested, and so the Flutter panel and the web page can be held to the
 * same words. English, like the rest of both apps (docs/DEFENSE_CHEATSHEET.md
 * counts mixed-language copy as a defect).
 */
export function proximitySentence(proximity: Proximity): string {
  if (proximity.kind === 'unknown') {
    return 'The distance from the Hacienda cannot be worked out from this position.'
  }
  if (proximity.kind === 'at-property') {
    return 'At the Hacienda — within the accuracy of the reading.'
  }
  return `${labelForDistance(proximity.distanceM)} from the Hacienda, ${proximity.bearing.full}.`
}

/**
 * The one-line caveat that has to sit beside the distance.
 *
 * Not optional and not a tooltip: the number is the most mis-readable thing on
 * the screen, and "it is not the driving distance" is the fact that prevents the
 * owner from telling a Guest "you're only 2 km away" when the road is nine.
 */
export const STRAIGHT_LINE_CAVEAT =
  'Straight-line distance, not the driving route. Open the directions for the road distance.'


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
