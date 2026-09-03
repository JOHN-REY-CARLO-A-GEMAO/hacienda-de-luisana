import { NEARBY } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { ArrowRight, Compass, MapPin } from '../lib/icons'

export function Nearby() {
  return (
    <section id="nearby" className="py-24 lg:py-36 bg-cream-100/60">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 reveal">
          <div className="max-w-2xl">
            <div className="eyebrow">Nearby Adventures</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
              Adventure Is Never
              <br />
              <span className="italic font-light">Too Far Away</span>
            </h2>
          </div>
          <p className="max-w-md text-forest-800/80 leading-relaxed">
            The Luisiana countryside is stitched together with waterfalls, caves, heritage towns and
            lakes. Slow mornings at the Hacienda, big adventures within reach.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {NEARBY.map((n, i) => (
            <article
              key={n.id}
              className="reveal group bg-white rounded-3xl overflow-hidden border border-forest-900/5 hover:shadow-card transition-all duration-500 flex flex-col"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <div className="relative overflow-hidden">
                <SmartImage
                  src={n.image}
                  alt={n.name}
                  className="h-52 w-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.06]"
                />
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <h3 className="font-serif text-xl text-forest-900">{n.name}</h3>
                <p className="mt-2 text-sm text-forest-800/80 leading-relaxed flex-1">{n.description}</p>
                <div className="mt-4 flex items-center gap-4 text-[11px] uppercase tracking-eyebrow text-forest-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Compass size={12} /> {n.distance}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={12} /> {n.travelTime}
                  </span>
                </div>
                <a
                  href={n.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-forest-800 hover:text-forest-950 group/l"
                >
                  Explore
                  <ArrowRight size={14} className="transition-transform group-hover/l:translate-x-1" />
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
