import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS, EXPERIENCES, NEARBY, STATS } from '../../config/site'
import { SmartImage } from '../../components/SmartImage'
import { ArrowRight, MapPin, Users } from '../../lib/icons'
import { QuickActions } from '../components/QuickActions'
import { Screen } from '../components/Screen'

export function HomeScreen() {
  return (
    <Screen className="pt-3">
      <div className="relative overflow-hidden rounded-[24px] h-[280px] text-cream-50 shadow-card">
        <SmartImage
          src="/images/gmaps/img-07.jpg"
          alt="Hacienda de LuisAna at dusk"
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/90 via-forest-950/35 to-forest-950/20" />
        <div className="relative z-10 h-full flex flex-col justify-end p-5">
          <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-eyebrow text-cream-100/80">
            <MapPin size={12} /> {BUSINESS.address.city}, {BUSINESS.address.region}
          </div>
          <h1 className="display text-[32px] leading-[1.05] mt-2">
            {BUSINESS.tagline}
          </h1>
          <p className="mt-2 text-cream-100/85 text-sm leading-snug">
            Private countryside stay for family, barkada, and quiet weekends.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/app/book" className="btn bg-cream-50 text-forest-900 hover:bg-white h-10 px-4 text-sm">
              Book a stay
            </Link>
            <Link to="/app/stay" className="btn bg-cream-50/10 text-cream-50 border border-cream-50/30 h-10 px-4 text-sm">
              See rooms
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <QuickActions />
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="shrink-0 rounded-2xl bg-forest-900 text-cream-50 px-4 py-3 min-w-[6.5rem]"
          >
            <div className="font-serif text-2xl leading-none">{s.value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-eyebrow text-cream-100/70">{s.label}</div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="eyebrow">Stay</div>
            <h2 className="font-serif text-2xl text-forest-900">Your way</h2>
          </div>
          <Link to="/app/stay" className="text-xs font-medium text-forest-700 inline-flex items-center gap-1">
            All <ArrowRight size={12} />
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4">
          {ACCOMMODATIONS.filter((a) => a.active).map((a) => (
            <Link
              key={a.id}
              to={`/app/book?accommodation=${a.id}`}
              className="snap-start shrink-0 w-[78%] rounded-[22px] overflow-hidden bg-white border border-forest-900/5 shadow-card"
            >
              <SmartImage src={a.images[0]} alt={a.name} className="h-36 w-full object-cover" />
              <div className="p-4">
                <div className="font-serif text-xl text-forest-900">{a.shortName}</div>
                <div className="mt-1 text-xs text-forest-700 inline-flex items-center gap-1.5">
                  <Users size={13} /> {a.capacityLabel}
                </div>
                <div className="mt-2 text-sm text-forest-800 font-medium">
                  {a.priceLabel || 'Contact for rates'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="eyebrow">Experiences</div>
        <h2 className="font-serif text-2xl text-forest-900 mb-3">Made for slow days</h2>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4">
          {EXPERIENCES.map((e) => (
            <div key={e.id} className="shrink-0 w-36">
              <div className="rounded-2xl overflow-hidden h-24">
                <SmartImage src={e.image} alt={e.title} className="h-full w-full object-cover" />
              </div>
              <div className="mt-2 text-sm font-medium text-forest-900">{e.title}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="eyebrow">Nearby</div>
            <h2 className="font-serif text-2xl text-forest-900">Adventure close by</h2>
          </div>
          <Link to="/app/explore" className="text-xs font-medium text-forest-700 inline-flex items-center gap-1">
            Explore <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {NEARBY.slice(0, 4).map((n) => (
            <a
              key={n.id}
              href={n.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl overflow-hidden bg-white border border-forest-900/5"
            >
              <SmartImage src={n.image} alt={n.name} className="h-24 w-full object-cover" />
              <div className="p-2.5 text-sm font-medium text-forest-900 leading-snug">{n.name}</div>
            </a>
          ))}
        </div>
      </section>
    </Screen>
  )
}
