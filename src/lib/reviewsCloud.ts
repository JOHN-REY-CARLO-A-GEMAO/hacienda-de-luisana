import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { REVIEW_MAX, validateStarRating } from './validation'

export type ReviewRecord = {
  id?: string
  booking_id: string
  uid: string
  stars: number
  text?: string
  created_at: string
}

const KEY = (bookingId: string) => `hdl:review:${bookingId}`

export async function getReviewForBooking(bookingId: string, uid: string): Promise<ReviewRecord | null> {
  if (isFirebaseConfigured && db) {
    const q = query(collection(db, 'reviews'), where('booking_id', '==', bookingId), where('uid', '==', uid))
    const snap = await getDocs(q)
    const doc = snap.docs[0]
    if (!doc) return null
    return { id: doc.id, ...(doc.data() as Omit<ReviewRecord, 'id'>) }
  }
  try {
    const raw = localStorage.getItem(KEY(bookingId))
    return raw ? (JSON.parse(raw) as ReviewRecord) : null
  } catch {
    return null
  }
}

export async function submitReview(input: {
  bookingId: string
  uid: string
  stars: number
  text: string
  bookingStatus: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!['Checked-Out', 'Completed'].includes(input.bookingStatus)) {
    return { ok: false, message: 'You can rate a stay only after check-out.' }
  }
  const stars = validateStarRating(input.stars)
  if (!stars.ok) return { ok: false, message: stars.message }
  if (input.text.length > REVIEW_MAX) return { ok: false, message: `Review must be at most ${REVIEW_MAX} characters` }

  const existing = await getReviewForBooking(input.bookingId, input.uid)
  if (existing) return { ok: false, message: 'You already reviewed this stay.' }

  const record: ReviewRecord = {
    booking_id: input.bookingId,
    uid: input.uid,
    stars: input.stars,
    text: input.text.trim() || undefined,
    created_at: new Date().toISOString(),
  }

  if (isFirebaseConfigured && db) {
    await addDoc(collection(db, 'reviews'), record)
    return { ok: true }
  }
  localStorage.setItem(KEY(input.bookingId), JSON.stringify(record))
  return { ok: true }
}
