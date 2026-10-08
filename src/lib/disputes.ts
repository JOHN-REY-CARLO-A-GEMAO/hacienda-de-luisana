import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { db } from './firebase'

export interface DisputeRecord {
  id?: string
  booking_id: string
  guest_id: string
  category: string
  description: string
  evidence_urls?: string[]
  status: 'open' | 'under_review' | 'resolved' | 'rejected'
  created_at: string
  updated_at?: string
  admin_response?: string
  resolved_at?: string
  resolved_by?: string
}

export async function submitDispute({
  bookingId,
  guestId,
  category,
  description,
  evidenceUrls = [],
}: {
  bookingId: string
  guestId: string
  category: string
  description: string
  evidenceUrls?: string[]
}): Promise<{ ok: boolean; message?: string; id?: string }> {
  try {
    if (!db) {
      return { ok: false, message: 'Database connection unavailable.' }
    }

    const payload = {
      booking_id: bookingId,
      guest_id: guestId,
      category: category.trim(),
      description: description.trim(),
      evidence_urls: evidenceUrls,
      status: 'open',
      created_at: new Date().toISOString(),
    }

    const docRef = await addDoc(collection(db, 'disputes'), payload)
    return { ok: true, id: docRef.id }
  } catch (err) {
    console.error('Failed to submit dispute:', err)
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not submit dispute. Please try again.',
    }
  }
}

export async function getDisputesForBooking(bookingId: string, guestId: string): Promise<DisputeRecord[]> {
  try {
    if (!db) return []

    const q = query(
      collection(db, 'disputes'),
      where('booking_id', '==', bookingId),
      where('guest_id', '==', guestId)
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        booking_id: data.booking_id ?? bookingId,
        guest_id: data.guest_id ?? guestId,
        category: data.category ?? 'General Concern',
        description: data.description ?? '',
        evidence_urls: data.evidence_urls ?? [],
        status: data.status ?? 'open',
        created_at: data.created_at ?? new Date().toISOString(),
        admin_response: data.admin_response,
        resolved_at: data.resolved_at,
        resolved_by: data.resolved_by,
      } as DisputeRecord
    })
  } catch (err) {
    console.error('Failed to fetch disputes:', err)
    return []
  }
}
