import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, type Accommodation } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { SceneHeader } from '../components/Scene'
import { ArrowRight, Users } from '../lib/icons'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { type PublishedRates } from '../lib/booking'
import { displayedRate } from './Accommodations'

/**
 * Scene 03 — the accommodations preview.
 *
 * One card per Accommodation with the three facts that decide a booking: what
 * it is, how many it holds, and what it costs. Everything past that — the beds
 * room by room, the full amenity list, the sources behind each figure — is on
 * /stay, one click away, because none of it is needed to choose between three
 * options.
 *
 * The rate shown is the same one `Accommodations` and `Rates` render, computed by
 * `displayedRate`: the Admin's Published rates when they exist, the Hacienda's
 * listed price otherwise, and "quoted on request" when neither does. This
 * section never types in a figure of its own.
 */
export function StayPreview() {
  const published = usePublishedRates()
  const active = ACCOMMODATIONS.filter(
    (a) => a.active && published?.accommodations[a.id]?.active !== false,
  )

  return (
    <section id="stay" className="py-20 lg:py-28 bg-gradient-to-b from-cream-50 to-cream-100/50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <SceneHeader index="03" eyebrow="Accommodations" title="Stay Your Way" />
          <Link
            to="/stay"
            className="reveal btn-ghost shrink-0 group self-start lg:self-auto lg:mb-2"
          >
            All details
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {active.map((a, i) => (
            <StayPreviewCard key={a.id} accommodation={a} published={published} delay={i * 60} />
          ))}
        </div>

        <p className="mt-6 text-xs text-forest-700/70 max-w-2xl reveal">
          No account is required to book. A stay is confirmed only after the Hacienda approves your
          downpayment screenshot.
        </p>
      </div>
    </section>
  )
}

function StayPreviewCard({
  accommodation: a,
  published,
  delay,
}: {
  accommodation: Accommodation
  published: PublishedRates | null
  delay: number
}) {
  const rate = displayedRate(a, published)
  const propertyName = published?.accommodations[a.id]?.property_name?.trim() || a.name

  return (
    <article
      className="reveal bg-white rounded-[28px] overflow-hidden border border-forest-900/5 shadow-card flex flex-col hover:shadow-depth transition-shadow duration-700 ease-out-expo"
      style={{ transitionDelay: `${delay}ms` }}
      data-accommodation={a.id}
    >
      <div className="relative overflow-hidden bg-forest-100">
        <SmartImage
          src={a.images[0]}
          alt={`${a.name} — ${a.shortName}`}
          className="h-52 w-full object-cover"
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

      <div className="p-6 flex-1 flex flex-col">
        <h3 className="font-serif text-2xl text-forest-900">{propertyName}</h3>

        <div className="mt-3 inline-flex items-center gap-2 text-sm text-forest-800">
          <Users size={15} className="text-forest-600 shrink-0" />
          {a.capacityLabel}
        </div>

        <div className="mt-5 pt-5 border-t border-forest-900/5">
          <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Rate</div>
          <div className="font-serif text-xl text-forest-900 mt-1">{rate.label}</div>
          {rate.source && <div className="text-[11px] text-forest-700/70 mt-1">{rate.source}</div>}
        </div>

        <div className="mt-auto pt-6">
          <Link
            to={`/book?accommodation=${a.id}`}
            data-tour="accommodation-cta"
            className="btn bg-forest-800 text-cream-50 hover:bg-forest-900 w-full group/btn"
          >
            Book this room
            <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
          </Link>
        </div>
      </div>
    </article>
  )
}