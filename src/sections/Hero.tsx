import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, MapPin, Star } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'
import { FoliageBranch, FoliageCorner } from '../components/decor/Foliage'
import { AIRBNB_RATING, BUSINESS } from '../config/site'
import { useHeroDepth, usePointerDepthEnabled, usePrefersReducedMotion } from '../lib/motion'

/**
 * Scene 01 — layered hero.
 *
 * Depth is built from three transform-only layers around the Hacienda's own
 * dusk photograph: the photo (slow), the headline block (medium) and abstract
 * foliage silhouettes (fast, opposite direction). Reduced-motion visitors get
 * the same composition, static. All CTAs and the `hero-cta` tutorial anchor
 * are unchanged.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const fore = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const pointer = usePointerDepthEnabled()
  useHeroDepth(section, back, fore, content, { reducedMotion, pointer })

  return (
    <section
      ref={section}
      className="hero relative h-[100svh] min-h-[640px] w-full overflow-hidden bg-forest-950 text-cream-50"
      data-motion={reducedMotion ? 'reduced' : 'full'}
    >
      {/* Layer 0 — sky & photograph (moves slowest) */}
      <div ref={back} className="hero-layer absolute -inset-[6%]" data-hero-layer="back">
        <SmartImage
          src="/images/gmaps/img-07.jpg"
          alt="Hacienda de LuisAna at dusk — the main house glowing warm with a campfire and A-frame camping units on the lawn"
          loading="eager"
          className={`h-full w-full object-cover ${reducedMotion ? '' : 'animate-kenburns'}`}
        />
        {/* Horizon haze: lifts the sky and separates it from the foreground */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b1a12]/55 via-transparent to-transparent" />
      </div>

      {/* Legibility overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-forest-950/45 via-forest-950/15 to-forest-950/75" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(11,26,18,0.62)_100%)]" />

      {/* Layer 2 — foreground foliage (moves fastest, decorative only) */}
      <div ref={fore} className="hero-layer absolute inset-0 pointer-events-none select-none" data-hero-layer="fore" aria-hidden="true">
        <FoliageCorner
          side="left"
          className="foliage absolute -bottom-6 -left-8 w-[80vw] max-w-[600px] sm:w-[48vw] lg:w-[40vw] text-[#06120c] opacity-95"
        />
        <FoliageCorner
          side="right"
          className="foliage absolute -bottom-10 -right-10 hidden sm:block w-[46vw] lg:w-[36vw] max-w-[560px] text-[#06120c] opacity-90"
        />
        <FoliageBranch
          className="foliage absolute -top-4 -right-6 hidden md:block w-[34vw] max-w-[440px] text-[#071510] opacity-75"
        />
      </div>

      {/* Layer 1 — content */}
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 flex items-center">
          <div className="mx-auto max-w-7xl w-full px-5 lg:px-8">
            <div ref={content} className="hero-layer max-w-3xl animate-fade-in" data-hero-layer="content">
              <div className="inline-flex items-center gap-2 rounded-full border border-cream-50/25 bg-cream-50/5 backdrop-blur-sm px-3.5 py-1.5 text-[11px] uppercase tracking-eyebrow text-cream-100">
                <MapPin size={13} />
                {BUSINESS.address.city}, {BUSINESS.address.region} • {BUSINESS.address.country}
              </div>

              <h1 className="display text-[44px] sm:text-6xl lg:text-[88px] mt-6 leading-[1.02] drop-shadow-[0_2px_24px_rgba(0,0,0,0.35)]">
                Escape to the
                <br />
                <span className="italic font-light">Quiet Side</span> of Laguna
              </h1>

              <p className="mt-5 text-cream-100 text-sm sm:text-base uppercase tracking-[0.18em] font-medium">
                Private countryside stay near Laguna attractions
              </p>
              <p className="mt-4 max-w-xl text-cream-100/85 text-base sm:text-lg leading-relaxed">
                A peaceful private stay in Luisiana, Laguna — made for family bonding, weekend
                escapes, small gatherings, and unforgettable countryside moments.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <Link to="/book" data-tour="hero-cta" className="btn bg-cream-50 text-forest-900 hover:bg-white shadow-glow">
                  Check Availability
                </Link>
                <a href="#stay" className="btn-secondary">
                  Explore Hacienda
                </a>
              </div>

              {/* Airbnb's rating of the listing — dated in config, refreshed rather than assumed */}
              <a
                href={AIRBNB_RATING.url}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-cream-50/25 bg-forest-950/30 backdrop-blur-sm px-3.5 py-1.5 text-xs text-cream-100 hover:bg-forest-950/50 transition"
                aria-label={`Rated ${AIRBNB_RATING.rating.toFixed(1)} out of 5 on Airbnb from ${AIRBNB_RATING.reviewCount} reviews`}
              >
                <Star size={13} className="text-olive-300" />
                <span className="font-medium">{AIRBNB_RATING.rating.toFixed(1)}</span>
                <span className="text-cream-100/80">on Airbnb · {AIRBNB_RATING.reviewCount} reviews</span>
                {AIRBNB_RATING.superhost && (
                  <>
                    <span className="text-cream-100/40">|</span>
                    <span className="text-cream-100/90">Superhost</span>
                  </>
                )}
              </a>
              <Link
                to="/account"
                className="mt-5 sm:ml-3 inline-flex lg:hidden text-sm text-cream-100/80 underline underline-offset-4"
              >
                My Bookings
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom strip: scene marker, scroll cue, at-a-glance facts (all from config) */}
        <div className="mx-auto max-w-7xl w-full px-5 lg:px-8 pb-24 lg:pb-9 flex items-end justify-between gap-6">
          <div className="hidden sm:block text-[11px] uppercase tracking-eyebrow text-cream-100/60">
            <span className="font-serif text-2xl text-cream-50/90 not-italic tracking-normal mr-3">01</span>
            {BUSINESS.tagline}
          </div>
          <a
            href="#intro"
            className="flex flex-col items-center gap-2 text-cream-100/70 hover:text-cream-100 transition group mx-auto sm:mx-0"
          >
            <span className="text-[10px] uppercase tracking-eyebrow">Discover the Hacienda</span>
            <ArrowDown size={18} className={reducedMotion ? '' : 'animate-bounce'} />
          </a>
          <dl className="hidden lg:grid grid-cols-3 gap-6 rounded-2xl border border-cream-50/15 bg-forest-950/35 backdrop-blur-md px-6 py-4 text-cream-50 lg:mr-28">
            <div>
              <dt className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Guests</dt>
              <dd className="font-serif text-2xl leading-tight mt-1">Up to {BUSINESS.policies.maxGuests}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Check-in</dt>
              <dd className="font-serif text-2xl leading-tight mt-1">{BUSINESS.policies.checkIn}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Check-out</dt>
              <dd className="font-serif text-2xl leading-tight mt-1">{BUSINESS.policies.checkOut}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
