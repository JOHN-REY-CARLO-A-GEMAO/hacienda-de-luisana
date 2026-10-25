import { Container } from '../components/ui'
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
    <section id="stay" className="section-roomy bg-gradient-to-b from-cream-50 to-cream-100/50 dark:from-forest-950 dark:to-forest-900/60 transition-colors duration-300">
      <Container width="wide">
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

        <p className="reveal mt-6 max-w-3xl text-base leading-relaxed text-forest-800 dark:text-cream-200/80">
          Hindi kailangan ng account. Pagkatapos pumili at magpadala ng patunay ng downpayment, ang booking ay
          magiging <strong>Pending</strong>. Kumpirmado lamang ito kapag naaprubahan na ng Hacienda.
        </p>
      </Container>
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
      className="reveal bg-white dark:bg-forest-900 rounded-[28px] overflow-hidden border border-forest-900/5 dark:border-cream-100/10 shadow-card flex flex-col hover:shadow-depth transition-all duration-500 ease-out-expo"
      style={{ transitionDelay: `${delay}ms` }}
      data-accommodation={a.id}
    >
      <div className="relative overflow-hidden bg-forest-100 dark:bg-forest-800">
        <SmartImage
          src={a.images[0]}
          alt={`${a.name} — ${a.shortName}`}
          className="h-52 w-full object-cover"
        />
        <div className="absolute top-4 left-4 flex gap-2">
          <span className="rounded-full bg-cream-50/95 dark:bg-forest-950/90 text-forest-900 dark:text-cream-50 text-xs uppercase tracking-eyebrow px-3 py-1.5 backdrop-blur font-medium">
            {a.shortName}
          </span>
          {a.availableUnits && (
            <span className="rounded-full bg-forest-800/90 dark:bg-brass-500 text-cream-50 dark:text-forest-950 text-xs uppercase tracking-eyebrow px-3 py-1.5 font-medium">
              {a.availableUnits} units available
            </span>
          )}
        </div>
      </div>

      <div className="p-6 flex-1 flex flex-col">
        <h3 className="font-serif text-2xl text-forest-900 dark:text-cream-50">{propertyName}</h3>

        <div className="mt-3 inline-flex items-center gap-2 text-base text-forest-800 dark:text-cream-100/85">
          <Users size={19} className="shrink-0 text-forest-600 dark:text-sage-400" aria-hidden="true" />
          {a.capacityLabel}
        </div>

        <div className="mt-5 pt-5 border-t border-forest-900/5 dark:border-cream-100/10">
          <div className="text-sm font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">Presyo (Rate)</div>
          <div className="mt-1 font-serif text-2xl text-forest-900 dark:text-cream-50">{rate.label}</div>
          {rate.source && <div className="mt-1 text-sm text-forest-700 dark:text-cream-200/70">{rate.source}</div>}
        </div>

        <div className="mt-auto pt-6">
          <Link
            to={`/book?accommodation=${a.id}`}
            data-tour="accommodation-cta"
            className="btn-primary w-full group/btn"
          >
            Book this room · Piliin Ito
            <ArrowRight size={20} className="transition-transform group-hover/btn:translate-x-1" />
          </Link>
        </div>
      </div>
    </article>
  )
}