// ----------------------------------------------------------------------------
// Published rates store — the document the Host publishes so money can move
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One document at `site_config/rates`, in the `PublishedRates` shape
// `src/lib/booking/rates.ts` owns. The validator runs before every write, so
// the check a publishing surface runs is the same check a test runs, and
// neither needs Firebase.
//
// Like cloudBookingsDB, this adapter falls back to localStorage when Firebase
// is not configured, so the demo Host can publish figures and the demo Guest
// can be quoted from them in the same browser. The fallback is never removed
// (demo mode is a supported runtime, not a migration step).
//
// Enforcement lives in firestore.rules (`site_config`: public read, Host
// write). This module is the courtesy half: it validates before it writes.
// ----------------------------------------------------------------------------

import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import {
  validatePublishedRates,
  type PublishedRates,
  type RatesProblem,
} from './booking'

const COLLECTION = 'site_config'
const DOC_ID = 'rates'
const KEY = 'hdl:rates'
const EVENT = 'hdl:rates-updated'

const isCloud = isFirebaseConfigured && Boolean(db)

export type RatesPublishResult =
  | { ok: true; doc: PublishedRates }
  | { ok: false; problems: RatesProblem[] }

function readLocal(): PublishedRates | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as PublishedRates
  } catch {
    return null
  }
}

function writeLocal(doc: PublishedRates): void {
  window.localStorage.setItem(KEY, JSON.stringify(doc))
  window.dispatchEvent(new Event(EVENT))
}

/**
 * The published figures, or null when the Host has published nothing.
 *
 * Null is not an error: a Booking chosen under no published policy carries
 * nulls and refunds nothing, which is what an unpublished policy amounts to.
 */
export const ratesDB = {
  get isCloud() {
    return isCloud
  },

  async get(): Promise<PublishedRates | null> {
    if (!isCloud || !db) return readLocal()
    try {
      const snap = await getDoc(doc(db, COLLECTION, DOC_ID))
      return snap.exists() ? (snap.data() as PublishedRates) : null
    } catch (e) {
      console.warn('[Rates] get() failed, falling back to local', e)
      return readLocal()
    }
  },

  /** The published figures, as they change. */
  subscribe(callback: (doc: PublishedRates | null) => void): () => void {
    // The local listener is always attached: in demo mode it is the only
    // source, and in cloud mode it carries fallback writes (a publish whose
    // cloud write never landed still notifies this browser).
    const handler = () => callback(readLocal())
    if (!isCloud || !db) {
      handler()
      window.addEventListener(EVENT, handler)
      return () => window.removeEventListener(EVENT, handler)
    }
    window.addEventListener(EVENT, handler)
    const ref = doc(db, COLLECTION, DOC_ID)
    const unsub = onSnapshot(
      ref,
      (snap) => callback(snap.exists() ? (snap.data() as PublishedRates) : null),
      (err) => {
        console.error('[Rates] subscribe error', err)
        callback(readLocal())
      },
    )
    return () => {
      window.removeEventListener(EVENT, handler)
      unsub()
    }
  },

  /**
   * Publish a new version of the figures.
   *
   * Refuses an invalid document rather than storing it: every problem is
   * returned in words the Host can act on. `knownAccommodationIds` flags
   * figures published for an Accommodation the site does not list.
   */
  async publish(
    candidate: unknown,
    knownAccommodationIds?: readonly string[],
  ): Promise<RatesPublishResult> {
    const problems = validatePublishedRates(candidate, knownAccommodationIds)
    if (problems.length > 0) return { ok: false, problems }
    const docToWrite = candidate as PublishedRates

    if (!isCloud || !db) {
      writeLocal(docToWrite)
      return { ok: true, doc: docToWrite }
    }
    try {
      await setDoc(doc(db, COLLECTION, DOC_ID), docToWrite)
      return { ok: true, doc: docToWrite }
    } catch (e) {
      // Same convention as the bookings adapter: a cloud write that never
      // landed falls back to local persistence rather than losing the Host's
      // published figures. The warn says where they went.
      console.warn('[Rates] publish() failed, falling back to local', e)
      writeLocal(docToWrite)
      return { ok: true, doc: docToWrite }
    }
  },

  /** Demo-mode helper: forget the locally published figures. */
  clearLocal(): void {
    try {
      window.localStorage.removeItem(KEY)
    } catch {
      // Storage unavailable: nothing to forget.
    }
    window.dispatchEvent(new Event(EVENT))
  },
}
