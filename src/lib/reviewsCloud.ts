import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as limitQuery,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { activityLogDB } from './firestoreBookings'
import type { ActivityLogEntry, ReviewActionType } from './booking'
import { REVIEW_MAX, validateStarRating } from './validation'
import {
  REVIEW_CATEGORIES,
  REVIEW_EDIT_WINDOW_DAYS,
  canEditReview,
  editWindowClosesAt,
  isReviewableStatus,
  isReviewStatus,
  sanitizePublicReview,
  summarize,
  type PublicReview,
  type ReviewCategories,
  type ReviewCategoryKey,
  type ReviewStatus,
  type ReviewSummary,
} from './reviewPolicy'

/**
 * Reviews, as the website stores and reads them.
 *
 * Vocabulary: CONTEXT.md § Review. Enforcement: `firestore.rules`, whose suite
 * is `test/rules/firestore-rules.test.ts`. The decisions — which statuses open
 * the form, how long the Guest may correct themselves, what a visitor may read
 * — live in `reviewPolicy.ts`, so the app, the Admin app's mirrored copy and the
 * rules all answer from one list.
 *
 * The document id is still the Booking id. That is not a convenience: "one
 * Review per stay" has to be something the database enforces, and the only way
 * to enforce it without a transaction is for the second one to be trying to
 * write a document that already exists.
 */

// ----------------------------------------------------------------------------
// The stored document
// ----------------------------------------------------------------------------

export type ReviewRecord = {
  id?: string
  /** The Booking this is about — and the id this document is filed under. */
  booking_id: string
  /** The Guest who stayed. Never published (ADR-0014). */
  uid: string
  /** The overall rating, 1..5. The answer; the categories are the detail. */
  stars: number
  /** What they wrote, trimmed. Optional: a rating on its own is a review. */
  text?: string
  created_at: string
  updated_at?: string
  /** `pending` on arrival — the Admin decides whether it is seen (ADR-0014). */
  status: ReviewStatus
  /**
   * The instant the edit window shuts, as an ISO string.
   *
   * A number of days would be simpler to read and useless to enforce:
   * `firestore.rules` compares this field against its own clock, so it has to
   * be a real instant, and it is written as a `Timestamp` on the way to
   * Firestore. A Guest cannot claim a fortnight that runs until next year,
   * because the rule recomputes the value and refuses any other.
   */
  edit_until: string
  cleanliness?: number
  accommodation?: number
  communication?: number
  value?: number
  /** The Admin's reply, kept beside the review rather than in a thread. */
  admin_response?: string
  admin_response_at?: string
  admin_response_by?: string
  moderated_at?: string
  moderated_by?: string
  published_at?: string
}

/** What a create is given, and what a stored document is read back as. */
export type ReviewInput = {
  bookingId: string
  uid: string
  stars: number
  text: string
  categories?: ReviewCategories
}

/**
 * What a submission is given.
 *
 * The Booking status is here and not in `ReviewInput` because it decides
 * whether a Review may be written at all, and a document builder that is handed
 * a status it ignores is a builder whose callers stop checking it themselves.
 */
export type ReviewSubmission = ReviewInput & { bookingStatus: string }

// ----------------------------------------------------------------------------
// Where each kind of review is kept in this browser (demo mode)
// ----------------------------------------------------------------------------

const KEY = (bookingId: string) => `hdl:review:${bookingId}`
const PUBLIC_KEY = 'hdl:public-reviews'

/** How many testimonials the public page shows. A page, not an archive. */
export const PUBLIC_REVIEW_PAGE_SIZE = 6

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

// ----------------------------------------------------------------------------
// Timestamps
// ----------------------------------------------------------------------------

/**
 * Read a stored instant as an ISO string, whichever shape it was written in.
 *
 * `created_at` has always been a string, written by the app, and it stays one:
 * changing it to a server timestamp would be a migration of a document the
 * Guest wrote and cannot be asked to write again. `edit_until` is new and is a
 * real `Timestamp` in the cloud, because the rules compare it to their clock.
 */
function instantOf(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === 'string') return value
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.()
  if (typeof millis === 'number') return new Date(millis).toISOString()
  const date = (value as { toDate?: () => Date } | null)?.toDate?.()
  if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  return fallback
}

const DAY_MS = 86_400_000

/**
 * The Review as Firestore stores it.
 *
 * Two things change on the way out: `edit_until` becomes a `Timestamp`, because
 * the rule compares it with `request.time` and a string cannot be compared with
 * a clock; and the in-memory `id` — the document's own address, which Firestore
 * already knows — is dropped rather than written as an `undefined` field, which
 * the SDK refuses outright.
 */
function toFirestore(record: ReviewRecord): DocumentData {
  const { id: _id, edit_until, ...rest } = record
  return { ...rest, edit_until: Timestamp.fromDate(new Date(edit_until)) }
}

// ----------------------------------------------------------------------------
// Building and checking
// ----------------------------------------------------------------------------

/** The categories a Guest answered, with every answered one checked. */
function checkedCategories(categories: ReviewCategories | undefined): { ok: true; value: ReviewCategories } | { ok: false; message: string } {
  const value: ReviewCategories = {}
  for (const { key, label } of REVIEW_CATEGORIES) {
    const stars = categories?.[key]
    if (stars === undefined || stars === null) continue
    const checked = validateStarRating(stars)
    if (!checked.ok) return { ok: false, message: `${label}: ${checked.message}` }
    value[key] = stars
  }
  return { ok: true, value }
}

/**
 * The document a Review is written as.
 *
 * The written part is trimmed and dropped when nothing is left, so a field of
 * spaces never reaches storage. `status` is `pending` because a Review waits
 * for the Admin before it is seen, and `edit_until` is a real timestamp the
 * rules recompute — a client that sent anything else is refused.
 */
export function reviewRecordFor(
  input: ReviewInput,
  options: { createdAt?: string; now?: number } = {},
): ReviewRecord {
  const now = options.now ?? Date.now()
  const text = input.text.trim()
  const record: ReviewRecord = {
    booking_id: input.bookingId,
    uid: input.uid,
    stars: input.stars,
    created_at: options.createdAt ?? new Date(now).toISOString(),
    status: 'pending',
    edit_until: new Date(now + REVIEW_EDIT_WINDOW_DAYS * DAY_MS).toISOString(),
  }
  if (text) record.text = text
  for (const { key } of REVIEW_CATEGORIES) {
    const stars = input.categories?.[key]
    if (stars !== undefined && stars !== null) record[key as ReviewCategoryKey] = stars
  }
  return record
}

/** A stored Firestore document as a `ReviewRecord`, whatever shape it arrived in. */
function mapReview(id: string, data: DocumentData): ReviewRecord {
  return { ...(data as Omit<ReviewRecord, 'id'>), id, status: isReviewStatus(data.status) ? data.status : 'pending' }
}

// ----------------------------------------------------------------------------
// Reading
// ----------------------------------------------------------------------------

/**
 * The Review a Guest wrote about one of their stays, if they did.
 *
 * One read, by the id the Review is stored under. The rule opens this read
 * only to the author (or the Admin), so a Review found here is this Guest's —
 * and the `uid` check below is the same statement made twice, which is what
 * lets demo mode answer the same question with no rules at all.
 */
export async function getReviewForBooking(bookingId: string, uid: string): Promise<ReviewRecord | null> {
  if (isFirebaseConfigured && db) {
    const snap = await getDoc(doc(db, 'reviews', reviewDocId(bookingId)))
    if (!snap.exists()) return null
    const record = mapReview(snap.id, snap.data())
    if (record.uid !== uid) return null
    return record
  }
  try {
    const raw = localStorage.getItem(KEY(bookingId))
    if (!raw) return null
    const record = JSON.parse(raw) as ReviewRecord
    return record.uid === uid ? record : null
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// Writing
// ----------------------------------------------------------------------------

/**
 * Submit the Review for a stay.
 *
 * Three refusals before anything is stored, each of which the rules make again:
 * the stay has to be over, the rating has to be a rating, and there must not
 * already be a Review for that Booking. The duplicate check is the courtesy —
 * the id being the Booking id is the enforcement, because a second write at
 * that id is an update, and the rules only let a Guest update a Review they
 * wrote, inside the window, to correct it.
 */
export async function submitReview(input: ReviewSubmission): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isReviewableStatus(input.bookingStatus)) {
    return { ok: false, message: 'You can rate a stay only after you have checked out.' }
  }
  const stars = validateStarRating(input.stars)
  if (!stars.ok) return { ok: false, message: stars.message }
  const categories = checkedCategories(input.categories)
  if (!categories.ok) return { ok: false, message: categories.message }
  if (input.text.trim().length > REVIEW_MAX) {
    return { ok: false, message: `Review must be at most ${REVIEW_MAX} characters` }
  }

  const existing = await getReviewForBooking(input.bookingId, input.uid)
  if (existing) return { ok: false, message: 'You already reviewed this stay.' }

  const record = reviewRecordFor({ ...input, text: input.text, categories: categories.value })

  if (isFirebaseConfigured && db) {
    await setDoc(doc(db, 'reviews', reviewDocId(input.bookingId)), toFirestore(record))
  } else {
    localStorage.setItem(KEY(input.bookingId), JSON.stringify(record))
  }
  await recordActivity(input.bookingId, 'ReviewSubmitted', 'pending', 'guest', input.uid)
  return { ok: true }
}

/**
 * Put a Review's change on the Booking's own Activity log.
 *
 * The Booking is the thing the entry is about — `booking_id` is already the
 * Review's document id — so the review appears on the same timeline as the stay
 * it describes rather than in a log of its own that nobody would read. The
 * rules sign the entry to whoever wrote it, so this records what happened, not
 * a claim about who; if it is refused, the review itself is still filed and the
 * guest is not told the two had failed together.
 */
async function recordActivity(
  bookingId: string,
  action: ReviewActionType,
  toStatus: ReviewStatus,
  actor: 'guest' | 'admin',
  actorId: string,
  fromStatus = 'none',
): Promise<void> {
  const entry: ActivityLogEntry = {
    booking_id: bookingId,
    action,
    from_status: fromStatus,
    to_status: toStatus,
    actor,
    actor_id: actorId,
    at: new Date().toISOString(),
  }
  try {
    await activityLogDB.append([entry])
  } catch {
    // The log is the record of what happened, not a condition of it happening.
  }
}

/**
 * Correct a Review the Guest wrote.
 *
 * The window is `canEditReview`'s, and it is measured from the instant the
 * Review was first written — not from this edit, so correcting yourself does
 * not buy another fortnight. Only the words and the ratings move: the status,
 * the Admin's reply and the moderation are not the Guest's fields, and the
 * rules close the same door.
 */
export async function updateReview(input: {
  bookingId: string
  uid: string
  stars?: number
  text?: string
  categories?: ReviewCategories
  now?: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await getReviewForBooking(input.bookingId, input.uid)
  if (!existing) return { ok: false, message: 'There is no review of this stay to change.' }
  if (!canEditReview(existing, input.now ?? Date.now())) {
    return {
      ok: false,
      message: `You can change a review for ${REVIEW_EDIT_WINDOW_DAYS} days after writing it. This one is closed.`,
    }
  }
  if (input.stars !== undefined) {
    const stars = validateStarRating(input.stars)
    if (!stars.ok) return { ok: false, message: stars.message }
    existing.stars = input.stars
  }
  if (input.text !== undefined) {
    const text = input.text.trim()
    if (text.length > REVIEW_MAX) return { ok: false, message: `Review must be at most ${REVIEW_MAX} characters` }
    if (text) existing.text = text
    else delete existing.text
  }
  if (input.categories) {
    const categories = checkedCategories(input.categories)
    if (!categories.ok) return { ok: false, message: categories.message }
    for (const { key } of REVIEW_CATEGORIES) {
      const stars = input.categories[key]
      if (stars === undefined || stars === null) delete existing[key as ReviewCategoryKey]
      else existing[key as ReviewCategoryKey] = stars
    }
  }
  existing.updated_at = new Date(input.now ?? Date.now()).toISOString()

  if (isFirebaseConfigured && db) {
    // Only the keys a Guest may move. The rules would refuse the rest anyway,
    // but sending them turns a legitimate correction into an error the form has
    // to explain.
    const patch: DocumentData = { stars: existing.stars, updated_at: existing.updated_at }
    if (existing.text !== undefined) patch.text = existing.text
    else patch.text = deleteField()
    for (const { key } of REVIEW_CATEGORIES) {
      const stars = existing[key as ReviewCategoryKey]
      patch[key] = stars === undefined ? deleteField() : stars
    }
    await updateDoc(doc(db, 'reviews', reviewDocId(input.bookingId)), patch)
  } else {
    localStorage.setItem(KEY(input.bookingId), JSON.stringify(existing))
  }
  await recordActivity(input.bookingId, 'ReviewUpdated', existing.status, 'guest', input.uid)
  return { ok: true }
}

// ----------------------------------------------------------------------------
// The public page (ADR-0014)
// ----------------------------------------------------------------------------

/**
 * The testimonials a visitor may read.
 *
 * Read from `public_reviews`, which is not a view of the stored Reviews and not
 * a copy of them with fields removed: it is six fields the Admin chose to
 * publish, in a collection a signed-out visitor can read in full because
 * everything in it is meant to be read. A Guest cannot put anything here, and
 * `sanitizePublicReview` is what decides which of an Admin's fields those are.
 *
 * Newest first, and a page of them: a landing page shows a handful, and the
 * rest is a collection the Admin can see.
 */
export async function listPublicReviews(limit = PUBLIC_REVIEW_PAGE_SIZE): Promise<PublicReview[]> {
  if (isFirebaseConfigured && db) {
    const snap = await getDocs(query(collection(db, 'public_reviews'), orderBy('published_at', 'desc'), limitQuery(limit)))
    return snap.docs.map((d) => d.data() as PublicReview)
  }
  const all = readStoredPublicReviews().sort((a, b) => b.published_at.localeCompare(a.published_at))
  return all.slice(0, limit)
}

/**
 * The average and the count, without reading the testimonials.
 *
 * In the cloud this is one read of `site_config/review_summary`, which only
 * the Admin writes — so a Guest cannot move the number on the website, and a
 * visitor does not pay for a count of every Review to read a sum. In demo mode
 * the same two figures are computed from what is published, because there is no
 * Admin to publish a summary and a localStorage read is free.
 */
export async function getPublicReviewSummary(): Promise<ReviewSummary> {
  if (isFirebaseConfigured && db) {
    const snap = await getDoc(doc(db, 'site_config', 'review_summary'))
    if (snap.exists()) return snap.data() as ReviewSummary
  }
  // The public documents carry no `status`, because presence in the collection
  // IS publication (ADR-0014) — so every one of them counts, and the filter in
  // `summarize` has nothing to do here. Saying so explicitly is better than
  // loosening the filter for every other caller.
  const published = (await listPublicReviews(200)).map((r) => ({ stars: r.stars, status: 'published' as const }))
  return summarize(published)
}

/**
 * Put a testimonial on the public page (the Admin's call — ADR-0014).
 *
 * The Admin chooses which words go out and under whose name; what they cannot
 * do is publish a bare rating, or a name longer than a name, or anything the
 * rules would refuse afterwards. `sanitizePublicReview` writes the six fields
 * and `firestore.rules` re-checks the shape, so a client that skipped this
 * function is refused rather than served.
 */
export async function publishPublicReview(input: {
  reviewId: string
  stars: number
  text: string
  displayName: string
  month: string
  publishedAt?: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const sanitized = sanitizePublicReview({
    review_id: input.reviewId,
    stars: input.stars,
    text: input.text,
    display_name: input.displayName,
    month: input.month,
    published_at: input.publishedAt,
  })
  if (!sanitized.ok) return { ok: false, message: sanitized.message }

  if (isFirebaseConfigured && db) {
    await setDoc(doc(db, 'public_reviews', input.reviewId), sanitized.value)
    return { ok: true }
  }
  const all = readStoredPublicReviews().filter((r) => r.review_id !== sanitized.value.review_id)
  localStorage.setItem(PUBLIC_KEY, JSON.stringify([...all, sanitized.value]))
  return { ok: true }
}

/**
 * Take a testimonial down.
 *
 * A delete, not an edit to `status: 'hidden'`: there is no state in which a
 * document is meant to be public and is not, so a visitor listing the
 * collection can never be handed one that should not be there (ADR-0014).
 */
export async function unpublishPublicReview(reviewId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (isFirebaseConfigured && db) {
    await deleteDoc(doc(db, 'public_reviews', reviewId))
    return { ok: true }
  }
  localStorage.setItem(PUBLIC_KEY, JSON.stringify(readStoredPublicReviews().filter((r) => r.review_id !== reviewId)))
  return { ok: true }
}

function readStoredPublicReviews(): PublicReview[] {
  try {
    const raw = localStorage.getItem(PUBLIC_KEY)
    const parsed = raw ? (JSON.parse(raw) as PublicReview[]) : []
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.review_id === 'string') : []
  } catch {
    return []
  }
}

export { canEditReview, editWindowClosesAt, isReviewableStatus, isReviewStatus }
export type { PublicReview, ReviewStatus, ReviewSummary }
