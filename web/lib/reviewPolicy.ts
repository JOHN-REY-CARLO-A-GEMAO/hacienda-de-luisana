// ----------------------------------------------------------------------------
// Review policy — everything about a Review that is not a Firestore write.
//
// Vocabulary: CONTEXT.md § Review. Enforcement: `firestore.rules`, whose rules
// suite is `test/rules/firestore-rules.test.ts`.
//
// This module is pure. It imports nothing, so the website, the Admin app's
// mirrored copy and the rules suite can all be checked against the same list
// rather than three lists that drift.
//
// The one thing it deliberately does NOT own is where a Review lives. That is
// `reviewsCloud.ts`; the id is still the Booking id, and still is because
// "one Review per stay" has to be something the database enforces, not
// something a form remembers.
// ----------------------------------------------------------------------------

/**
 * The Booking statuses a Review can be written from.
 *
 * `Checked-Out` as well as `Completed`: a Guest who has walked out has stayed,
 * and making them wait for the Admin to close the Booking before they may say
 * what they thought of it is a rule about the Admin's paperwork, not about the
 * stay. These are the same two statuses `firestore.rules` accepts, and the
 * rules suite pins the two lists against each other.
 *
 * Everything else is refused, terminal branches included: a Rejected, Cancelled
 * or Expired Booking is a request that ended, and there is no stay to review.
 */
export const REVIEWABLE_STATUSES = ['Checked-Out', 'Completed'] as const

export type ReviewableStatus = (typeof REVIEWABLE_STATUSES)[number]

/** Has this Booking reached the point where a Review of it means something? */
export function isReviewableStatus(status: string | null | undefined): boolean {
  return (REVIEWABLE_STATUSES as readonly string[]).includes(status ?? '')
}

// ----------------------------------------------------------------------------
// Editing
// ----------------------------------------------------------------------------

/**
 * How long after writing a Review the Guest may still correct it.
 *
 * Fourteen days: long enough to remember what they thought on the drive home,
 * short enough that a Review on the website is a record of a stay rather than
 * an open-ended thread the Guest keeps editing. After it closes the Review says
 * what it said on the day, and only the Admin can remove it — a Guest cannot
 * delete a criticism by rewriting it to nothing.
 *
 * `firestore.rules` enforces the same fortnight against `request.time`, so a
 * console cannot sit on the form for a year and then submit.
 */
export const REVIEW_EDIT_WINDOW_DAYS = 14

const DAY_MS = 86_400_000

/** The instant a Review's edit window shuts, as an ISO string. */
export function editWindowClosesAt(createdAt: string): string {
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return createdAt
  return new Date(created + REVIEW_EDIT_WINDOW_DAYS * DAY_MS).toISOString()
}

/**
 * May this Review still be edited at `now`?
 *
 * `true` for a Review the Guest may correct, `false` once the window has shut —
 * and the string it returns says why, because the form has to explain the
 * difference between "you may still change this" and "this is now a record".
 */
export function canEditReview(
  review: { created_at: string; status?: string },
  now: string | number | Date = Date.now(),
): boolean {
  return editWindowClosesAt(review.created_at) > new Date(now).toISOString()
}

// ----------------------------------------------------------------------------
// Moderation
// ----------------------------------------------------------------------------

/**
 * The three things a Review can be, in the Admin's hands.
 *
 * `pending` is where every Review lands, and it is the default because the
 * website has always told the Guest their rating is "saved for Admin review".
 * `hidden` is the moderation state, and it is a *state*: a Review nobody
 * should read is kept, with its reason, rather than deleted. A Guest is never
 * silently lost because a rating was uncomfortable — that is the Admin's
 * decision to make out loud, in the Activity log.
 */
export const REVIEW_STATUSES = ['pending', 'published', 'hidden'] as const

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Is this one of the three, and not a typo that would hide a Review by accident? */
export function isReviewStatus(value: unknown): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly unknown[]).includes(value)
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

/**
 * The optional category ratings.
 *
 * Four, and every one of them optional: the overall rating is the answer, and a
 * Guest who has nothing to add should be able to press one button rather than
 * be asked to complete a grid. A category a Guest skipped is absent from the
 * document, not zero — "did not rate" and "rated it the lowest available" are
 * different facts and the histogram keeps them apart.
 */
export const REVIEW_CATEGORIES = [
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'communication', label: 'Communication' },
  { key: 'value', label: 'Value for money' },
] as const

export type ReviewCategoryKey = (typeof REVIEW_CATEGORIES)[number]['key']

export type ReviewCategories = Partial<Record<ReviewCategoryKey, number>>

// ----------------------------------------------------------------------------
// Accessibility
// ----------------------------------------------------------------------------

/**
 * What each star means, in the Admin's and the Guest's words.
 *
 * A row of gold shapes is a colour and a shape and nothing else to a screen
 * reader, and it is unreadable to anyone who cannot tell amber from grey. Each
 * star therefore carries the word for its value, and the row is a radiogroup
 * so arrow keys move between them.
 */
export const STAR_LABELS = ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'] as const

/** "3 stars — Average". What a star button announces. */
export function starLabel(stars: number): string {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return 'Not rated'
  return `${stars} star${stars === 1 ? '' : 's'} — ${STAR_LABELS[stars - 1]}`
}

// ----------------------------------------------------------------------------
// The public shape (ADR-0014)
// ----------------------------------------------------------------------------

/** The longest a public testimonial may be. Shorter than a Review: it is a quotation. */
export const PUBLIC_EXCERPT_MAX = 400

/** The longest a public display name may be. A name, not a sentence. */
export const PUBLIC_NAME_MAX = 60

/** What a visitor reads. Nothing else about the Review is readable by anyone signed out. */
export type PublicReview = {
  review_id: string
  stars: number
  excerpt: string
  display_name: string
  month: string
  published_at: string
}

export type PublicReviewInput = {
  review_id: string
  stars: number
  text: string
  display_name: string
  month: string
  published_at?: string
}

export type PublicReviewResult = { ok: true; value: PublicReview } | { ok: false; message: string }

/**
 * Turn what a Guest wrote into what a visitor may read.
 *
 * The stored Review carries the author's uid, the Booking it is about and the
 * Admin's private reply. None of those belong on a public page: the uid is a
 * key back to a Booking that holds a name, an email and a phone number, and the
 * Booking id is that Booking's identifier. So the public document is written
 * from scratch out of six named fields rather than copied from the Review and
 * pruned, because a field added to the Review next year then cannot ride along
 * to the website by default — it has to be named here to be published.
 *
 * The Admin chooses what goes out: which words, and under whose name. That is
 * the publication decision, and it is a human one.
 */
export function sanitizePublicReview(input: PublicReviewInput, now: string | number | Date = Date.now()): PublicReviewResult {
  const id = input.review_id.trim()
  if (!id) return { ok: false, message: 'A published review has to say which review it is.' }
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    return { ok: false, message: 'Choose a star rating from 1 to 5' }
  }
  const excerpt = input.text.trim()
  if (!excerpt) return { ok: false, message: 'A published review needs the Guest’s words, not only their rating.' }
  if (excerpt.length > PUBLIC_EXCERPT_MAX) {
    return { ok: false, message: `The public quote must be at most ${PUBLIC_EXCERPT_MAX} characters.` }
  }
  const display = input.display_name.trim()
  if (!display) return { ok: false, message: 'A published review needs something to call its author.' }
  if (display.length > PUBLIC_NAME_MAX) {
    return { ok: false, message: `The display name must be at most ${PUBLIC_NAME_MAX} characters.` }
  }
  const month = input.month.trim()
  if (!month) return { ok: false, message: 'A published review says which month the stay was.' }
  return {
    ok: true,
    value: {
      review_id: id,
      stars: input.stars,
      excerpt,
      display_name: display,
      month,
      published_at: input.published_at ?? new Date(now).toISOString(),
    },
  }
}

/** Keys a stored Review may carry, and the rules' list — asserted here and there. */
export const REVIEW_FIELDS = [
  'booking_id',
  'uid',
  'stars',
  'created_at',
  'status',
  'updated_at',
  'text',
  ...REVIEW_CATEGORIES.map((c) => c.key),
  'admin_response',
  'admin_response_at',
  'admin_response_by',
  'moderated_at',
  'moderated_by',
] as const

/** The keys a public review may carry, and nothing else. */
export const PUBLIC_REVIEW_FIELDS = ['review_id', 'stars', 'excerpt', 'display_name', 'month', 'published_at'] as const

// ----------------------------------------------------------------------------
// The Admin's reply
// ----------------------------------------------------------------------------

/**
 * The longest an Admin reply may be.
 *
 * Bounded like every other piece of text in the system. The same ceiling as a
 * message is the wrong one to copy here for no reason, and a review reply is
 * a sentence or two, not a message thread.
 */
export const ADMIN_RESPONSE_MAX = 600

// ----------------------------------------------------------------------------
// The average
// ----------------------------------------------------------------------------

export type ReviewSummaryInput = { stars: number; status: string }

export type ReviewSummary = {
  /** The mean, to one decimal, over published Reviews — or null if there are none. */
  average: number | null
  count: number
  /** How many published Reviews carry each rating, 1 through 5. */
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  updated_at: string
}

export const EMPTY_DISTRIBUTION: ReviewSummary['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }

/**
 * The average rating, from the Reviews a visitor can actually see.
 *
 * Published only. A hidden Review and a Review still waiting for the Admin are
 * both excluded, so the number on the website cannot be moved — up or down — by
 * a Review that is not on the website. And with nothing published there is no
 * average rather than a zero: "0.0" would read as a terrible rating instead of
 * an absence of ratings.
 */
export function summarize(reviews: readonly ReviewSummaryInput[], now: string | number | Date = Date.now()): ReviewSummary {
  const distribution: ReviewSummary['distribution'] = { ...EMPTY_DISTRIBUTION }
  let total = 0
  let count = 0
  for (const review of reviews) {
    if (review.status !== 'published') continue
    const stars = review.stars
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) continue
    distribution[String(stars) as keyof ReviewSummary['distribution']] += 1
    total += stars
    count += 1
  }
  return {
    average: count === 0 ? null : Math.round((total / count) * 10) / 10,
    count,
    distribution,
    updated_at: new Date(now).toISOString(),
  }
}
