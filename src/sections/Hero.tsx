import { Link } from 'react-router-dom'
import { ArrowDown, MapPin } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'
import { BUSINESS } from '../config/site'

export function Hero() {
  return (
    <section className="relative h-[100svh] min-h-[640px] w-full overflow-hidden text-cream-50">
      <div className="absolute inset-0">
        <SmartImage
          src="/images/gmaps/img-07.jpg"
          alt="Hacienda de LuisAna at dusk — the main house glowing warm with a campfire and A-frame camping units on the lawn"
          loading="eager"
          className="h-full w-full object-cover animate-kenburns"
        />
      </div>
      {/* Dark overlay for legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-forest-950/50 via-forest-950/25 to-forest-950/80" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(15,28,17,0.6)_100%)]" />

      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 flex items-center">
          <div className="mx-auto max-w-7xl w-full px-5 lg:px-8">
            <div className="max-w-3xl animate-fade-in">
              <div className="inline-flex items-center gap-2 rounded-full border border-cream-50/25 bg-cream-50/5 backdrop-blur-sm px-3.5 py-1.5 text-[11px] uppercase tracking-eyebrow text-cream-100">
                <MapPin size={13} />
                {BUSINESS.address.city}, {BUSINESS.address.region} • {BUSINESS.address.country}
              </div>

              <h1 className="display text-[44px] sm:text-6xl lg:text-[88px] mt-6 leading-[1.02]">
                Escape to the
                <br />
                <span className="italic font-light">Quiet Side</span> of Laguna
              </h1>

              <p className="mt-6 max-w-xl text-cream-100/90 text-base sm:text-lg leading-relaxed">
                A peaceful private stay in Luisiana, Laguna — made for family bonding, weekend
                escapes, small gatherings, and unforgettable countryside moments.
              </p>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link to="/book" className="btn bg-cream-50 text-forest-900 hover:bg-white shadow-soft">
                  Check Availability
                </Link>
                <a href="#stay" className="btn-secondary">
                  Explore Hacienda
                </a>
              </div>
            </div>
          </div>
        </div>

        <a
          href="#intro"
          className="mb-8 self-center flex flex-col items-center gap-2 text-cream-100/70 hover:text-cream-100 transition group"
        >
          <span className="text-[10px] uppercase tracking-eyebrow">Discover the Hacienda</span>
          <ArrowDown size={18} className="animate-bounce" />
        </a>
      </div>
    </section>
  )
}
