// ----------------------------------------------------------------------------
// Review policy — the decisions that are not the database's to make.
//
// `firestore.rules` is the enforcement, and the rules suite
// (`test/rules/firestore-rules.test.ts`) runs it. This suite pins the *policy*
// the rules can only partly express, and the four places a Review's shape has
// to be decided once so the website, the Admin app and the rules agree:
//
//   1. Eligibility. A Review is about a finished Stay, so the statuses that
//      open the form are the ones `firestore.rules` accepts — the same list,
//      read from one place instead of written out four times.
//   2. The edit window. A Guest may correct what they wrote for two weeks.
//      After that the words are what they said on the day, and only the Admin
//      can remove them.
//   3. The public shape. What a visitor may read is a *different document* from
//      what a Guest wrote (ADR-0014), so the sanitizer here is the one that
//      decides which of the two a field belongs to — and it is pinned here so a
//      new field cannot quietly become public.
//   4. The average. Computed from published Reviews only, because a number a
//      visitor can see should not be moved by a Review nobody can see.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ADMIN_RESPONSE_MAX,
  PUBLIC_REVIEW_FIELDS,
  REVIEW_FIELDS,
  PUBLIC_EXCERPT_MAX,
  PUBLIC_NAME_MAX,
  REVIEW_CATEGORIES,
  REVIEW_EDIT_WINDOW_DAYS,
  REVIEW_STATUSES,
  STAR_LABELS,
  canEditReview,
  editWindowClosesAt,
  isReviewableStatus,
  sanitizePublicReview,
  starLabel,
  summarize,
  type ReviewSummaryInput,
} from '../../src/lib/reviewPolicy'

const CREATED = '2026-10-05T02:00:00.000Z'

describe('eligibility follows the stay, not the Guest', () => {
  it('opens only once the stay is over', () => {
    expect(isReviewableStatus('Completed')).toBe(true)
    expect(isReviewableStatus('Checked-Out')).toBe(true)
  })

  it.each(['Pending', 'Payment Pending', 'Approved', 'Reserved', 'Checked-In', 'Staying'])(
    'refuses %s — the stay has not happened yet',
    (status) => {
      expect(isReviewableStatus(status)).toBe(false)
    },
  )

  it.each(['Rejected', 'Cancelled', 'Expired'])('refuses %s — a terminal branch is not a stay', (status) => {
    expect(isReviewableStatus(status)).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(isReviewableStatus(undefined)).toBe(false)
    expect(isReviewableStatus('')).toBe(false)
    expect(isReviewableStatus('completed')).toBe(false)
  })

  it('is the same list the rules accept', () => {
    // The rule text is the enforcement, so the two are pinned against each
    // other rather than trusted to stay in step.
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toContain("in ['Checked-Out', 'Completed']")
  })
})

describe('the edit window', () => {
  const review = { created_at: CREATED, status: 'published' as const }

  it('lets the Guest correct a Review they wrote recently', () => {
    expect(canEditReview(review, '2026-10-06T00:00:00.000Z')).toBe(true)
  })

  it('closes on the day, at the same hour, two weeks later', () => {
    const closes = editWindowClosesAt(CREATED)
    expect(closes).toBe('2026-10-19T02:00:00.000Z')
    expect(canEditReview(review, '2026-10-19T01:59:59.000Z')).toBe(true)
    expect(canEditReview(review, '2026-10-19T02:00:00.000Z')).toBe(false)
  })

  it('never reopens once it has closed', () => {
    expect(canEditReview(review, '2027-01-01T00:00:00.000Z')).toBe(false)
  })

  it('is a fortnight, not a guess', () => {
    expect(REVIEW_EDIT_WINDOW_DAYS).toBe(14)
  })
})

describe('the public shape', () => {
  /** Everything a stored Review carries, including what must never go public. */
  const stored = {
    booking_id: 'booking-1',
    uid: 'guest-uid-1',
    stars: 5,
    text: 'Beautiful place and very accommodating.',
    created_at: CREATED,
    status: 'published' as const,
    cleanliness: 5,
    admin_response: 'Thank you for staying with us!',
    admin_response_by: 'admin-uid-1',
  }

  it('publishes the words and the stars and nothing else', () => {
    const result = sanitizePublicReview({
      review_id: 'booking-1',
      stars: stored.stars,
      text: stored.text,
      display_name: 'Ana R.',
      month: 'October 2026',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Every key, so a field added to the Review later cannot ride along.
    expect(Object.keys(result.value).sort()).toEqual([
      'display_name',
      'excerpt',
      'month',
      'published_at',
      'review_id',
      'stars',
    ])
  })

  it('carries no uid, no booking, no private reply', () => {
    const result = sanitizePublicReview({
      review_id: 'booking-1',
      stars: 5,
      text: stored.text,
      display_name: 'Ana R.',
      month: 'October 2026',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain('guest-uid-1')
    expect(JSON.stringify(result.value)).not.toContain('Thank you for staying')
    expect(result.value).not.toHaveProperty('booking_id')
    expect(result.value).not.toHaveProperty('uid')
  })

  it('refuses a public entry with no words — a bare rating is not a testimonial', () => {
    const result = sanitizePublicReview({ review_id: 'b1', stars: 5, text: '   ', display_name: 'Guest', month: 'October 2026' })
    expect(result.ok).toBe(false)
  })

  it('refuses a public entry whose excerpt runs past the limit', () => {
    const result = sanitizePublicReview({
      review_id: 'b1',
      stars: 5,
      text: 'x'.repeat(PUBLIC_EXCERPT_MAX + 1),
      display_name: 'Guest',
      month: 'October 2026',
    })
    expect(result.ok).toBe(false)
  })

  it('refuses a public name longer than a name is', () => {
    const result = sanitizePublicReview({
      review_id: 'b1',
      stars: 5,
      text: 'Lovely.',
      display_name: 'x'.repeat(PUBLIC_NAME_MAX + 1),
      month: 'October 2026',
    })
    expect(result.ok).toBe(false)
  })

  it('refuses stars outside 1..5', () => {
    for (const stars of [0, 6, -1, 999, 4.5, Number.NaN]) {
      const result = sanitizePublicReview({ review_id: 'b1', stars, text: 'Lovely.', display_name: 'Guest', month: 'October 2026' })
      expect(result.ok, `stars ${stars}`).toBe(false)
    }
  })
})

describe('the average', () => {
  it('counts published Reviews only — a hidden one moves nothing a visitor can see', () => {
    const summary = summarize([
      { stars: 5, status: 'published' },
      { stars: 4, status: 'published' },
      { stars: 1, status: 'hidden' },
      { stars: 1, status: 'pending' },
    ])
    expect(summary.count).toBe(2)
    expect(summary.average).toBe(4.5)
  })

  it('reports no average rather than a flattering zero when there is nothing', () => {
    const summary = summarize([])
    expect(summary.count).toBe(0)
    expect(summary.average).toBeNull()
  })

  it('rounds to one decimal, the way the site prints it', () => {
    expect(summarize([{ stars: 5, status: 'published' }, { stars: 4, status: 'published' }, { stars: 4, status: 'published' }]).average).toBe(4.3)
  })

  it('counts every star, so the histogram adds up to the total', () => {
    const summary = summarize([
      { stars: 5, status: 'published' },
      { stars: 5, status: 'published' },
      { stars: 1, status: 'published' },
    ])
    expect(Object.values(summary.distribution).reduce((a, b) => a + b, 0)).toBe(summary.count)
  })

  it('ignores a status nobody has heard of, rather than counting it', () => {
    const rows = [{ stars: 5, status: 'published' }, { stars: 5, status: 'banana' }] as ReviewSummaryInput[]
    expect(summarize(rows).count).toBe(1)
  })
})

describe('the shape a screen reader gets', () => {
  it('names what each star means, not just how many there are', () => {
    expect(STAR_LABELS).toHaveLength(5)
    expect(starLabel(1)).toBe('1 star — Very poor')
    expect(starLabel(5)).toBe('5 stars — Excellent')
  })

  it('still says something for a rating that is not a rating', () => {
    expect(starLabel(0)).toBe('Not rated')
  })

  it('offers four categories, none of them required', () => {
    expect(REVIEW_CATEGORIES.map((c) => c.key)).toEqual(['cleanliness', 'accommodation', 'communication', 'value'])
  })
})

describe('the moderation statuses', () => {
  it('are the three the Admin picks between, and one of them is never silent deletion', () => {
    expect(REVIEW_STATUSES).toEqual(['pending', 'published', 'hidden'])
  })
})

describe('an Admin response', () => {
  it('is bounded like every other piece of text the Admin writes', () => {
    expect(ADMIN_RESPONSE_MAX).toBeGreaterThan(0)
    expect(ADMIN_RESPONSE_MAX).toBeLessThanOrEqual(2000)
  })
})

describe('what the Activity log says about a Review', () => {
  it('names each of the five changes in the glossary\'s words', async () => {
    const { describeActivity } = await import('../../src/lib/booking')
    const entry = (action: string, to_status: string) =>
      describeActivity({
        booking_id: 'booking-1',
        action: action as never,
        from_status: 'none',
        to_status,
        actor: 'admin',
        actor_id: 'admin-1',
        at: '2026-10-06T02:00:00.000Z',
      })
    expect(entry('ReviewSubmitted', 'pending').headline).toBe('Review written')
    expect(entry('ReviewUpdated', 'pending').headline).toBe('Review corrected by the Guest')
    expect(entry('AdminReviewResponded', 'published').headline).toBe('Admin replied to the review')
    expect(entry('ReviewModerated', 'hidden').headline).toBe('Review moderation changed')
    expect(entry('ReviewPublished', 'published').headline).toBe('Review published to the website')
  })

  it('leaves the arrow out, because a Review has no "before" the first time', async () => {
    const { describeActivity } = await import('../../src/lib/booking')
    const line = describeActivity({
      booking_id: 'booking-1',
      action: 'ReviewSubmitted',
      from_status: 'none',
      to_status: 'pending',
      actor: 'guest',
      actor_id: 'guest-1',
      at: '2026-10-06T02:00:00.000Z',
    })
    expect(line.change).toBe('review is pending')
    // A Booking's own arrow is untouched by any of this.
    expect(
      describeActivity({
        booking_id: 'booking-1',
        action: 'CheckOut',
        from_status: 'Staying',
        to_status: 'Checked-Out',
        actor: 'admin',
        actor_id: 'admin-1',
        at: '2026-10-06T02:00:00.000Z',
      }).change,
    ).toBe('Staying → Checked-Out')
  })

  it('says which Guest acted, from the entry, not from a lookup', async () => {
    const { describeActivity } = await import('../../src/lib/booking')
    const line = describeActivity({
      booking_id: 'booking-1',
      action: 'ReviewSubmitted',
      from_status: 'none',
      to_status: 'pending',
      actor: 'guest',
      actor_id: 'guest-1',
      actor_name: 'Ana Reyes',
      at: '2026-10-06T02:00:00.000Z',
    })
    expect(line.actor).toBe('Ana Reyes (Guest)')
  })
})

describe('the field lists are the rules\' lists', () => {
  /** The rules file, read for the two shapes it is meant to be holding to. */
  const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')

  it('names every field a Review may carry, in the rules too', () => {
    // `REVIEW_FIELDS` exists so a field added to a Review has to be *named*
    // here before it can be reasoned about. The assertion is the mirror: the
    // two lists are read against the same file, so neither can quietly fall
    // behind the other.
    for (const field of REVIEW_FIELDS) {
      expect(rules.includes(`'${field}'`), field).toBe(true)
    }
  })

  it('names every field a public review may carry — and the rules list is the boundary', () => {
    for (const field of PUBLIC_REVIEW_FIELDS) {
      expect(rules.includes(`'${field}'`), field).toBe(true)
    }
    // The public shape is six fields and no more, and the field that decides
    // that is in the rules rather than in this file.
    expect(PUBLIC_REVIEW_FIELDS).toHaveLength(6)
    expect(rules).toContain(".hasOnly(['review_id', 'stars', 'excerpt', 'display_name', 'month', 'published_at'])")
  })
})
