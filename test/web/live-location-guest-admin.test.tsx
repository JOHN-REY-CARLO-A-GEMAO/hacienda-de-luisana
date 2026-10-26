// ----------------------------------------------------------------------------
// 📍 Sending a location: the Guest's hand, the wire, and the Admin's eye.
//
// The other suites test this feature one layer at a time —
// `live-location.test.ts` the policy, `live-location-start.test.ts` the consent
// write, `realtime-database-rules.test.ts` the rules text,
// `test/chat_limits_test.dart` the Admin app's parsers. Each of them is right
// about its own layer, and between them they leave the one question the feature
// is actually asked unanswered:
//
//   **When a Guest presses "30 minutes" and walks towards the gate, does the
//   Admin see them?**
//
// That question crosses three boundaries no single-layer suite can see: the
// browser's GPS into the publisher, the publisher's payload into the gate the
// Admin renders through, and the web app's field names into the Flutter app's.
// This file walks the whole path with the real modules — the real hook, the
// real `startSharing`/`publishFix`/`stopSharing`, the real `checkFix`, the real
// `ShareLocationBar` — and only the transport and the satellite are doubles.
//
// It is the suite that would have caught both bugs this feature has already
// shipped. The `'.ttl'` key made every fix throw, and only a payload assertion
// can see that (`live-location.test.ts` now holds it). The `stream_secret` /
// `session_secret` mix-up made every valid session look foreign to the Admin,
// and only a two-app contract assertion can see that — which is what the last
// describe block is for.
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// The doubles: two stores and one satellite.
//
// `ref` keeps the path it was given so the tests can assert *where* a position
// was written, not only *what* — the Admin subscribes to a path, and a payload
// written to the wrong one is a payload nobody reads.
// ---------------------------------------------------------------------------
const transport = vi.hoisted(() => ({
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  ref: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onDisconnectRemove: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: transport.getDoc,
  deleteDoc: transport.deleteDoc,
  setDoc: transport.setDoc,
  updateDoc: transport.updateDoc,
  serverTimestamp: () => 'synthetic-server-timestamp',
}))

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => transport.ref(path) as unknown,
  set: transport.set,
  remove: transport.remove,
  onDisconnect: () => ({ remove: transport.onDisconnectRemove }),
}))

vi.mock('../../src/lib/firebase', () => ({
  db: { double: true },
  isFirebaseConfigured: true,
  hasRealtimeDatabaseConfig: () => true,
  ensureRealtimeDatabase: async () => ({ double: true }),
}))

import { ShareLocationBar } from '../../src/components/chat/ShareLocationBar'
import { useLiveLocation, type UseLiveLocation } from '../../src/hooks/useLiveLocation'
import {
  LIVE_LOCATION_PATH,
  LOCATION_SESSIONS_COLLECTION,
  publishFix,
  startSharing,
  stopSharing,
} from '../../src/lib/liveLocation'
import {
  MAX_SHARE_MINUTES,
  SESSION_SECRET_LENGTH,
  STALE_AFTER_MS,
  checkFix,
  type LocationFix,
  type LocationSession,
} from '../../src/lib/liveLocationPolicy'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A Thursday morning at the hacienda. Every clock in this file reads it. */
const T0 = Date.parse('2026-10-01T09:00:00.000Z')
const CONVO = 'booking-bk_test_77'
const GUEST = 'guest-uid-maria-31'
/** Luisiana, Laguna — inside the box `database.rules.json` allows, which matters. */
const GATE = { lat: 14.1003, lng: 121.3017 }

// ---------------------------------------------------------------------------
// The other three sides of this contract, read as text: the Admin app's reader
// (Flutter, which this suite cannot execute), and the two rule files that hold
// the authority neither app has.
// ---------------------------------------------------------------------------
const dart = readFileSync(join(__dirname, '../../lib/services/live_location_service.dart'), 'utf8')
const firestoreRules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const databaseRules = JSON.parse(readFileSync(join(__dirname, '../../database.rules.json'), 'utf8')) as {
  rules: Record<string, unknown>
}

/** The leaf rule of `live_location/{conversationId}/{guestUid}`. */
function rtdbLeaf(): Record<string, string> {
  const conversation = databaseRules.rules[LIVE_LOCATION_PATH] as Record<string, unknown>
  return (conversation['$conversationId'] as Record<string, unknown>)['$guestUid'] as Record<string, string>
}

// ---------------------------------------------------------------------------
// The satellite. jsdom has no geolocation, and a location feature tested
// against a stub that always succeeds tests nothing: the interesting cases are
// a device that reports faster than we send, one that reports a position that
// has not moved, and one that refuses permission outright.
// ---------------------------------------------------------------------------
type Report = { coords: { latitude: number; longitude: number; accuracy: number | null } }
type Watcher = {
  id: number
  onSuccess: (position: Report) => void
  onError: (error: { code: number; message: string }) => void
  options: PositionOptions | undefined
}

const geo = {
  watchers: [] as Watcher[],
  cleared: [] as number[],
  nextId: 1,
  watchPosition(
    onSuccess: Watcher['onSuccess'],
    onError: Watcher['onError'],
    options?: PositionOptions,
  ): number {
    const id = this.nextId++
    this.watchers.push({ id, onSuccess, onError, options })
    return id
  },
  clearWatch(id: number) {
    this.cleared.push(id)
    this.watchers = this.watchers.filter((w) => w.id !== id)
  },
}

/** The device reports a position. The hook's callback runs, synchronously. */
function report(lat: number, lng: number, accuracy: number | null = 8) {
  act(() => {
    for (const watcher of [...geo.watchers]) watcher.onSuccess({ coords: { latitude: lat, longitude: lng, accuracy } })
  })
}

/** The device refuses: code 1 is permission, 2 is no position, 3 is a timeout. */
function failWith(code: number) {
  act(() => {
    for (const watcher of [...geo.watchers]) watcher.onError({ code, message: `geolocation error ${code}` })
  })
}

// ---------------------------------------------------------------------------
// The Guest's screen: the real hook driving the real control.
// ---------------------------------------------------------------------------
const mounted: Root[] = []
let latest: UseLiveLocation | null = null

function Harness(props: { convoId: string | null; uid: string | undefined }) {
  const sharing = useLiveLocation(props)
  latest = sharing
  return <ShareLocationBar sharing={sharing} />
}

let root: Root | null = null

type HarnessProps = { convoId: string | null; uid: string | undefined }

/**
 * Defaults applied by presence, not by truthiness: `convoId: null` and
 * `uid: undefined` are both cases the hook has to handle, so a test that passes
 * one must not have it quietly replaced with the happy-path value.
 */
function resolve(props: Partial<HarnessProps>): HarnessProps {
  return {
    convoId: 'convoId' in props ? (props.convoId as string | null) : CONVO,
    uid: 'uid' in props ? (props.uid as string | undefined) : GUEST,
  }
}

function mount(props: Partial<HarnessProps> = {}): HTMLElement {
  const resolved = resolve(props)
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<Harness convoId={resolved.convoId} uid={resolved.uid} />)
  })
  mounted.push(root)
  return container
}

function rerender(props: Partial<HarnessProps>) {
  const resolved = resolve(props)
  act(() => {
    root!.render(<Harness convoId={resolved.convoId} uid={resolved.uid} />)
  })
}

/** Let the promises the hook does not await (publish, cleanup) land. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function findButton(where: ParentNode, label: RegExp): HTMLButtonElement {
  const found = [...where.querySelectorAll('button')].find(
    (b) => label.test(b.textContent ?? '') || label.test(b.getAttribute('aria-label') ?? '') || label.test(b.getAttribute('title') ?? ''),
  )
  if (!found) throw new Error(`no button matching ${label}`)
  return found
}

/** Press "Live Location", then one of the three windows. Returns after start(). */
async function chooseMinutes(where: ParentNode, minutes: 15 | 30 | 60) {
  act(() => findButton(where, /Live Location/i).click())
  await flush()
  act(() => findButton(where, new RegExp(`^${minutes} minutes$`)).click())
  await flush()
}

/** What the publisher last wrote, and where it wrote it. */
function lastFixOnTheWire(): { path: string; payload: Record<string, unknown> } {
  const call = transport.set.mock.lastCall
  if (!call) throw new Error('nothing was ever published')
  return { path: (call[0] as { path: string }).path, payload: call[1] as Record<string, unknown> }
}

/** The consent document the Guest's real `startSharing` wrote. */
function consentWritten(): Record<string, unknown> {
  const call = transport.setDoc.mock.lastCall
  if (!call) throw new Error('no consent was ever written')
  return call[1] as Record<string, unknown>
}

beforeEach(() => {
  for (const fn of Object.values(transport)) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
  transport.getDoc.mockResolvedValue({ exists: () => false })
  transport.ref.mockImplementation((path: string) => ({ path }))
  geo.watchers = []
  geo.cleared = []
  geo.nextId = 1
  latest = null
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true, writable: true })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true, writable: true })
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  for (const mountedRoot of mounted.splice(0)) act(() => mountedRoot.unmount())
  document.body.innerHTML = ''
  root = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ===========================================================================
// The Guest's side: from a tap to a position on the wire.
// ===========================================================================
describe('the Guest sends a location', () => {
  it('opens a consent, arms the server-side cleanup and only then asks the device for a position', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    expect(latest?.phase).toBe('active')
    expect(latest?.session).toMatchObject({
      conversation_id: CONVO,
      guest_uid: GUEST,
      active: true,
      duration_minutes: 30,
      expires_at_ms: T0 + 30 * 60_000,
    })

    // The consent is metadata. A coordinate in it is a position stored forever,
    // which is the one thing `firestore.rules` refuses to allow.
    const consent = consentWritten()
    expect(consent).toMatchObject({
      conversation_id: CONVO,
      guest_uid: GUEST,
      active: true,
      duration_minutes: 30,
    })
    expect(consent.stream_secret).toMatch(new RegExp(`^[0-9a-f]{${SESSION_SECRET_LENGTH}}$`))
    for (const field of ['lat', 'lng', 'latitude', 'longitude', 'position', 'fix', 'points', 'trail']) {
      expect(consent).not.toHaveProperty(field)
    }

    // The deletion the Guest's own device cannot be trusted to make is armed
    // before the first position could possibly be sent.
    await flush()
    expect(transport.onDisconnectRemove).toHaveBeenCalledOnce()

    // And a session with no position yet has sent no position: the wire is
    // still clean, which is what lets the control say "Finding your location…".
    expect(transport.set).not.toHaveBeenCalled()
    expect(geo.watchers).toHaveLength(1)
    expect(geo.watchers[0].options).toMatchObject({ enableHighAccuracy: true })
  })

  it('sends the first position the device reports, to the leaf the Admin subscribes to', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    report(GATE.lat, GATE.lng)
    await flush()

    const { path, payload } = lastFixOnTheWire()
    expect(path).toBe(`${LIVE_LOCATION_PATH}/${CONVO}/${GUEST}`)
    expect(payload).toMatchObject({
      lat: GATE.lat,
      lng: GATE.lng,
      accuracy_m: 8,
      at_ms: T0,
      seq: 1,
      guest_uid: GUEST,
      conversation_id: CONVO,
      expires_at_ms: T0 + 30 * 60_000,
    })
    // The secret restated on the fix is the consent's own, not a second one.
    expect(payload.session_secret).toBe(latest?.session?.stream_secret)
    expect(latest?.lastSentAtMs).toBe(T0)
  })

  it('walks to the gate at a cadence, not on every tick of the GPS chip', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    // A stationary Guest is still seen, once.
    report(14.1, 121.3)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(1)

    // One second later, five metres on: too soon, and not far enough anyway.
    vi.setSystemTime(T0 + 1_000)
    report(14.10005, 121.3)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(1)

    // Five seconds later, twenty-two metres on: both gates open, so it goes.
    vi.setSystemTime(T0 + 5_000)
    report(14.1002, 121.3)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(2)
    expect(lastFixOnTheWire().payload.seq).toBe(2)

    // Five seconds after that but a metre on: the interval has passed and the
    // Guest has not moved, so the position the Admin sees is the one that is
    // true rather than the one that is newest.
    vi.setSystemTime(T0 + 10_000)
    report(14.10021, 121.3)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(2)
  })

  it('stops sending the moment the window closes, without the Guest touching anything', async () => {
    const where = mount()
    await chooseMinutes(where, 15)
    report(GATE.lat, GATE.lng)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(1)

    // The 15 minutes run out. The hook's own tick notices.
    await flush(15 * 60_000)

    expect(latest?.phase).toBe('error')
    expect(latest?.message).toMatch(/the time you chose ran out/i)
    expect(latest?.session).toBeNull()
    expect(latest?.countdown).toBeNull()
    expect(geo.watchers).toHaveLength(0)
    expect(transport.updateDoc).toHaveBeenCalled()
    expect(transport.updateDoc.mock.lastCall?.[1]).toMatchObject({ active: false })

    // A GPS callback that arrives after the window is a callback nobody acts on.
    report(GATE.lat + 0.01, GATE.lng)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(1)
  })

  it('counts the window down for the Guest while the Admin is watching', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    expect(where.textContent).toContain('30:00')

    await flush(45_000)
    expect(latest?.countdown).toBe('29:15')
    expect(where.textContent).toContain('29:15')
  })

  it('closes the consent and removes the node when the Guest presses Stop', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()

    vi.setSystemTime(T0 + 60_000)
    act(() => findButton(where, /^Stop Sharing$/i).click())
    await flush()

    expect(transport.updateDoc).toHaveBeenCalledOnce()
    const [reference, ended] = transport.updateDoc.mock.lastCall!
    expect((reference as { path: string }).path).toBe(`${LOCATION_SESSIONS_COLLECTION}/${CONVO}`)
    expect(ended).toMatchObject({ active: false, expires_at: new Date(T0 + 60_000) })

    // The position is removed, not left for the Admin to find later.
    expect(transport.remove).toHaveBeenCalledOnce()
    expect((transport.remove.mock.lastCall?.[0] as { path: string }).path).toBe(
      `${LIVE_LOCATION_PATH}/${CONVO}/${GUEST}`,
    )
    expect(geo.watchers).toHaveLength(0)
    expect(latest?.phase).toBe('idle')
    expect(latest?.message).toBeNull()
  })

  it('ends the session when the tab is closed, which is the case the client cannot retry', async () => {
    mount()
    await chooseMinutes(document.body, 30)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await flush()

    expect(transport.updateDoc).toHaveBeenCalledOnce()
    expect(transport.updateDoc.mock.lastCall?.[1]).toMatchObject({ active: false })
  })

  it('closes the watch while the tab is hidden and reopens it when the Guest comes back', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()
    const firstWatch = geo.watchers[0].id

    // Browsers throttle a backgrounded watch and may suspend the permission, so
    // nothing is left half-running while the Guest is not looking.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(geo.cleared).toContain(firstWatch)
    expect(geo.watchers).toHaveLength(0)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(geo.watchers).toHaveLength(1)

    // And the reopened watch carries on from the same session: the sequence
    // continues, because the Admin is watching one walk, not two.
    vi.setSystemTime(T0 + 60_000)
    report(14.1009, 121.3)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(2)
    expect(lastFixOnTheWire().payload.seq).toBe(2)
  })

  it('ends the share rather than moving to another conversation with it still running', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()

    rerender({ convoId: 'booking-bk_test_88' })
    await flush()

    expect(latest?.session).toBeNull()
    expect(geo.watchers).toHaveLength(0)
    expect(transport.updateDoc).toHaveBeenCalled()
    expect(transport.updateDoc.mock.lastCall?.[1]).toMatchObject({ active: false })
  })
})

// ===========================================================================
// The refusals. A control that stays lit while nothing is being shared is the
// failure this feature is most afraid of: the Guest would believe the Admin can
// see them, and the Admin could not.
// ===========================================================================
describe('a share that is not happening never looks like one that is', () => {
  it('says permission was refused, and leaves the control available to retry', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    expect(transport.set).not.toHaveBeenCalled()

    failWith(1)
    await flush()

    expect(latest?.phase).toBe('error')
    expect(latest?.message).toMatch(/permission was refused/i)
    expect(latest?.message).toMatch(/nothing is being shared/i)
    expect(latest?.session).toBeNull()
    expect(geo.watchers).toHaveLength(0)
    expect(transport.set).not.toHaveBeenCalled()
    // The Guest is told in the control, not in a console: `role="alert"`.
    expect(where.querySelector('[role="alert"]')?.textContent).toMatch(/permission was refused/i)
    expect(findButton(where, /Live Location/i).disabled).toBe(false)
  })

  it('says a position could not be produced, which is not the last known position', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()
    expect(transport.set).toHaveBeenCalledTimes(1)

    failWith(2)
    await flush()

    expect(latest?.phase).toBe('error')
    expect(latest?.message).toMatch(/could not get a position/i)
    expect(latest?.message).toMatch(/nothing is being shared/i)
    expect(geo.watchers).toHaveLength(0)
    // The session is closed, so the Admin's gate is closed too.
    expect(transport.updateDoc.mock.lastCall?.[1]).toMatchObject({ active: false })
  })

  it('treats a dropped connection as the device\'s problem, and says the position is not updating', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    transport.set.mockRejectedValueOnce(new Error('network unavailable'))
    report(GATE.lat, GATE.lng)
    await flush()

    // Still sharing: the consent is open and the watch is running, so a Guest
    // who walks back into signal resumes rather than starting again.
    expect(latest?.phase).toBe('active')
    expect(latest?.offline).toBe(true)
    expect(geo.watchers).toHaveLength(1)
    expect(where.textContent).toMatch(/offline/i)
    expect(where.textContent).toMatch(/not updating/i)
    expect(transport.updateDoc).not.toHaveBeenCalled()

    // Coming back online is shown, not assumed.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await flush()
    expect(latest?.offline).toBe(false)
  })

  it('reads a server refusal as the end of the session, because that is what it is', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    transport.set.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    report(GATE.lat, GATE.lng)
    await flush()

    expect(latest?.phase).toBe('error')
    expect(latest?.message).toMatch(/server refused the update/i)
    expect(latest?.offline).toBe(false)
    expect(geo.watchers).toHaveLength(0)
    expect(transport.updateDoc.mock.lastCall?.[1]).toMatchObject({ active: false })
  })

  it('offers no control at all to a Guest who is signed out', async () => {
    const where = mount({ uid: undefined })
    await flush()

    expect(latest?.blocked).toBe('signed-out')
    expect(findButton(where, /Live Location/i).disabled).toBe(true)
    expect(where.textContent).toMatch(/Sharing is off until you choose a time/i)
  })

  it('sends nothing at all when there is no conversation to send it to', async () => {
    const where = mount({ convoId: null })
    act(() => findButton(where, /Live Location/i).click())
    await flush()
    act(() => findButton(where, /^30 minutes$/).click())
    await flush()

    expect(latest?.phase).toBe('error')
    expect(latest?.message).toMatch(/sign in/i)
    expect(transport.setDoc).not.toHaveBeenCalled()
    expect(transport.set).not.toHaveBeenCalled()
    expect(geo.watchers).toHaveLength(0)
  })
})

// ===========================================================================
// The hand-off. What the Guest's real publisher wrote, put through the gate the
// Admin's app renders through — the assertion that connects the two apps rather
// than trusting that two separately-tested halves agree.
// ===========================================================================
describe('what the Guest sends is what the Admin is allowed to draw', () => {
  /** Start a share through the UI and put one position on the wire. */
  async function shareAndMove(minutes: 15 | 30 | 60 = 30) {
    const where = mount()
    await chooseMinutes(where, minutes)
    report(GATE.lat, GATE.lng, 9)
    await flush()
    const session = latest?.session
    if (!session) throw new Error('the share never started')
    return { where, session, ...lastFixOnTheWire() }
  }

  it('accepts the payload the publisher actually wrote', async () => {
    const { session, payload, path } = await shareAndMove()

    const seen = checkFix(payload, session, T0 + 1_000)
    expect(seen.ok).toBe(true)
    if (seen.ok) {
      expect(seen.fix.lat).toBe(GATE.lat)
      expect(seen.fix.lng).toBe(GATE.lng)
      expect(seen.fix.accuracy_m).toBe(9)
      expect(seen.fix.seq).toBe(1)
    }
    // The Admin subscribes to the path the Guest wrote to, leaf by leaf.
    expect(path).toBe(`${LIVE_LOCATION_PATH}/${session.conversation_id}/${session.guest_uid}`)
  })

  it('accepts every fix of the walk, and each one replaces the last rather than joining it', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    const walk: Array<[number, number, number]> = [
      [T0, 14.1, 121.3],
      [T0 + 5_000, 14.1002, 121.3],
      [T0 + 12_000, 14.1005, 121.3004],
      [T0 + 20_000, 14.1009, 121.3009],
    ]
    for (const [at, lat, lng] of walk) {
      vi.setSystemTime(at)
      report(lat, lng)
      await flush()
    }

    expect(transport.set).toHaveBeenCalledTimes(walk.length)
    const session = latest!.session!
    // Every one of them is a position the Admin may draw, and the newest is the
    // one on screen: the node was overwritten each time, so there is no trail.
    const sequences = transport.set.mock.calls.map((call) => (call[1] as { seq: number }).seq)
    expect(sequences).toEqual([1, 2, 3, 4])
    for (const call of transport.set.mock.calls) {
      expect(checkFix(call[1], session, T0 + 21_000).ok).toBe(true)
      // Written to one path, so one node holds one position.
      expect((call[0] as { path: string }).path).toBe(`${LIVE_LOCATION_PATH}/${CONVO}/${GUEST}`)
    }
    const newest = checkFix(lastFixOnTheWire().payload, session, T0 + 21_000)
    expect(newest.ok && newest.fix.at_ms).toBe(T0 + 20_000)
  })

  it('refuses the same bytes the moment the Guest stops', async () => {
    const { where, session, payload } = await shareAndMove()

    expect(checkFix(payload, session, T0 + 1_000).ok).toBe(true)

    act(() => findButton(where, /^Stop Sharing$/i).click())
    await flush()

    // The node may still be on its way out; the gate is what closes it.
    const stopped: LocationSession = { ...session, active: false, expires_at_ms: T0 + 60_000 }
    const seen = checkFix(payload, stopped, T0 + 2_000)
    expect(seen).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses the same bytes when the window has closed, swept or not', async () => {
    const { session, payload } = await shareAndMove()

    const justBefore = checkFix(payload, session, session.expires_at_ms - 1)
    expect(justBefore.ok).toBe(true)
    const justAfter = checkFix(payload, session, session.expires_at_ms)
    expect(justAfter).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a node that is this position with somebody else\'s consent attached', async () => {
    const { session, payload } = await shareAndMove()

    // The three fields that bind a node to a consent, each broken in turn. A
    // node that fails any of them is inert whatever coordinate it carries.
    expect(checkFix({ ...payload, session_secret: 'b'.repeat(SESSION_SECRET_LENGTH) }, session, T0 + 1_000)).toEqual({
      ok: false,
      reason: 'secret',
    })
    expect(checkFix({ ...payload, guest_uid: 'guest-uid-somebody-else' }, session, T0 + 1_000)).toEqual({
      ok: false,
      reason: 'guest',
    })
    expect(checkFix({ ...payload, conversation_id: 'booking-bk_test_99' }, session, T0 + 1_000)).toEqual({
      ok: false,
      reason: 'conversation',
    })
    // And a second Guest sharing in a second conversation cannot be read
    // through the first one's consent.
    const otherResult = await startSharing({
      convoId: 'booking-bk_test_99',
      uid: 'guest-uid-pedro-77',
      minutes: 30,
      nowMs: T0,
    })
    if (!otherResult.ok) throw new Error(otherResult.reason)
    expect(otherResult.session.stream_secret).not.toBe(session.stream_secret)
    expect(checkFix(payload, otherResult.session, T0 + 1_000).ok).toBe(false)
  })

  it('refuses a fix stamped past a window, which is what a stale callback would send', async () => {
    const { session } = await shareAndMove()
    const late: Pick<LocationFix, 'lat' | 'lng' | 'accuracy_m' | 'seq'> = {
      lat: GATE.lat,
      lng: GATE.lng,
      accuracy_m: 9,
      seq: 2,
    }
    // The publisher refuses it before the rules have to.
    expect(await publishFix(session, late, session.expires_at_ms + 1)).toBe('stopped')
    expect(transport.set).toHaveBeenCalledTimes(1)
  })

  it('lets a Guest who stopped start again, and the Admin sees the new session only', async () => {
    const { where, session } = await shareAndMove()

    act(() => findButton(where, /^Stop Sharing$/i).click())
    await flush()
    // Only the restart's writes are interesting from here.
    transport.set.mockClear()
    transport.setDoc.mockClear()
    transport.deleteDoc.mockClear()

    // The restart the rules require: the ended consent is removed, a fresh one
    // is created, and the secret that binds the stream changes with it.
    transport.getDoc.mockResolvedValue({ exists: () => true })
    await chooseMinutes(where, 60)
    expect(transport.deleteDoc).toHaveBeenCalledOnce()
    expect(transport.setDoc).toHaveBeenCalledOnce()

    const restarted = latest!.session!
    expect(restarted.stream_secret).not.toBe(session.stream_secret)
    expect(restarted.duration_minutes).toBe(60)
    expect(restarted.expires_at_ms).toBe(T0 + MAX_SHARE_MINUTES * 60_000)

    report(GATE.lat + 0.001, GATE.lng)
    await flush()
    const { payload } = lastFixOnTheWire()
    expect(payload.session_secret).toBe(restarted.stream_secret)
    expect(checkFix(payload, restarted, T0 + 1_000).ok).toBe(true)
    // The old consent no longer authorises anything, so the position the Admin
    // draws is the new session's and cannot be read through the old one.
    expect(checkFix(payload, session, T0 + 1_000).ok).toBe(false)
  })

  it('keeps the longest window a Guest may choose inside the lease the rules enforce', async () => {
    const where = mount()
    await chooseMinutes(where, 60)
    report(GATE.lat, GATE.lng)
    await flush()

    const { payload } = lastFixOnTheWire()
    expect(payload.expires_at_ms).toBe(T0 + MAX_SHARE_MINUTES * 60_000)

    // `database.rules.json` refuses a fix whose window outlives the longest
    // share a Guest may start, so a client that asked for a day would be
    // refused on every single fix it sent. The two numbers are one number.
    const leaf = rtdbLeaf()
    expect(leaf['.validate']).toContain(`<= now + ${MAX_SHARE_MINUTES * 60_000}`)
  })
})

// ===========================================================================
// What the Guest's control says while all of this happens. Rendered, because a
// sentence that is only true in the state object is not a sentence the Guest
// read.
// ===========================================================================
describe('the Guest\'s control tells the truth about what is being sent', () => {
  it('offers three windows and says sharing is off until one is chosen', async () => {
    const where = mount()
    await flush()

    expect(where.textContent).toMatch(/Sharing is off until you choose a time/i)
    expect(where.textContent).toMatch(/stops on its own when it runs out/i)
    expect(where.querySelector('[role="status"]')).toBeNull()

    act(() => findButton(where, /Live Location/i).click())
    await flush()
    const choice = where.querySelector('[aria-label="Live location duration"]')
    expect(choice?.textContent).toContain('15 minutes')
    expect(choice?.textContent).toContain('30 minutes')
    expect(choice?.textContent).toContain('60 minutes')

    // Cancelling changes nothing: no consent, no watch, no position.
    act(() => findButton(where, /^Cancel$/i).click())
    await flush()
    expect(transport.setDoc).not.toHaveBeenCalled()
    expect(geo.watchers).toHaveLength(0)
    expect(latest?.phase).toBe('idle')
  })

  it('never claims the Admin can see the Guest before a position has gone out', async () => {
    const where = mount()
    await chooseMinutes(where, 30)

    // The session exists and the device has not reported yet. This is the state
    // where a control that said "Sharing live location" would be a lie.
    expect(latest?.phase).toBe('active')
    expect(latest?.lastSentAtMs).toBeNull()
    expect(where.textContent).toMatch(/Finding your location/i)
    expect(where.textContent).toMatch(/No position has been sent yet/i)
    expect(where.textContent).not.toMatch(/The Admin can see your location/i)

    report(GATE.lat, GATE.lng)
    await flush()

    expect(where.textContent).toMatch(/Sharing live location/i)
    expect(where.textContent).toMatch(/The Admin can see your location while this is on/i)
    expect(where.textContent).toMatch(/sending/i)
  })

  it('counts down on screen, and offers one way to stop', async () => {
    const where = mount()
    await chooseMinutes(where, 15)
    report(GATE.lat, GATE.lng)
    await flush()
    expect(where.textContent).toContain('Expires in:')
    expect(where.textContent).toContain('15:00')

    await flush(60_000)
    expect(where.textContent).toContain('14:00')
    expect([...where.querySelectorAll('button')].filter((b) => /Stop Sharing/i.test(b.textContent ?? ''))).toHaveLength(1)
  })
})

// ===========================================================================
// The two apps. The Admin's reader is Flutter (`lib/services/live_location_service.dart`)
// and this suite cannot run it, so the contract is pinned from both sides as
// text and as behaviour: the names, the paths, the numbers and the field lists
// the two implementations have to agree on for a position to travel between
// them. This is the block that would have caught `stream_secret` being read as
// `session_secret`, which made every valid session look foreign to the Admin.
// ===========================================================================
describe('the web Guest and the Flutter Admin are talking about the same thing', () => {
  /** The body of the Admin app's fix parser, as text. */
  function dartFixParser(): string {
    const start = dart.indexOf('static LiveFix? fromData')
    const end = dart.indexOf('class LiveLocationService', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return dart.slice(start, end)
  }

  /** The keys the Realtime Database's `.validate` requires of a fix. */
  function rulesRequiredKeys(): string[] {
    const leaf = rtdbLeaf()
    const required = leaf['.validate'].match(/hasChildren\(\[([^\]]+)\]/)
    if (!required) throw new Error('the rules no longer require a fix to have any particular shape')
    return required[1]
      .split(',')
      .map((field) => field.trim().replace(/'/g, ''))
      .sort()
  }

  it('names the two stores the same way in both apps', () => {
    expect(dart).toContain(`const String kLocationSessions = '${LOCATION_SESSIONS_COLLECTION}'`)
    expect(dart).toContain(`const String kLiveLocationPath = '${LIVE_LOCATION_PATH}'`)
  })

  it('subscribes the Admin to the leaf the Guest writes, and to no shallower node', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()
    const { path } = lastFixOnTheWire()

    expect(path.split('/')).toHaveLength(3)
    // `$kLiveLocationPath/$conversationId/$target` — the same three segments,
    // in the same order, built from the same two values.
    expect(dart).toContain(".ref('$kLiveLocationPath/$conversationId/$target')")
    expect(path).toBe(`${LIVE_LOCATION_PATH}/${CONVO}/${GUEST}`)
  })

  it('reads the consent under one field name and the fix under the other, in both apps', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()

    // Firestore calls it `stream_secret`; the ephemeral fix restates it as
    // `session_secret`. Mixing the two up is the bug this pins.
    expect(Object.keys(consentWritten())).toContain('stream_secret')
    expect(Object.keys(consentWritten())).not.toContain('session_secret')
    expect(Object.keys(lastFixOnTheWire().payload)).toContain('session_secret')
    expect(Object.keys(lastFixOnTheWire().payload)).not.toContain('stream_secret')
    expect(dart).toContain("final secret = data['stream_secret']")
    expect(dartFixParser()).toContain("raw['session_secret'] != session.streamSecret")
  })

  it('demands the same nine fields of a fix: publisher, gate, rules and Admin app', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()

    const published = Object.keys(lastFixOnTheWire().payload).sort()
    const parsedByAdmin = [...new Set([...dartFixParser().matchAll(/raw\['([a-z_]+)'\]/g)].map((m) => m[1]))].sort()

    expect(published).toEqual(rulesRequiredKeys())
    expect(parsedByAdmin).toEqual(published)
    // Behaviour, not only names: the gate accepts what the publisher wrote.
    expect(checkFix(lastFixOnTheWire().payload, latest!.session!, T0 + 1_000).ok).toBe(true)
  })

  it('forgives the same thirty seconds of clock skew, and refuses a fix from further ahead', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()
    const session = latest!.session!
    const payload = lastFixOnTheWire().payload as unknown as LocationFix

    expect(dart).toContain('now.add(const Duration(seconds: 30))')
    expect(checkFix({ ...payload, at_ms: T0 + 29_000 }, session, T0).ok).toBe(true)
    expect(checkFix({ ...payload, at_ms: T0 + 31_000 }, session, T0)).toEqual({ ok: false, reason: 'future' })
    // A fix stamped past the window is refused even while the window is open.
    expect(checkFix({ ...payload, at_ms: session.expires_at_ms + 1 }, session, T0)).toEqual({
      ok: false,
      reason: 'future',
    })
  })

  it('calls a position stale after the same twenty seconds, in both apps', () => {
    expect(dart).toContain('const Duration kStaleAfter = Duration(seconds: 20)')
    expect(STALE_AFTER_MS).toBe(20_000)
  })

  it('demands a secret of the same length the rules do', () => {
    expect(dart).toContain(`secret.length != ${SESSION_SECRET_LENGTH}`)
    expect(firestoreRules).toContain(`request.resource.data.stream_secret.size() == ${SESSION_SECRET_LENGTH}`)
    expect(SESSION_SECRET_LENGTH).toBe(32)
  })

  it('refuses a consent that carries a coordinate, with the same denylist in both apps', () => {
    // The Admin's reader refuses to draw from a consent that has a position in
    // it even if the rules were ever loosened, and it refuses the same shapes.
    const dartDenylist = dart
      .match(/const forbidden = <String>\[([^\]]+)\]/)?.[1]
      .split(',')
      .map((field) => field.trim().replace(/'/g, ''))
      .sort()
    const rulesDenylist = firestoreRules
      .slice(firestoreRules.indexOf('match /location_sessions/{sessionId}'))
      .match(/hasAny\(\[\s*([^\]]+)\]/)?.[1]
      .split(',')
      .map((field) => field.trim().replace(/'/g, ''))
      .sort()

    expect(dartDenylist).toEqual(rulesDenylist)
    expect(dartDenylist).toEqual(['fix', 'lat', 'latitude', 'lng', 'longitude', 'points', 'position', 'trail'])
  })

  it('sends a position the Realtime Database will accept, from inside the box it allows', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()
    const payload = lastFixOnTheWire().payload

    // The rules bound a position to the Philippines. A test fixture outside that
    // box would sail through `checkFix` and be refused by the server, which is
    // exactly the shape of a suite that passes while the feature is broken.
    const leaf = rtdbLeaf()
    const bounds = [...leaf['.validate'].matchAll(/child\('(lat|lng)'\)\.val\(\) (>=|<=) (-?[\d.]+)/g)].map((m) => ({
      field: m[1],
      limit: Number(m[3]),
      atLeast: m[2] === '>=',
    }))
    expect(bounds).toHaveLength(4)
    for (const bound of bounds) {
      const value = payload[bound.field] as number
      expect(bound.atLeast ? value >= bound.limit : value <= bound.limit).toBe(true)
    }

    // The writer is bound to the uid in the path, and the body restates it.
    expect(leaf['.write']).toContain('auth.uid == $guestUid')
    expect(payload.guest_uid).toBe(GUEST)
    expect(payload.conversation_id).toBe(CONVO)
  })

  it('leaves the Admin nothing to read once the window has closed', async () => {
    const where = mount()
    await chooseMinutes(where, 30)
    report(GATE.lat, GATE.lng)
    await flush()

    // Three mechanisms, and the rules are the one that is a guarantee: the node
    // is unreadable past `expires_at_ms` whether or not anything swept it.
    const leaf = rtdbLeaf()
    expect(leaf['.read']).toContain("data.child('expires_at_ms').val() > now")

    // The client's own two: an explicit remove on Stop, and the server-side
    // cleanup armed when the session opened.
    act(() => findButton(where, /^Stop Sharing$/i).click())
    await flush()
    expect(transport.remove).toHaveBeenCalledOnce()
    expect(transport.onDisconnectRemove).toHaveBeenCalledOnce()
    // And nothing anywhere appends: one node, one position, overwritten.
    for (const field of ['trail', 'points', 'history', 'track', 'path']) {
      expect(leaf['.validate']).toContain(`!newData.hasChild('${field}')`)
      expect(lastFixOnTheWire().payload).not.toHaveProperty(field)
    }
  })

  it('closes a session the same way from the hook as from the module', async () => {
    // `stopSharing` is called by the hook on Stop, on expiry, on pagehide and on
    // a conversation change. Whatever the trigger, the store sees one thing.
    await stopSharing({ convoId: CONVO, uid: GUEST, nowMs: T0 + 90_000 })
    const direct = transport.updateDoc.mock.lastCall?.[1]
    expect(direct).toMatchObject({ active: false, expires_at: new Date(T0 + 90_000) })
    expect(transport.remove).toHaveBeenCalledOnce()
  })
})
