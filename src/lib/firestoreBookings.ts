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
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { bookingsDB, type Booking, type BookingStatus } from './storage'

const COLLECTION = 'bookings'

type FirestoreBooking = Omit<Booking, 'created_at'> & {
  created_at: any // serverTimestamp
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
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
    status: data.status as BookingStatus,
    created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || new Date().toISOString(),
  }
}

// ----------------------------------------------------------------------------
// Public API — mirrors bookingsDB but cloud-aware
// ----------------------------------------------------------------------------
export const cloudBookingsDB = {
  // Check if we should use Firestore
  get isCloud() {
    return isFirebaseConfigured && Boolean(db)
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

  async add(input: Omit<Booking, 'id' | 'status' | 'created_at'>): Promise<Booking> {
    if (!this.isCloud || !db) {
      return bookingsDB.add(input)
    }
    try {
      const payload: Omit<FirestoreBooking, 'id'> = {
        ...input,
        status: 'Pending',
        created_at: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, COLLECTION), payload)
      // Return optimistic booking
      return {
        id: ref.id,
        ...input,
        status: 'Pending',
        created_at: new Date().toISOString(),
      }
    } catch (e) {
      console.warn('[Firestore] add() failed, falling back to local', e)
      return bookingsDB.add(input)
    }
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
