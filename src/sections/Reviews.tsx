import { useState } from 'react'
import { AIRBNB_RATING, REVIEWS, type Review } from '../config/site'
import { Star, Sparkle, ArrowRight } from '../lib/icons'
import { SceneHeader } from '../components/Scene'

/** "2026-09-26" → "September 2026", for the "as of" footnote. */
export function monthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function Reviews() {
  const empty = REVIEWS.length === 0

  return (
    <section id="reviews" className="py-24 lg:py-32 bg-cream-100/40">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <SceneHeader
            index="08"
            eyebrow="Guest Experiences"
            title={
              <>
                Kind Words from
                <br />
                <span className="italic font-light">Our Guests</span>
              </>
            }
          />

          {/* Airbnb's own summary of the listing, dated so it is refreshed rather than assumed */}
          <a
            href={AIRBNB_RATING.url}
            target="_blank"
            rel="noreferrer"
            className="reveal group rounded-3xl bg-white border border-forest-900/5 shadow-card p-6 flex items-center gap-5 hover:shadow-depth hover:-translate-y-0.5 transition"
            aria-label={`Rated ${AIRBNB_RATING.rating.toFixed(1)} out of 5 from ${AIRBNB_RATING.reviewCount} reviews on Airbnb — open the listing`}
          >
            <div className="text-center">
              <div className="font-serif text-5xl text-forest-900 leading-none">{AIRBNB_RATING.rating.toFixed(1)}</div>
              <div className="mt-1.5 flex gap-0.5 text-olive-400 justify-center" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} size={13} className={s < Math.round(AIRBNB_RATING.rating) ? '' : 'opacity-25'} />
                ))}
              </div>
            </div>
            <div className="text-sm">
              <div className="font-medium text-forest-900">
                {AIRBNB_RATING.reviewCount} reviews on Airbnb
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {AIRBNB_RATING.superhost && (
                  <span className="rounded-full bg-forest-50 border border-forest-900/10 text-forest-800 px-2.5 py-0.5 text-[11px]">
                    Superhost
                  </span>
                )}
                {AIRBNB_RATING.guestFavorite && (
                  <span className="rounded-full bg-forest-50 border border-forest-900/10 text-forest-800 px-2.5 py-0.5 text-[11px]">
                    Guest favorite
                  </span>
                )}
              </div>
              <div className="mt-2 text-[11px] text-forest-700/60">
                As of {monthYear(AIRBNB_RATING.checkedOn)} · open the listing
                <ArrowRight size={11} className="inline ml-1 -mt-0.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          </a>
        </div>

        {empty ? (
          <div className="reveal mt-14 rounded-[28px] border border-dashed border-forest-900/15 bg-white p-10 lg:p-14 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-forest-50 flex items-center justify-center text-forest-700 mb-5">
              <Sparkle size={24} />
            </div>
            <div className="font-serif text-2xl text-forest-900">Real guest reviews will appear here.</div>
            <p className="mt-3 text-forest-800/70 max-w-md mx-auto text-sm leading-relaxed">
              We keep this space for verified reviews from real guests of Hacienda de LuisAna.
              Have you stayed with us? We'd love to hear about your experience.
            </p>
          </div>
        ) : (
          <>
            {/* Editorial layout: the most recent review runs large, the rest as cards */}
            <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {REVIEWS.map((r, i) => (
                <ReviewCard key={`${r.name}-${r.date}`} review={r} delay={i * 40} featured={i === 0} />
              ))}
            </div>

            <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-forest-700/70 reveal">
              <p className="max-w-xl leading-relaxed">
                Reviews are shown word for word as guests published them on Airbnb, with the guest's first name
                and the month of the review.
              </p>
              <a href={AIRBNB_RATING.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-forest-800 hover:text-forest-950">
                Read all {AIRBNB_RATING.reviewCount} on Airbnb <ArrowRight size={13} />
              </a>
            </div>

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 reveal">
              {AIRBNB_RATING.categories.map((c) => (
                <div key={c.label} className="rounded-2xl bg-white border border-forest-900/5 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">{c.label}</div>
                  <div className="mt-1 font-serif text-2xl text-forest-900">{c.score.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Verbatim reviews: long ones are clamped, never cut — the guest's words stay whole. */
const CLAMP_AT = 320

function ReviewCard({ review: r, delay, featured = false }: { review: Review; delay: number; featured?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const long = r.body.length > CLAMP_AT
  const paragraphs = r.body.split('\n\n')

  return (
    <article
      className={`reveal relative bg-white rounded-3xl border border-forest-900/5 shadow-card hover:shadow-depth hover:-translate-y-1 transition-all duration-700 ease-out-expo flex flex-col ${
        featured ? 'md:col-span-2 p-8 lg:p-12 bg-gradient-to-br from-white to-cream-100/60' : 'p-8'
      }`}
      style={{ transitionDelay: `${delay}ms` }}
      data-featured={featured || undefined}
    >
      {featured && (
        <span className="pointer-events-none absolute right-8 -bottom-6 font-serif text-[140px] leading-none text-forest-900/[0.06] select-none" aria-hidden="true">
          &rdquo;
        </span>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-0.5 text-olive-400" aria-label={`${r.rating} out of 5 stars`}>
          {Array.from({ length: 5 }).map((_, s) => (
            <Star key={s} size={16} className={s < r.rating ? '' : 'opacity-25'} />
          ))}
        </div>
        <span className="text-[11px] uppercase tracking-eyebrow text-forest-600">{r.source}</span>
      </div>

      <blockquote
        className={`mt-4 text-forest-800/85 space-y-3 ${featured ? 'font-serif text-xl lg:text-2xl leading-relaxed' : 'leading-relaxed'} ${
          long && !expanded ? 'line-clamp-6' : ''
        }`}
      >
        {paragraphs.map((p, i) => (
          <p key={i}>{i === 0 ? `“${p}` : p}{i === paragraphs.length - 1 ? '”' : ''}</p>
        ))}
      </blockquote>

      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 self-start text-xs font-medium text-forest-800 underline underline-offset-4 hover:text-forest-950"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read the full review'}
        </button>
      )}

      <div className="mt-6 pt-4 border-t border-forest-900/5 text-sm text-forest-700">
        <span className="font-medium text-forest-900">{r.name}</span> · {r.date}
      </div>
    </article>
  )
}
