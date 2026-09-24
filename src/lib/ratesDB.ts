// ----------------------------------------------------------------------------
// Published rates store — the document the Admin publishes so money can move
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One document at `site_config/rates`, in the `PublishedRates` shape
// `src/lib/booking/rates.ts` owns. The website only ever READS it: the Admin
// publishes the figures from the Rates screen of the mobile app (ADR-0007),
// which validates with the same rules `validatePublishedRates` spells out.
//
// Like cloudBookingsDB, this adapter falls back to localStorage when Firebase
// is not configured, so a demo Guest can be quoted from figures seeded under
// `LOCAL_RATES_KEY` in the same browser. The fallback is never removed (demo
// mode is a supported runtime, not a migration step).
//
// Enforcement lives in firestore.rules (`site_config`: public read, Admin
// write).
// ----------------------------------------------------------------------------

import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { validatePublishedRates, type PublishedRates } from './booking'

const COLLECTION = 'site_config'
const DOC_ID = 'rates'
/** Where demo mode keeps the published figures. Exported for local seeding. */
export const LOCAL_RATES_KEY = 'hdl:rates'
/** Fired on `window` whenever the local figures change. */
export const LOCAL_RATES_EVENT = 'hdl:rates-updated'

const isCloud = isFirebaseConfigured && Boolean(db)

function readLocal(): PublishedRates | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_RATES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    // A seeded document that fails the same validation the Admin app applies
    // is no published policy at all.
    if (validatePublishedRates(parsed).length > 0) return null
    return parsed as PublishedRates
  } catch {
    return null
  }
}

/**
 * The published figures, or null when the Admin has published nothing.
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
    const handler = () => callback(readLocal())
    if (!isCloud || !db) {
      handler()
      window.addEventListener(LOCAL_RATES_EVENT, handler)
      return () => window.removeEventListener(LOCAL_RATES_EVENT, handler)
    }
    const ref = doc(db, COLLECTION, DOC_ID)
    const unsub = onSnapshot(
      ref,
      (snap) => callback(snap.exists() ? (snap.data() as PublishedRates) : null),
      (err) => {
        console.error('[Rates] subscribe error', err)
        callback(readLocal())
      },
    )
    return () => unsub()
  },
}
