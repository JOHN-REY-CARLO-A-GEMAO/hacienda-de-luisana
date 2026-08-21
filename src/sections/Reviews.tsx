import { REVIEWS } from '../config/site'
import { Star, Sparkle } from '../lib/icons'

export function Reviews() {
  const empty = REVIEWS.length === 0

  return (
    <section id="reviews" className="py-24 lg:py-32 bg-cream-100/40">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="max-w-2xl reveal">
          <div className="eyebrow">Guest Experiences</div>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
            Kind Words from
            <br />
            <span className="italic font-light">Our Guests</span>
          </h2>
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
          <div className="mt-14 grid md:grid-cols-3 gap-6">
            {REVIEWS.map((r, i) => (
              <article key={i} className="reveal bg-white rounded-3xl p-8 border border-forest-900/5 shadow-card">
                <div className="flex gap-0.5 text-olive-400">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} size={16} className={s < r.rating ? '' : 'opacity-25'} />
                  ))}
                </div>
                <p className="mt-4 text-forest-800/85 leading-relaxed">"{r.body}"</p>
                <div className="mt-6 text-sm text-forest-700">
                  <span className="font-medium text-forest-900">{r.name}</span> · {r.date}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
