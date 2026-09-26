import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, AMENITIES, type Accommodation } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { AMENITY_ICONS, ArrowRight, Bed, House, Users } from '../lib/icons'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { ratesForAccommodation, type PublishedRates } from '../lib/booking'

/**
 * The rate to show for one Accommodation, and where it comes from.
 *
 * The Admin's Published rates win when they exist — that is the figure a
 * Booking is actually quoted at. Otherwise the Hacienda's own listed price
 * (site.ts, sourced) is shown. When neither exists the card says "quoted on
 * request" rather than inventing a number.
 */
export function displayedRate(
  a: Accommodation,
  published: PublishedRates | null,
): { label: string; source: string; nightly?: number } {
  const quoted = published ? ratesForAccommodation(published, a.id) : undefined
  if (quoted) {
    const per = a.availableUnits ? ' / unit / night' : ' / night'
    return {
      label: `₱${quoted.rateCard.nightlyRate.toLocaleString('en-PH')}${per}`,
      source: `Published rates ${published!.version}`,
      nightly: quoted.rateCard.nightlyRate,
    }
  }
  if (a.price) {
    return { label: a.priceLabel ?? `₱${a.price.toLocaleString('en-PH')} / night`, source: a.priceSource ?? '', nightly: a.price }
  }
  return { label: a.priceLabel ?? 'Quoted on request', source: 'The Hacienda confirms the rate with you' }
}

export function Accommodations() {
  const published = usePublishedRates()

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
          {ACCOMMODATIONS.filter((a) => a.active).map((a) => {
            const rate = displayedRate(a, published)
            return (
              <article
                key={a.id}
                className="group reveal bg-white rounded-[28px] overflow-hidden border border-forest-900/5 shadow-card hover:shadow-soft transition-all duration-500 flex flex-col"
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

                <div className="p-7 lg:p-8 flex-1 flex flex-col">
                  <h3 className="font-serif text-3xl text-forest-900">{a.name}</h3>
                  <p className="mt-3 text-forest-800/80 leading-relaxed">{a.description}</p>

                  <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-forest-800">
                    <span className="inline-flex items-center gap-2">
                      <Users size={16} className="text-forest-600" />
                      {a.capacityLabel}
                    </span>
                    {a.id === 'main-house' && (
                      <span className="inline-flex items-center gap-2">
                        <House size={16} className="text-forest-600" />
                        Private main house
                      </span>
                    )}
                  </div>

                  {/* Sleeping arrangements — only for units the Hacienda has listed room by room */}
                  {a.sleeping && (
                    <div className="mt-6 rounded-2xl bg-cream-50 border border-forest-900/5 p-4 sm:p-5" data-testid={`sleeping-${a.id}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-eyebrow text-forest-600 inline-flex items-center gap-2">
                          <Bed size={14} className="text-forest-600" /> Sleeping arrangements
                        </div>
                        <div className="text-xs text-forest-700">
                          {a.sleeping.bedrooms} bedroom{a.sleeping.bedrooms > 1 ? 's' : ''} ·{' '}
                          {a.sleeping.beds.reduce((n, b) => n + b.count, 0)} beds
                          {a.sleeping.bathrooms !== undefined && (
                            <> · {a.sleeping.bathrooms} bathroom{a.sleeping.bathrooms > 1 ? 's' : ''}</>
                          )}
                        </div>
                      </div>
                      <ul className="mt-3 grid sm:grid-cols-3 gap-2 text-sm text-forest-800">
                        {a.sleeping.beds.map((b) => (
                          <li key={`${b.where}-${b.type}`} className="rounded-xl bg-white border border-forest-900/5 px-3 py-2">
                            <div className="font-medium text-forest-900">
                              {b.count} {b.type}
                            </div>
                            <div className="text-xs text-forest-700/70">{b.where}</div>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 text-[11px] text-forest-700/60">{a.sleeping.source}</div>
                    </div>
                  )}

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

                  <div className="mt-auto pt-8">
                    <div className="pt-6 border-t border-forest-900/5 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Rate</div>
                        <div className="font-serif text-2xl text-forest-900 mt-1">{rate.label}</div>
                        {rate.source && <div className="text-xs text-forest-700/70 mt-1">{rate.source}</div>}
                      </div>

                      <Link
                        to={`/book?accommodation=${a.id}`}
                        data-tour="accommodation-cta"
                        className="btn bg-forest-800 text-cream-50 hover:bg-forest-900 group/btn"
                      >
                        View Accommodation
                        <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <p className="mt-6 text-xs text-forest-700/70 max-w-2xl reveal">
          Rates, the refundable security deposit and payment plans are in{' '}
          <a href="#rates" className="underline underline-offset-2">Rates &amp; Fees</a>. The Hacienda confirms
          the final quote with you before anything is reserved.
        </p>
      </div>
    </section>
  )
}
