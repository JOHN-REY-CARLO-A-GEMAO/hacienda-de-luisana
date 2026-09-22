// ----------------------------------------------------------------------------
// Tracking Sessions — where live location lives (G6)
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Live location no longer rides on the Booking. A Booking is a promise about a
// future stay; a location is a fact about the present moment. They have
// different writers, different lifetimes and different rules, so they live in
// different documents.
//
// One session per booking, at `tracking_sessions/{bookingId}`:
//   - CREATE is the Share click. The consent timestamp goes in the same write
//     as the first position — a position without a consent in the same
//     document is not a position the rules accept, and this module never
//     writes one. (firestore.rules: the six keys are required, and the uid is
//     the traveller's own.)
//   - UPDATE is a coordinate ping. The consent and the identity are immutable
//     after the create — even the traveller cannot move them, which is what
//     keeps "sharing" from quietly becoming "always watching".
//   - DELETE is stopping the share: the traveller may delete their own
//     session, and the Host may delete any. The read surfaces treat a session
//     older than 30 days as nonexistent; the Host's delete is the physical
//     erasure, because there is no backend worker to do it.
//
// Like cloudBookingsDB, this adapter falls back to localStorage when Firebase
// is not configured, so the demo shows the same screens.
// ----------------------------------------------------------------------------
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'

export type TrackingSession = {
  /** The session id IS the booking id: one active session per booking. */
  id: string
  bookingId: string
  uid: string
  /** When the traveller clicked Share. Written once, at create, and then immutable. */
  tracking_consent_at: string
  latitude: number
  longitude: number
  /** The last time the traveller's position was written. */
  lastUpdated: string
  // Derived fields the traveller refreshes with each ping; absent until the
  // first ping that computes them.
  area?: string
  label?: string
  distance_km?: number
  eta_minutes?: number
  last_speed_kmh?: number
  eta_share_url?: string
}

const COLLECTION = 'tracking_sessions'
const KEY = 'hdl:tracking_sessions'
const EVENT = 'hdl:sessions-updated'

// ----------------------------------------------------------------------------
// Local fallback (demo mode)
// ----------------------------------------------------------------------------
/** The demo radar is not empty: two of the sample bookers are on their way. */
function generateSampleSessions(): TrackingSession[] {
  const minsAgo = (m: number) => new Date(Date.now() - 1000 * 60 * m).toISOString()
  return [
    {
      id: 'book-sample-1',
      bookingId: 'book-sample-1',
      uid: 'demo-guest-1',
      tracking_consent_at: minsAgo(32),
      latitude: 14.185,
      longitude: 121.515,
      lastUpdated: minsAgo(3),
      area: 'Luisiana Town Proper (~2.4 km away)',
      distance_km: 2.4,
      eta_minutes: 6,
    },
    {
      id: 'book-sample-2',
      bookingId: 'book-sample-2',
      uid: 'demo-guest-2',
      tracking_consent_at: minsAgo(40),
      latitude: 14.215,
      longitude: 121.505,
      lastUpdated: minsAgo(15),
      area: 'Cavinti - Luisiana Road (~8.2 km away)',
      distance_km: 8.2,
      eta_minutes: 16,
    },
  ]
}

function readAll(): TrackingSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      const initial = generateSampleSessions()
      window.localStorage.setItem(KEY, JSON.stringify(initial))
      return initial
    }
    return JSON.parse(raw) as TrackingSession[]
  } catch {
    return generateSampleSessions()
  }
}

function writeAll(list: TrackingSession[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent(EVENT))
}

// ----------------------------------------------------------------------------
// Cloud adapter
// ----------------------------------------------------------------------------
const isCloud = isFirebaseConfigured && Boolean(db)

function mapDocToSession(id: string, data: DocumentData): TrackingSession {
  return {
    id,
    bookingId: data.bookingId,
    uid: data.uid,
    tracking_consent_at: data.tracking_consent_at,
    latitude: data.latitude,
    longitude: data.longitude,
    lastUpdated: data.lastUpdated,
    area: data.area,
    label: data.label,
    distance_km: typeof data.distance_km === 'number' ? data.distance_km : undefined,
    eta_minutes: typeof data.eta_minutes === 'number' ? data.eta_minutes : undefined,
    last_speed_kmh: typeof data.last_speed_kmh === 'number' ? data.last_speed_kmh : undefined,
    eta_share_url: data.eta_share_url,
  }
}

/**
 * The keys a coordinate ping may touch. The consent and the identity are not
 * among them — not by convention but by rule, and this adapter refuses to try
 * writing them so a demo-mode call cannot be ported to cloud and refused there.
 */
type PingPatch = Partial<Omit<TrackingSession, 'id' | 'bookingId' | 'uid' | 'tracking_consent_at'>>
const PING_KEYS: (keyof PingPatch)[] = [
  'latitude',
  'longitude',
  'lastUpdated',
  'area',
  'label',
  'distance_km',
  'eta_minutes',
  'last_speed_kmh',
  'eta_share_url',
]

export const trackingSessionsDB = {
  get isCloud() {
    return isCloud
  },

  /** All active sessions. Host and Staff surfaces only — the rules refuse this to a Guest. */
  async list(): Promise<TrackingSession[]> {
    if (!isCloud || !db) return readAll()
    try {
      const snap = await getDocs(collection(db, COLLECTION))
      return snap.docs.map((d) => mapDocToSession(d.id, d.data()))
    } catch (e) {
      console.warn('[Tracking] list() failed, falling back to local', e)
      return readAll()
    }
  },

  /** This traveller's own session — the one document the rules let a Guest read. */
  async mine(uid: string | null | undefined): Promise<TrackingSession | undefined> {
    if (!uid) return undefined
    if (!isCloud || !db) return readAll().find((s) => s.uid === uid)
    try {
      const q = query(collection(db, COLLECTION), where('uid', '==', uid))
      const snap = await getDocs(q)
      return snap.docs.length ? mapDocToSession(snap.docs[0].id, snap.docs[0].data()) : undefined
    } catch (e) {
      console.warn('[Tracking] mine() failed, falling back to local', e)
      return readAll().find((s) => s.uid === uid)
    }
  },

  /** The session for one booking, if the traveller is sharing right now. */
  async forBooking(bookingId: string): Promise<TrackingSession | undefined> {
    if (!isCloud || !db) return readAll().find((s) => s.bookingId === bookingId)
    try {
      const snap = await getDoc(doc(db, COLLECTION, bookingId))
      return snap.exists() ? mapDocToSession(snap.id, snap.data()) : undefined
    } catch (e) {
      console.warn('[Tracking] forBooking() failed, falling back to local', e)
      return readAll().find((s) => s.bookingId === bookingId)
    }
  },

  /** Every session, as they change. For the Host's radar — refused by the rules for a Guest. */
  subscribe(callback: (sessions: TrackingSession[]) => void, onError?: (e: any) => void): () => void {
    if (!isCloud || !db) {
      const handler = () => callback(readAll())
      handler()
      window.addEventListener(EVENT, handler)
      return () => window.removeEventListener(EVENT, handler)
    }
    const unsub = onSnapshot(
      collection(db, COLLECTION),
      (snap: QuerySnapshot<DocumentData>) => {
        callback(snap.docs.map((d) => mapDocToSession(d.id, d.data())))
      },
      (err) => {
        console.error('[Tracking] subscribe error', err)
        onError?.(err)
        callback(readAll())
      },
    )
    return unsub
  },

  /** The traveller's own session, as it changes. */
  subscribeMine(uid: string | null | undefined, callback: (session: TrackingSession | undefined) => void, onError?: (e: any) => void): () => void {
    if (!uid) {
      callback(undefined)
      return () => {}
    }
    if (!isCloud || !db) {
      const handler = () => callback(readAll().find((s) => s.uid === uid))
      handler()
      window.addEventListener(EVENT, handler)
      return () => window.removeEventListener(EVENT, handler)
    }
    const q = query(collection(db, COLLECTION), where('uid', '==', uid))
    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        callback(snap.docs.length ? mapDocToSession(snap.docs[0].id, snap.docs[0].data()) : undefined)
      },
      (err) => {
        console.error('[Tracking] subscribeMine error', err)
        onError?.(err)
        callback(readAll().find((s) => s.uid === uid))
      },
    )
    return unsub
  },

  /**
   * The Share click: consent and first position in the same write.
   *
   * If the booking already has a session (the traveller paused and resumed),
   * the original consent stays — this write only refreshes the position,
   * because the rules would refuse an update that touches the consent.
   */
  async create(input: Omit<TrackingSession, 'id'>): Promise<TrackingSession> {
    if (!isCloud || !db) {
      const session: TrackingSession = { id: input.bookingId, ...input }
      const list = readAll().filter((s) => s.bookingId !== input.bookingId)
      writeAll([session, ...list])
      return session
    }
    try {
      const ref = doc(db, COLLECTION, input.bookingId)
      const existing = await getDoc(ref)
      if (existing.exists()) {
        // Resume: the consent is the one from the original Share click.
        const ping = Object.fromEntries(
          PING_KEYS.map((k) => [k, input[k]]).filter(([, v]) => v !== undefined),
        )
        await updateDoc(ref, ping)
        return mapDocToSession(input.bookingId, { ...existing.data(), ...ping })
      }
      await setDoc(ref, { ...input })
      return mapDocToSession(input.bookingId, input)
    } catch (e) {
      console.warn('[Tracking] create() failed, falling back to local', e)
      const session: TrackingSession = { id: input.bookingId, ...input }
      const list = readAll().filter((s) => s.bookingId !== input.bookingId)
      writeAll([session, ...list])
      return session
    }
  },

  /** A coordinate ping on an existing session. Never touches the consent or the identity. */
  async update(bookingId: string, patch: Partial<TrackingSession>): Promise<void> {
    const ping: Record<string, unknown> = {}
    for (const key of PING_KEYS) {
      const value = (patch as any)[key]
      if (value !== undefined) ping[key] = value
    }
    if (Object.keys(ping).length === 0) return

    if (!isCloud || !db) {
      writeAll(readAll().map((s) => (s.bookingId === bookingId ? { ...s, ...ping } : s)))
      return
    }
    try {
      await updateDoc(doc(db, COLLECTION, bookingId), ping)
    } catch (e) {
      console.warn('[Tracking] update() failed, falling back to local', e)
      writeAll(readAll().map((s) => (s.bookingId === bookingId ? { ...s, ...ping } : s)))
    }
  },

  /** Stopping the share. The traveller deletes their own; the Host may delete any. */
  async remove(bookingId: string): Promise<void> {
    if (!isCloud || !db) {
      writeAll(readAll().filter((s) => s.bookingId !== bookingId))
      return
    }
    try {
      await deleteDoc(doc(db, COLLECTION, bookingId))
    } catch (e) {
      console.warn('[Tracking] remove() failed, falling back to local', e)
      writeAll(readAll().filter((s) => s.bookingId !== bookingId))
    }
  },
}

/**
 * A session the read surfaces should treat as nonexistent: its last ping is
 * more than 30 days old. There is no backend worker to purge it, so freshness
 * is checked where the session is read, and the Host's delete remains the
 * physical erasure (G6).
 */
export function sessionIsStale(session: TrackingSession, now: string | number | Date = Date.now()): boolean {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime()
  const t = new Date(session.lastUpdated).getTime()
  if (Number.isNaN(t)) return true
  return nowMs - t > 30 * 24 * 60 * 60 * 1000
}
