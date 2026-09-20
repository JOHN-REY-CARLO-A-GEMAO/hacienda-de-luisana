// ----------------------------------------------------------------------------
// Firestore Bookings Service
// Hacienda de LuisAna — Cloud persistence for bookings
// ----------------------------------------------------------------------------
// Falls back to localStorage (bookingsDB) when Firebase is not configured.
// Provides real-time listeners for admin dashboard.
// ----------------------------------------------------------------------------

import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { activityLogStorage, bookingsDB, type Booking } from './storage'
import {
  applyAction,
  instantOf,
  normalizeStatus,
  DATE_HOLD_MS,
  type ActionAccepted,
  type ActionRefused,
  type ActivityLogEntry,
  type Actor,
  type BookingAction,
} from './booking'

const COLLECTION = 'bookings'
/** Per-Booking Activity log: `bookings/{id}/activity`, append-only. */
const ACTIVITY_COLLECTION = 'activity'

type FirestoreBooking = Omit<Booking, 'created_at' | 'status'> & {
  created_at: any // serverTimestamp
  status: string
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
/**
 * The Date hold a Booking places on its dates when it is submitted: 24 hours out
 * (CONTEXT.md § Date hold). Stored as data, not kept in anybody's UI state.
 */
function initialHoldExpiry(now: string | number | Date = Date.now()): string {
  return new Date(new Date(now).getTime() + DATE_HOLD_MS).toISOString()
}

function mapDocToBooking(id: string, data: DocumentData): Booking {
  return {
    id,
    guest_name: data.guest_name,
    phone: data.phone,
    email: data.email,
    check_in: data.check_in,
    check_out: data.check_out,
    guests: data.guests,
    accommodation: data.accommodation,
    special_requests: data.special_requests || '',
    // Old documents are migrated on read: a stored `Confirmed` reads as
    // `Reserved`, and nothing is rewritten in Firestore (spec #9).
    status: normalizeStatus(data.status),
    created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || new Date().toISOString(),
    // Booking lifecycle v2 (additive — absent on Bookings stored before it)
    hold_expires_at: data.hold_expires_at ?? null,
    rejection_reason: data.rejection_reason ?? null,
    payment_plan: data.payment_plan,
    payment_status: data.payment_status,
    payment_proof_url: data.payment_proof_url ?? null,
    payment_reject_reason: data.payment_reject_reason ?? null,
    amount_claimed: typeof data.amount_claimed === 'number' ? data.amount_claimed : undefined,
    stay_total: typeof data.stay_total === 'number' ? data.stay_total : undefined,
    amount_due: typeof data.amount_due === 'number' ? data.amount_due : undefined,
    security_deposit: typeof data.security_deposit === 'number' ? data.security_deposit : undefined,
    balance_due: typeof data.balance_due === 'number' ? data.balance_due : undefined,
    amount_verified: typeof data.amount_verified === 'number' ? data.amount_verified : undefined,
    refund_status: data.refund_status,
    refund_total: typeof data.refund_total === 'number' ? data.refund_total : undefined,
    refund_breakdown: data.refund_breakdown ?? null,
    cancellation_reason: data.cancellation_reason ?? null,
    // P3 KYC (additive — absent on web-only bookings)
    ref_id: data.ref_id,
    uid: data.uid,
    source: data.source,
    kyc_status: data.kyc_status,
    kyc_id_url: data.kyc_id_url,
    kyc_receipt_url: data.kyc_receipt_url,
    kyc_reject_reason: data.kyc_reject_reason,
    eta_share_url: data.eta_share_url,
    pickup_lat: typeof data.pickup_lat === 'number' ? data.pickup_lat : undefined,
    pickup_lng: typeof data.pickup_lng === 'number' ? data.pickup_lng : undefined,
    pickup_updated_at: data.pickup_updated_at,
    pickup_label: data.pickup_label,
    pickup_area: data.pickup_area,
    distance_km: typeof data.distance_km === 'number' ? data.distance_km : undefined,
    eta_minutes: typeof data.eta_minutes === 'number' ? data.eta_minutes : undefined,
    is_live_sharing: Boolean(data.is_live_sharing),
    last_speed_kmh: typeof data.last_speed_kmh === 'number' ? data.last_speed_kmh : undefined,
  }
}

/**
 * The Activity log: every state change to a Booking, with its actor and
 * timestamp, in the order it happened.
 *
 * Append-only. The interface deliberately offers no update and no remove, so no
 * surface can rewrite history (CONTEXT.md § Activity log, ticket #11).
 */
export const activityLogDB = {
  async list(bookingId: string): Promise<ActivityLogEntry[]> {
    if (!isCloud || !db) return activityLogStorage.list(bookingId)
    try {
      const q = query(
        collection(db, COLLECTION, bookingId, ACTIVITY_COLLECTION),
        orderBy('at', 'asc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => d.data() as ActivityLogEntry)
    } catch (e) {
      console.warn('[Firestore] activity list() failed, falling back to local', e)
      return activityLogStorage.list(bookingId)
    }
  },

  async append(entries: readonly ActivityLogEntry[]): Promise<void> {
    if (entries.length === 0) return
    if (!isCloud || !db) {
      activityLogStorage.append(entries)
      return
    }
    try {
      await Promise.all(
        entries.map((entry) => addDoc(collection(db!, COLLECTION, entry.booking_id, ACTIVITY_COLLECTION), entry)),
      )
    } catch (e) {
      console.warn('[Firestore] activity append() failed, falling back to local', e)
      activityLogStorage.append(entries)
    }
  },
}

/**
 * The entry a Booking owes the moment it is created. Creation is a state change
 * like any other, so it is logged here rather than left to whichever screen
 * happened to submit the form (spec #9).
 */
function submissionEntry(bookingId: string, actor: Actor, at: string): ActivityLogEntry {
  return {
    booking_id: bookingId,
    action: 'Submit',
    from_status: 'Pending',
    to_status: 'Pending',
    actor: actor.actor,
    actor_id: actor.actor_id,
    ...(actor.actor_name ? { actor_name: actor.actor_name } : {}),
    at,
  }
}

const isCloud = isFirebaseConfigured && Boolean(db)

// ----------------------------------------------------------------------------
// Public API — mirrors bookingsDB but cloud-aware
// ----------------------------------------------------------------------------
export const cloudBookingsDB = {
  // Check if we should use Firestore
  get isCloud() {
    return isCloud
  },

  async get(id: string): Promise<Booking | undefined> {
    if (!isCloud || !db) return bookingsDB.get(id)
    try {
      const snap = await getDoc(doc(db, COLLECTION, id))
      return snap.exists() ? mapDocToBooking(snap.id, snap.data()) : undefined
    } catch (e) {
      console.warn('[Firestore] get() failed, falling back to local', e)
      return bookingsDB.get(id)
    }
  },

  async list(): Promise<Booking[]> {
    if (!this.isCloud || !db) {
      return bookingsDB.list()
    }
    try {
      const q = query(collection(db, COLLECTION), orderBy('created_at', 'desc'))
      const snap = await getDocs(q)
      return snap.docs.map((d) => mapDocToBooking(d.id, d.data()))
    } catch (e) {
      console.warn('[Firestore] list() failed, falling back to local', e)
      return bookingsDB.list()
    }
  },

  // Real-time subscription for admin page
  subscribe(callback: (bookings: Booking[]) => void, onError?: (e: any) => void): () => void {
    if (!this.isCloud || !db) {
      // Local fallback: poll localStorage via event
      const handler = () => callback(bookingsDB.list())
      handler()
      window.addEventListener('hdl:bookings-updated', handler)
      return () => window.removeEventListener('hdl:bookings-updated', handler)
    }

    const q = query(collection(db, COLLECTION), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        const list = snap.docs.map((d) => mapDocToBooking(d.id, d.data()))
        callback(list)
      },
      (err) => {
        console.error('[Firestore] subscribe error', err)
        onError?.(err)
        // Fallback to local on error
        callback(bookingsDB.list())
      }
    )
    return unsub
  },

  /**
   * Submit a Booking.
   *
   * Places the 24-hour Date hold on its dates as stored data, and writes the
   * Booking's first Activity log entry. The `actor` is whoever is submitting —
   * a Guest from /book — and defaults to an unnamed Guest.
   */
  async add(input: Omit<Booking, 'id' | 'status' | 'created_at'>, actor?: Actor): Promise<Booking> {
    const at = instantOf(actor ?? {})
    const holdExpiresAt = initialHoldExpiry(at)
    const withHold = { ...input, hold_expires_at: holdExpiresAt }

    if (!isCloud || !db) {
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      return booking
    }
    try {
      const payload: Omit<FirestoreBooking, 'id'> = {
        ...withHold,
        status: 'Pending',
        created_at: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, COLLECTION), payload)
      await activityLogDB.append([submissionEntry(ref.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      // Return optimistic booking
      return {
        id: ref.id,
        ...withHold,
        status: 'Pending',
        created_at: at,
      }
    } catch (e) {
      console.warn('[Firestore] add() failed, falling back to local', e)
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      return booking
    }
  },

  /**
   * Take one lifecycle action on a stored Booking.
   *
   * The rule lives in the lifecycle module, not here: this is the adapter that
   * loads the Booking, applies the action, stores the patch and appends the
   * Activity log entries the action owes. A refused action stores nothing and
   * logs nothing, so a Booking can never change state unlogged.
   */
  async transition(id: string, action: BookingAction, actor: Actor): Promise<ActionAccepted | ActionRefused> {
    const booking = await this.get(id)
    if (!booking) return { ok: false, reason: 'No Booking with that id.' }

    const result = applyAction(booking, action, actor)
    if (!result.ok) return result

    await this.update(id, result.patch)
    await activityLogDB.append(result.entries)
    return result
  },

  async update(id: string, patch: Partial<Booking>): Promise<void> {
    if (!this.isCloud || !db) {
      bookingsDB.update(id, patch)
      return
    }
    try {
      const ref = doc(db, COLLECTION, id)
      // Remove id from patch if present
      const { id: _omit, ...rest } = patch as any
      await updateDoc(ref, rest)
    } catch (e) {
      console.warn('[Firestore] update() failed, falling back to local', e)
      bookingsDB.update(id, patch)
    }
  },

  async remove(id: string): Promise<void> {
    if (!this.isCloud || !db) {
      bookingsDB.remove(id)
      return
    }
    try {
      await deleteDoc(doc(db, COLLECTION, id))
    } catch (e) {
      console.warn('[Firestore] remove() failed, falling back to local', e)
      bookingsDB.remove(id)
    }
  },
}
