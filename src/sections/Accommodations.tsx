import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, AMENITIES } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { AMENITY_ICONS, ArrowRight, Bed, Users } from '../lib/icons'

export function Accommodations() {
  return (
    <section id="stay" className="py-24 lg:py-36 bg-gradient-to-b from-cream-50 to-cream-100/50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl reveal">
          <div className="eyebrow">Accommodations</div>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
            Stay Your Way
          </h2>
          <p className="mt-6 text-forest-800/80 leading-relaxed">
            Two ways to unwind at Hacienda de LuisAna — a private main house for the whole barkada,
            or a more intimate camping stay tucked into the countryside.
          </p>
        </div>

        <div className="mt-14 grid lg:grid-cols-2 gap-8 lg:gap-10">
          {ACCOMMODATIONS.filter((a) => a.active).map((a) => (
            <article
              key={a.id}
              className="group reveal bg-white rounded-[28px] overflow-hidden border border-forest-900/5 shadow-card hover:shadow-soft transition-all duration-500"
            >
              <div className="relative overflow-hidden">
                <SmartImage
                  src={a.images[0]}
                  alt={`${a.name} — ${a.shortName}`}
                  className="h-72 lg:h-80 w-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.04]"
                />
                <div className="absolute top-4 left-4 flex gap-2">
                  <span className="rounded-full bg-cream-50/95 text-forest-900 text-[11px] uppercase tracking-eyebrow px-3 py-1.5 backdrop-blur">
                    {a.shortName}
                  </span>
                  {a.availableUnits && (
                    <span className="rounded-full bg-forest-800/90 text-cream-50 text-[11px] uppercase tracking-eyebrow px-3 py-1.5">
                      {a.availableUnits} units available
                    </span>
                  )}
                </div>
              </div>

              <div className="p-7 lg:p-8">
                <h3 className="font-serif text-3xl text-forest-900">{a.name}</h3>
                <p className="mt-3 text-forest-800/80 leading-relaxed">{a.description}</p>

                <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-forest-800">
                  <span className="inline-flex items-center gap-2">
                    <Users size={16} className="text-forest-600" />
                    {a.capacityLabel}
                  </span>
                  {a.id === 'main-house' && (
                    <span className="inline-flex items-center gap-2">
                      <Bed size={16} className="text-forest-600" />
                      Private main house
                    </span>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {a.amenities.slice(0, 9).map((k) => {
                    const meta = AMENITIES.find((x) => x.key === k)
                    const Icon = AMENITY_ICONS[k]
                    if (!meta) return null
                    return (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1.5 rounded-full border border-forest-900/10 bg-forest-50 text-forest-800 px-3 py-1.5 text-xs"
                      >
                        {Icon && <Icon size={14} className="text-forest-600" />}
                        {meta.label}
                      </span>
                    )
                  })}
                </div>

                <div className="mt-8 pt-6 border-t border-forest-900/5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    {a.price ? (
                      <>
                        <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">
                          {a.priceIsPlaceholder ? 'Placeholder rate' : 'Rate'}
                        </div>
                        <div className="font-serif text-2xl text-forest-900 mt-1">
                          {a.priceLabel}
                        </div>
                        <div className="text-xs text-forest-700/70 mt-1">
                          Contact us directly to reserve
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Rate</div>
                        <div className="font-serif text-2xl text-forest-900 mt-1">
                          {a.priceLabel || 'Contact us for current rates'}
                        </div>
                      </>
                    )}
                  </div>

                  <Link
                    to={`/book?accommodation=${a.id}`}
                    className="btn bg-forest-800 text-cream-50 hover:bg-forest-900 group/btn"
                  >
                    View Accommodation
                    <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
