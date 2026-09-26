import type { ComponentType } from 'react'
import { BUSINESS, GETTING_HERE } from '../config/site'
import { MapPin, ArrowRight, Car, Navigation, Compass } from '../lib/icons'

export function Location() {
  const { lat, lng } = BUSINESS.coordinates
  const mapSrc = `https://www.google.com/maps?q=${lat},${lng}&z=13&output=embed`

  const landmarks = [
    'Lucban Poblacion & Kamay ni Hesus',
    'Hulugan Falls trailhead (Luisiana)',
    'Caliraya Lake (Lumban / Cavinti)',
    'San Pablo & Sampaloc Lake',
  ]

  return (
    <section id="location" className="py-24 lg:py-36 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl reveal">
          <div className="eyebrow">Location</div>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
            Find Your Way
            <br />
            <span className="italic font-light">to the Hacienda</span>
          </h2>
        </div>

        <div className="mt-14 grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 reveal rounded-[28px] overflow-hidden border border-forest-900/5 shadow-card bg-white">
            <iframe
              title="Hacienda de LuisAna on Google Maps"
              src={mapSrc}
              className="w-full h-[480px] lg:h-[520px] border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>

          <div className="lg:col-span-2 reveal flex flex-col">
            <div className="bg-forest-900 text-cream-100 rounded-[28px] p-8 lg:p-10 shadow-card">
              <div className="eyebrow text-cream-100/70">Address</div>
              <div className="mt-3 font-serif text-2xl leading-snug text-cream-50">
                {BUSINESS.address.formatted}
              </div>
              <div className="mt-3 text-cream-100/70 text-sm">
                Approx. {BUSINESS.coordinates.lat.toFixed(4)}, {BUSINESS.coordinates.lng.toFixed(4)}
              </div>

              <a
                href={BUSINESS.contact.directions}
                target="_blank"
                rel="noreferrer"
                className="btn bg-cream-50 text-forest-900 hover:bg-white mt-8 group"
              >
                <MapPin size={16} /> Get Directions
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </a>
            </div>

            <div className="mt-6 bg-white rounded-[28px] p-8 border border-forest-900/5">
              <div className="eyebrow">Nearby Landmarks</div>
              <ul className="mt-4 space-y-3 text-forest-800">
                {landmarks.map((l) => (
                  <li key={l} className="flex items-start gap-3">
                    <MapPin size={16} className="mt-1 text-forest-600 shrink-0" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Getting here — the landmark and the two standard routes, no invented travel times */}
        <div id="getting-here" className="mt-8 grid md:grid-cols-3 gap-6">
          <div className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8">
            <div className="w-11 h-11 rounded-xl bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 mb-4">
              <Compass size={20} />
            </div>
            <div className="eyebrow">Getting here</div>
            <h3 className="font-serif text-2xl text-forest-900 mt-2">{GETTING_HERE.landmark.title}</h3>
            <p className="mt-3 text-sm text-forest-800/85 leading-relaxed">{GETTING_HERE.landmark.body}</p>
          </div>

          <RouteCard icon={Car} title={GETTING_HERE.byCar.title} steps={GETTING_HERE.byCar.steps} />
          <RouteCard icon={Navigation} title={GETTING_HERE.byCommute.title} steps={GETTING_HERE.byCommute.steps} />
        </div>

        <p className="mt-6 text-xs text-forest-700/70 max-w-2xl reveal">
          Travel times depend on the day and the traffic, so we don't quote one. If you're unsure about the last
          stretch, message the Hacienda before you set off.
        </p>
      </div>
    </section>
  )
}

function RouteCard({
  icon: Icon,
  title,
  steps,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  steps: readonly string[]
}) {
  return (
    <div className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8">
      <div className="w-11 h-11 rounded-xl bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 mb-4">
        <Icon size={20} />
      </div>
      <div className="eyebrow">Route</div>
      <h3 className="font-serif text-2xl text-forest-900 mt-2">{title}</h3>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm text-forest-800/85 leading-relaxed">
            <span className="mt-0.5 w-6 h-6 rounded-full bg-forest-900 text-cream-50 text-[11px] font-medium flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
