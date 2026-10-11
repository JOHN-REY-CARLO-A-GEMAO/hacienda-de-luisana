import { Link } from 'react-router-dom'
import { AIRBNB_RATING, REVIEWS } from '../config/site'
import { Star, ArrowRight } from '../lib/icons'
import { SceneHeader } from '../components/Scene'

/**
 * Scene 08 — the reviews preview.
 *
 * The rating and the two most recent reviews, which is enough to show the
 * Hacienda is reviewed and what a review sounds like. Every review, the Airbnb
 * category breakdown and the Guest reviews written here after a real stay are
 * on /reviews.
 *
 * The dated Airbnb badge is reused rather than restated, so the figure and the
 * date it was checked can only ever be one number.
 */

/** Two is a taster; three starts to read as the whole story. */
const PREVIEW_COUNT = 2

export function ReviewsPreview() {
  const shown = REVIEWS.slice(0, PREVIEW_COUNT)

  return (
    <section id="reviews" className="py-20 lg:py-28 bg-cream-100/40">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
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

          <a
            href={AIRBNB_RATING.url}
            target="_blank"
            rel="noreferrer"
            className="reveal group rounded-2xl bg-white border border-forest-900/5 shadow-card px-5 py-4 flex items-center gap-4 self-start hover:shadow-depth transition shrink-0"
            aria-label={`Rated ${AIRBNB_RATING.rating.toFixed(1)} out of 5 from ${AIRBNB_RATING.reviewCount} reviews on Airbnb — open the listing`}
          >
            <div className="font-serif text-4xl text-forest-900 leading-none">
              {AIRBNB_RATING.rating.toFixed(1)}
            </div>
            <div className="text-sm">
              <div className="flex gap-0.5 text-olive-400" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} size={12} className={s < Math.round(AIRBNB_RATING.rating) ? '' : 'opacity-25'} />
                ))}
              </div>
              <div className="mt-1 text-forest-800">
                {AIRBNB_RATING.reviewCount} reviews on Airbnb
              </div>
            </div>
          </a>
        </div>

        <div className="mt-12 grid md:grid-cols-2 gap-6">
          {shown.map((r, i) => (
            <figure
              key={`${r.name}-${r.date}`}
              className="reveal bg-white rounded-3xl border border-forest-900/5 shadow-card p-8 flex flex-col"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <div className="flex gap-0.5 text-olive-400" aria-label={`${r.rating} out of 5 stars`}>
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} size={15} className={s < r.rating ? '' : 'opacity-25'} />
                ))}
              </div>
              {/* The first paragraph, exactly as the guest wrote it — the review
                  runs in full on /reviews, where it can be expanded. */}
              <blockquote className="mt-4 text-forest-800/85 leading-relaxed flex-1 line-clamp-6">
                “{r.body.split('\n\n')[0]}”
              </blockquote>
              <figcaption className="mt-6 pt-4 border-t border-forest-900/5 text-sm text-forest-700">
                <span className="font-medium text-forest-900">{r.name}</span> · {r.date}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm reveal">
          <Link to="/reviews" className="btn-ghost group">
            Read all {AIRBNB_RATING.reviewCount} reviews
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <p className="text-xs text-forest-700/70 max-w-lg leading-relaxed">
            Shown word for word as guests published them on Airbnb, with their first name and the month
            of the review.
          </p>
        </div>
      </div>
    </section>
  )
}