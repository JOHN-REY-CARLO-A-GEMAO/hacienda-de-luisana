import { BUSINESS } from '../config/site'
import { MapPin, ArrowRight } from '../lib/icons'

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
      </div>
    </section>
  )
}
