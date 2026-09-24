import { useEffect, useState } from 'react'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { REVIEW_MAX } from '../lib/validation'
import { getReviewForBooking, submitReview } from '../lib/reviewsCloud'
import { isFirebaseConfigured } from '../lib/firebase'

export function ReviewForm({
  bookingId,
  uid,
  bookingStatus,
}: {
  bookingId: string
  uid: string
  bookingStatus: string
}) {
  const [stars, setStars] = useState(5)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    getReviewForBooking(bookingId, uid)
      .then((existing) => {
        if (!alive) return
        if (existing) {
          setDone(true)
          setMsg('You already reviewed this stay.')
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookingId, uid])

  if (loading) return <p className="text-xs text-forest-700/70 mt-3">Checking your review…</p>
  if (done) return <p className="text-xs text-forest-700/80 mt-3">{msg}</p>

  const submit = async () => {
    const rl = checkRateLimit(`review:${uid}`, LIMITS.review)
    if (!rl.ok) {
      setMsg(rl.message)
      return
    }
    const result = await submitReview({ bookingId, uid, stars, text, bookingStatus })
    if (!result.ok) {
      setMsg(result.message)
      return
    }
    setDone(true)
    setMsg(
      isFirebaseConfigured
        ? 'Thank you — your rating was saved for Admin review.'
        : 'Saved on this device (Firebase is not configured). Duplicate reviews are still blocked here.',
    )
  }

  return (
    <div className="mt-4 rounded-2xl border border-forest-900/10 p-3.5">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">Rate your stay</div>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star`}
            className={`text-lg ${n <= stars ? 'text-amber-500' : 'text-forest-300'}`}
            onClick={() => setStars(n)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="field mt-2 text-xs"
        rows={3}
        maxLength={REVIEW_MAX}
        placeholder="Optional written review"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" className="btn-primary text-xs mt-2" onClick={() => void submit()}>
        Submit rating
      </button>
      {msg && <p className="mt-2 text-xs text-forest-700">{msg}</p>}
    </div>
  )
}
