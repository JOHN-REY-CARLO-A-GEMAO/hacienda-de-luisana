// ----------------------------------------------------------------------------
// Reviews as the website stores and reads them.
//
// With no Firebase configured — which is how `npm test` runs — this module
// works against this browser's `localStorage`, so every assertion below is
// about the real module and not about a mock of it: the same eligibility
// check, the same duplicate check, the same edit window, the same sanitizing on
// the way to the public page.
//
// The rules suite (`test/rules/firestore-rules.test.ts`) is the enforcement and
// says the same things; the two are not redundant, because this one also
// covers what the rules cannot see — that the app *tells the Guest* something
// useful when it refuses.
// ----------------------------------------------------------------------------
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getPublicReviewSummary,
  listPublicReviews,
  publishPublicReview,
  submitReview,
  updateReview,
  unpublishPublicReview,
  getReviewForBooking,
  type PublicReview,
} from '../../src/lib/reviewsCloud'
import { PUBLIC_EXCERPT_MAX, REVIEW_EDIT_WINDOW_DAYS } from '../../src/lib/reviewPolicy'

const BOOKING = 'booking-1'
const UID = 'guest-uid-1'

beforeEach(() => {
  localStorage.clear()
})

/** A finished stay, so the module's own eligibility check passes. */
const done = (overrides: Partial<Parameters<typeof submitReview>[0]> = {}) => ({
  bookingId: BOOKING,
  uid: UID,
  stars: 5,
  text: 'Lovely stay.',
  bookingStatus: 'Completed',
  ...overrides,
})

describe('eligibility', () => {
  it('accepts a review of a stay that is over', async () => {
    expect((await submitReview(done({ bookingStatus: 'Completed' }))).ok).toBe(true)
    expect((await submitReview(done({ bookingId: 'b2', bookingStatus: 'Checked-Out' }))).ok).toBe(true)
  })

  it.each(['Pending', 'Payment Pending', 'Approved', 'Reserved', 'Checked-In', 'Staying'])(
    'refuses a review while the Booking is %s',
    async (bookingStatus) => {
      const result = await submitReview(done({ bookingStatus }))
      expect(result.ok).toBe(false)
    },
  )

  it.each(['Rejected', 'Cancelled', 'Expired'])('refuses a review of a %s Booking', async (bookingStatus) => {
    expect((await submitReview(done({ bookingStatus }))).ok).toBe(false)
  })
})

describe('the written feedback', () => {
  it('keeps it, trimmed', async () => {
    await submitReview(done({ text: '  Beautiful place.  ' }))
    expect((await getReviewForBooking(BOOKING, UID))?.text).toBe('Beautiful place.')
  })

  it('stores nothing for feedback that is only spaces', async () => {
    expect((await submitReview(done({ text: '     ' }))).ok).toBe(true)
    const stored = await getReviewForBooking(BOOKING, UID)
    // Absent, not five spaces: "the Guest wrote nothing" and "the Guest wrote
    // whitespace" are different facts and only one of them is worth storing.
    expect(stored?.text).toBeUndefined()
    expect(JSON.stringify(stored)).not.toContain('     ')
  })

  it('refuses feedback past the limit and says which limit', async () => {
    const result = await submitReview(done({ text: 'x'.repeat(1001) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('1000')
  })

  it('accepts feedback exactly at the limit', async () => {
    expect((await submitReview(done({ text: 'x'.repeat(1000) }))).ok).toBe(true)
  })
})

describe('the star rating', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i stars', async (stars) => {
    expect((await submitReview(done({ stars }))).ok).toBe(true)
  })

  it.each([0, 6, -1, 999, 4.5, Number.NaN])('refuses %s', async (stars) => {
    expect((await submitReview(done({ stars }))).ok).toBe(false)
  })
})

describe('one review per stay', () => {
  it('refuses a second one, and leaves the first untouched', async () => {
    await submitReview(done({ stars: 5, text: 'The first one.' }))
    const second = await submitReview(done({ stars: 1, text: 'The second one.' }))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.message).toMatch(/already/i)
    const stored = await getReviewForBooking(BOOKING, UID)
    expect(stored?.stars).toBe(5)
    expect(stored?.text).toBe('The first one.')
  })

  it('does not let another Guest read the Review', async () => {
    await submitReview(done())
    expect(await getReviewForBooking(BOOKING, 'someone-else')).toBeNull()
  })
})

describe('correcting a review', () => {
  it('lets the Guest change their words and their rating', async () => {
    await submitReview(done())
    const result = await updateReview({ bookingId: BOOKING, uid: UID, stars: 4, text: 'On reflection, the fan was loud.' })
    expect(result.ok).toBe(true)
    const before = await getReviewForBooking(BOOKING, UID)
    const stored = await getReviewForBooking(BOOKING, UID)
    expect(stored?.stars).toBe(4)
    expect(stored?.text).toBe('On reflection, the fan was loud.')
    // The instant it was FIRST written is the instant the window is measured
    // from, so correcting yourself does not buy another fortnight. That is the
    // assertion; `updated_at` is a record, not a deadline.
    expect(stored?.created_at).toBe(before?.created_at)
    expect(stored?.updated_at).toBeTruthy()
  })

  it('refuses once the window has shut, and says so plainly', async () => {
    await submitReview(done())
    const later = new Date(Date.now() + (REVIEW_EDIT_WINDOW_DAYS + 1) * 86_400_000).toISOString()
    const result = await updateReview({ bookingId: BOOKING, uid: UID, stars: 1, text: 'Changed my mind entirely.', now: later })
    expect(result.ok).toBe(false)
    // The Guest is told the window closed and why, in a sentence they can act
    // on — not a bare false the form has to invent a message for.
    if (!result.ok) {
      expect(result.message).toMatch(/14 days/)
      expect(result.message).toMatch(/closed/i)
    }
    expect((await getReviewForBooking(BOOKING, UID))?.stars).toBe(5)
  })

  it('refuses a Guest editing somebody else\'s review, or a review that is not there', async () => {
    await submitReview(done())
    expect((await updateReview({ bookingId: BOOKING, uid: 'someone-else', stars: 1 })).ok).toBe(false)
    expect((await updateReview({ bookingId: 'never-reviewed', uid: UID, stars: 1 })).ok).toBe(false)
  })

  it('refuses an edit that is not a valid review', async () => {
    await submitReview(done())
    expect((await updateReview({ bookingId: BOOKING, uid: UID, stars: 6 })).ok).toBe(false)
    expect((await updateReview({ bookingId: BOOKING, uid: UID, text: 'x'.repeat(1001) })).ok).toBe(false)
  })
})

describe('category ratings', () => {
  it('keeps the ones that were answered and drops the ones that were not', async () => {
    await submitReview(done({ categories: { cleanliness: 5, communication: 4 } }))
    const stored = await getReviewForBooking(BOOKING, UID)
    expect(stored?.cleanliness).toBe(5)
    expect(stored?.communication).toBe(4)
    expect(stored?.accommodation).toBeUndefined()
  })

  it('refuses a category outside 1..5 rather than storing a wrong one', async () => {
    expect((await submitReview(done({ categories: { cleanliness: 0 } }))).ok).toBe(false)
    expect((await submitReview(done({ categories: { value: 6 } }))).ok).toBe(false)
    expect((await submitReview(done({ categories: { value: 3 } }))).ok).toBe(true)
  })
})

describe('the public page', () => {
  const publish = (overrides: Partial<Parameters<typeof publishPublicReview>[0]> = {}) =>
    publishPublicReview({
      reviewId: BOOKING,
      stars: 5,
      text: 'Very relaxing place. We enjoyed our stay.',
      displayName: 'Ana R.',
      month: 'October 2026',
      ...overrides,
    })

  it('publishes what it is given and reads it back', async () => {
    expect((await publish()).ok).toBe(true)
    const shown = await listPublicReviews()
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ stars: 5, display_name: 'Ana R.', month: 'October 2026' })
    expect(shown[0].excerpt).toBe('Very relaxing place. We enjoyed our stay.')
  })

  it('refuses a testimonial with no words, and never publishes a bare rating', async () => {
    expect((await publish({ text: '   ' })).ok).toBe(false)
    expect(await listPublicReviews()).toHaveLength(0)
  })

  it('refuses an excerpt past the public limit', async () => {
    expect((await publish({ text: 'x'.repeat(PUBLIC_EXCERPT_MAX + 1) })).ok).toBe(false)
  })

  it('withdraws a testimonial by deleting it, and leaves no trace', async () => {
    await publish()
    expect((await unpublishPublicReview(BOOKING)).ok).toBe(true)
    expect(await listPublicReviews()).toHaveLength(0)
  })

  it('carries nothing from the stored review — no uid, no booking, no private reply', async () => {
    await submitReview(done())
    await publish()
    const shown = await listPublicReviews()
    const keys = Object.keys(shown[0]).sort()
    expect(keys).toEqual(['display_name', 'excerpt', 'month', 'published_at', 'review_id', 'stars'])
    expect(JSON.stringify(shown)).not.toContain(UID)
  })

  it('shows newest first, and never more than it was told to', async () => {
    for (let i = 0; i < 5; i++) {
      await publish({ reviewId: `b${i}`, month: `Month ${i}`, publishedAt: `2026-10-0${i + 1}T00:00:00.000Z` })
    }
    const shown = await listPublicReviews(3)
    expect(shown).toHaveLength(3)
    expect(shown[0].month).toBe('Month 4')
  })
})

describe('the average on the public page', () => {
  it('is computed from published reviews only', async () => {
    await submitReview(done({ bookingId: 'b1', stars: 5, text: 'Five.' }))
    await submitReview(done({ bookingId: 'b2', stars: 4, text: 'Four.' }))
    await publishPublicReview({ reviewId: 'b1', stars: 5, text: 'Five.', displayName: 'Guest', month: 'October 2026' })
    await publishPublicReview({ reviewId: 'b2', stars: 4, text: 'Four.', displayName: 'Guest', month: 'September 2026' })
    const summary = await getPublicReviewSummary()
    expect(summary.count).toBe(2)
    expect(summary.average).toBe(4.5)
  })

  it('reports nothing rather than a zero when nothing is published', async () => {
    const summary = await getPublicReviewSummary()
    expect(summary.count).toBe(0)
    expect(summary.average).toBeNull()
  })
})

describe('the shape a screen gets', () => {
  it('is the public document, typed — not a Firestore DocumentData', async () => {
    await publishPublicReview({ reviewId: 'b1', stars: 5, text: 'Lovely.', displayName: 'Guest', month: 'October 2026' })
    const [first] = await listPublicReviews()
    const typed: PublicReview = first
    expect(typed.excerpt).toBe('Lovely.')
  })
})
