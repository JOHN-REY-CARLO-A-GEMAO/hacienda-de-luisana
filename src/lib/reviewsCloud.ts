import { doc, getDoc, setDoc } from 'firebase/firestore'
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

/**
 * The document a Review lives under: the Booking it is about.
 *
 * One Review per stay is a fact of the data model, not a check somebody has to
 * remember to run — and it is what lets `firestore.rules` read the Booking a
 * Review claims to be about (that it is the author's, and that the stay is
 * over) before accepting the write. The app and the rule have to agree on the
 * id for that to work, so the id lives here, in one place.
 */
export const reviewDocId = (bookingId: string): string => bookingId

/** The document a Review is written as. */
export function reviewRecordFor(input: {
  bookingId: string
  uid: string
  stars: number
  text: string
  createdAt?: string
}): ReviewRecord {
  return {
    booking_id: input.bookingId,
    uid: input.uid,
    stars: input.stars,
    text: input.text.trim() || undefined,
    created_at: input.createdAt ?? new Date().toISOString(),
  }
}

export async function getReviewForBooking(bookingId: string, uid: string): Promise<ReviewRecord | null> {
  if (isFirebaseConfigured && db) {
    // One read, by the id the Review is stored under. The rule opens this read
    // only to the author (or the Admin), so a Review found here is this Guest's.
    const snap = await getDoc(doc(db, 'reviews', reviewDocId(bookingId)))
    if (!snap.exists()) return null
    const data = snap.data() as Omit<ReviewRecord, 'id'>
    if (data.uid !== uid) return null
    return { id: snap.id, ...data }
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

  const record = reviewRecordFor(input)

  if (isFirebaseConfigured && db) {
    // `setDoc` at the Booking's id: a stay that already has a Review has a
    // document there, and the rule refuses to overwrite it (updates are closed),
    // so the duplicate check above and the database agree.
    await setDoc(doc(db, 'reviews', reviewDocId(input.bookingId)), record)
    return { ok: true }
  }
  localStorage.setItem(KEY(input.bookingId), JSON.stringify(record))
  return { ok: true }
}
