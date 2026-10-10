import { useEffect, useId, useRef, useState } from 'react'
import { REVIEW_MAX } from '../lib/validation'
import {
  REVIEW_CATEGORIES,
  STAR_LABELS,
  canEditReview,
  isReviewableStatus,
  type ReviewCategories,
  type ReviewCategoryKey,
} from '../lib/reviewPolicy'
import {
  getReviewForBooking,
  submitReview,
  updateReview,
  type ReviewRecord,
} from '../lib/reviewsCloud'
import { isFirebaseConfigured } from '../lib/firebase'

/**
 * A Guest's words about a stay they have finished.
 *
 * Three things this form is careful about, because each is a way a review
 * system quietly loses a person's effort:
 *
 *   - The star row is a radio group, not five buttons. A screen reader
 *     announces "1 star — Very poor" rather than "button", the arrow keys move
 *     between the stars, and the chosen value is repeated in words under the
 *     row — because a row of gold shapes says nothing to anybody who cannot
 *     tell amber from grey, which includes a screen reader and a colourblind
 *     Guest.
 *   - What the Guest typed is never thrown away. A refusal — over the limit,
 *     or a save that did not land — leaves the text exactly where it was, and
 *     the message says which.
 *   - The submit disables itself the moment it is pressed. One review per stay
 *     is the database's rule, but a double tap is a thing a Guest does before
 *     the button has had a chance to grey out, and it should not produce a
 *     refusal that looks like a failure.
 */
export function ReviewForm({
  bookingId,
  uid,
  bookingStatus,
}: {
  bookingId: string
  uid: string
  bookingStatus: string
}) {
  const [existing, setExisting] = useState<ReviewRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [editable, setEditable] = useState(false)

  useEffect(() => {
    let alive = true
    getReviewForBooking(bookingId, uid)
      .then((found) => {
        if (!alive) return
        setExisting(found)
        setEditable(Boolean(found && canEditReview(found)))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookingId, uid])

  if (loading) return <p className="text-xs text-forest-700/70 mt-3" aria-live="polite">Checking your review…</p>
  // The gate is here as well as in the rules. The rules are the enforcement;
  // this is a Guest not being offered a form that will be refused.
  if (!isReviewableStatus(bookingStatus)) return null

  return (
    <div className="mt-5">
      {existing ? (
        <SubmittedReview review={existing} editable={editable} onEdit={() => setEditable(true)} />
      ) : (
        <ReviewComposer
          bookingId={bookingId}
          uid={uid}
          bookingStatus={bookingStatus}
          onSubmitted={(review) => setExisting(review)}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Writing
// ----------------------------------------------------------------------------

function ReviewComposer({
  bookingId,
  uid,
  bookingStatus,
  onSubmitted,
  review,
  submitLabel,
}: {
  bookingId: string
  uid: string
  bookingStatus: string
  onSubmitted: (review: ReviewRecord) => void
  /** Present when this is a correction rather than a first Review. */
  review?: ReviewRecord
  submitLabel?: string
}) {
  const [stars, setStars] = useState(review?.stars ?? 5)
  const [text, setText] = useState(review?.text ?? '')
  const [categories, setCategories] = useState<ReviewCategories>(
    Object.fromEntries(
      REVIEW_CATEGORIES.map(({ key }) => [key, (review?.[key] as number | undefined) ?? 0]).filter(
        ([, value]) => (value as number) > 0,
      ),
    ) as ReviewCategories,
  )
  const [message, setMessage] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = useId()
  // The double-tap guard, as a ref as well as a flag: React state does not
  // change until the component renders again, and two clicks in one tick both
  // see the old `busy === false`.
  const submitted = useRef(false)

  const overLimit = text.trim().length > REVIEW_MAX

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || submitted.current) return
    submitted.current = true
    setBusy(true)
    setProblem(null)
    try {
      const answered = Object.fromEntries(
        Object.entries(categories).filter(([, value]) => (value as number) > 0),
      ) as ReviewCategories
      const result = review
        ? await updateReview({ bookingId, uid, stars, text, categories: answered })
        : await submitReview({ bookingId, uid, stars, text, bookingStatus, categories: answered })
      if (!result.ok) {
        // The text stays exactly where the Guest left it.
        submitted.current = false
        setBusy(false)
        setProblem(result.message)
        return
      }
      const stored = await getReviewForBooking(bookingId, uid)
      onSubmitted(stored ?? { booking_id: bookingId, uid, stars, created_at: new Date().toISOString(), status: 'pending', edit_until: new Date().toISOString() })
    } catch (error) {
      submitted.current = false
      setBusy(false)
      setProblem(error instanceof Error ? error.message : 'That did not save. Your review is still here — try again.')
    }
  }

  return (
    <form className="rounded-2xl border border-forest-900/10 p-4" onSubmit={submit} data-testid="review-form">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        {review ? 'Change your review' : 'How was your stay?'}
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">How was your stay?</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="How was your stay?">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer p-1"
              title={STAR_LABELS[n - 1]}
            >
              <input
                type="radio"
                name={`${formId}-stars`}
                value={n}
                checked={stars === n}
                onChange={() => setStars(n)}
                className="sr-only"
                aria-label={`${n} star${n === 1 ? '' : 's'} — ${STAR_LABELS[n - 1]}`}
              />
              {/* Decoration only. The <input> above is the radio; giving this
                  span the same role would make a screen reader announce every
                  star twice. */}
              <span
                aria-hidden="true"
                className={`block text-xl leading-none ${n <= stars ? 'text-amber-500' : 'text-forest-300'}`}
              >
                ★
              </span>
            </label>
          ))}
        </div>
        {/* The value in words, for anybody the colour and the shape do not reach. */}
        <p className="mt-1.5 text-xs text-forest-700" aria-live="polite">
          {stars} star{stars === 1 ? '' : 's'} — {STAR_LABELS[stars - 1]}
        </p>
      </fieldset>

      <label className="label mt-4" htmlFor={`${formId}-text`}>
        What did you think?
      </label>
      <textarea
        id={`${formId}-text`}
        className="field text-sm"
        rows={4}
        placeholder="Optional. Tell other Guests what to expect."
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={`${formId}-count`}
      />
      <p id={`${formId}-count`} className={`mt-1 text-[11px] ${overLimit ? 'text-red-800' : 'text-forest-600'}`}>
        {text.length} / {REVIEW_MAX} characters
        {overLimit ? ` — too long. A review must be at most ${REVIEW_MAX} characters.` : ''}
      </p>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
          More detail, if you have it
        </div>
        <p className="mt-1 text-[11px] text-forest-600">Every one of these is optional.</p>
        <div className="mt-2 space-y-2">
          {REVIEW_CATEGORIES.map((category) => (
            <div key={category.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-forest-800">{category.label}</span>
              <StarRow
                legend={`${category.label} rating`}
                value={categories[category.key] ?? 0}
                onChange={(value) => setCategories((current) => ({ ...current, [category.key]: value }))}
                idPrefix={`${formId}-${category.key}`}
              />
            </div>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary text-xs mt-4" disabled={busy || overLimit}>
        {busy ? 'Saving…' : (submitLabel ?? (review ? 'Save my changes' : 'Submit review'))}
      </button>

      {problem && (
        <p className="mt-2 text-xs text-red-800" role="alert">
          {problem}
        </p>
      )}
      {message && <p className="mt-2 text-xs text-forest-700">{message}</p>}
    </form>
  )
}

/** The small star row the categories use: same labels, smaller, still keyboard-driven. */
function StarRow({
  legend,
  value,
  onChange,
  idPrefix,
}: {
  legend: string
  value: number
  onChange: (value: number) => void
  idPrefix: string
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={legend}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer p-0.5">
          <input
            type="radio"
            name={idPrefix}
            value={n}
            checked={value === n}
            onChange={() => onChange(value === n ? 0 : n)}
            className="sr-only"
            aria-label={`${n} star${n === 1 ? '' : 's'} — ${STAR_LABELS[n - 1]}`}
          />
          <span
            aria-hidden="true"
            className={`block text-sm leading-none ${n <= value ? 'text-amber-500' : 'text-forest-300'}`}
          >
            ★
          </span>
        </label>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Reading
// ----------------------------------------------------------------------------

function SubmittedReview({
  review,
  editable,
  onEdit,
}: {
  review: ReviewRecord
  editable: boolean
  onEdit: () => void
}) {
  if (editable) {
    return (
      <ReviewComposer
        bookingId={review.booking_id}
        uid={review.uid}
        bookingStatus="Completed"
        review={review}
        onSubmitted={() => onEdit()}
      />
    )
  }
  return <ReviewSummary review={review} />
}

/** What a Guest sees about a Review they have already written. */
export function ReviewSummary({ review }: { review: ReviewRecord }) {
  return (
    <div className="rounded-2xl border border-forest-900/10 p-4" data-testid="review-summary">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">Your review</div>
      <p className="mt-1.5 text-sm text-forest-800">
        {review.status === 'pending' ? 'Thank you — your review is with the Admin.' : 'Thank you for your feedback!'}
      </p>
      <p className="mt-2 text-lg text-amber-500" aria-hidden="true">
        {'★'.repeat(review.stars)}
        <span className="text-forest-300">{'★'.repeat(Math.max(0, 5 - review.stars))}</span>
      </p>
      <p className="text-xs text-forest-700">
        {review.stars} star{review.stars === 1 ? '' : 's'} — {STAR_LABELS[review.stars - 1]}
        {review.status === 'pending' ? ' · with the Admin' : ''}
      </p>
      {review.text && <p className="mt-2 text-sm text-forest-800 whitespace-pre-line">{review.text}</p>}
      {review.admin_response && (
        <div className="mt-3 border-l-2 border-forest-600/40 pl-3">
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">Reply from the Admin</div>
          <p className="mt-1 text-sm text-forest-800 whitespace-pre-line">{review.admin_response}</p>
        </div>
      )}
    </div>
  )
}

export { isFirebaseConfigured }
