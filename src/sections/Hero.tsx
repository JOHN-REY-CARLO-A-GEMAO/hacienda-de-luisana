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
      className="hero relative flex min-h-[max(100svh,640px)] w-full flex-col overflow-hidden bg-forest-950 text-cream-50"
      data-motion={reducedMotion ? 'reduced' : 'full'}
    >
      {/* Layer 0 — sky & photograph (moves slowest) */}
      <div ref={back} className="hero-layer absolute -inset-[6%]" data-hero-layer="back">
        <SmartImage
          src="/images/gmaps/img-07.jpg"
          alt="Hacienda de LuisAna at dusk — the main house glowing warm with a campfire and A-frame camping units on the lawn"
          loading="eager"
          fetchpriority="high"
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

      {/* Layer 1 — content.
          `pt-*` reserves the fixed nav's band (h-16 = 64px, lg:h-20 = 80px) so the
          centred block can never ride up under the logo on a short viewport. The
          section is `min-h-[max(100svh,640px)]` rather than a fixed height, so a
          viewport too short to hold the block makes the hero grow instead of
          pushing its first line behind the nav. */}
      <div className="relative z-10 flex flex-1 flex-col pt-16 lg:pt-24">
        <div className="flex flex-1 items-center">
          <div className="mx-auto max-w-7xl w-full px-5 lg:px-8">
            <div ref={content} className="hero-layer relative max-w-3xl animate-fade-in" data-hero-layer="content">
              <div className="inline-flex items-center gap-2 rounded-full border border-cream-50/25 bg-cream-50/5 backdrop-blur-sm px-3.5 py-1.5 text-[11px] uppercase tracking-eyebrow text-cream-100">
                <MapPin size={13} className="text-brass-300" />
                <span>{BUSINESS.address.city}, {BUSINESS.address.region} • {BUSINESS.address.country}</span>
              </div>

              <h1 className="display text-4xl sm:text-6xl lg:text-7xl mt-5 leading-[1.08] text-cream-50 drop-shadow-[0_2px_24px_rgba(0,0,0,0.35)]">
                Your Escape Starts Here.
              </h1>

              <p className="mt-4 max-w-xl text-cream-100/90 text-base sm:text-lg leading-relaxed font-normal">
                Private countryside stay near Laguna attractions — villa accommodations and peaceful lawn
                camping in Luisiana, Laguna, made for relaxing family gatherings and quiet days in nature.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#stay" className="btn bg-cream-50 text-forest-950 hover:bg-white shadow-soft font-semibold text-sm px-6 py-3">
                  Explore Our Stays
                </a>
                <Link to="/book" data-tour="hero-cta" className="btn-secondary text-sm px-6 py-3 font-medium">
                  Book a room · Check Availability
                </Link>
              </div>

              {/* Airbnb's rating of the listing — dated in config, refreshed rather than assumed */}
              <a
                href={AIRBNB_RATING.url}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-cream-100/25 bg-forest-950/45 backdrop-blur-md px-3.5 py-1.5 text-xs text-cream-100 hover:bg-forest-950/65 transition"
                aria-label={`Rated ${AIRBNB_RATING.rating.toFixed(1)} out of 5 on Airbnb from ${AIRBNB_RATING.reviewCount} reviews`}
              >
                <Star size={13} className="text-brass-400" />
                <span className="font-semibold text-white">{AIRBNB_RATING.rating.toFixed(1)}</span>
                <span className="text-cream-100/80">on Airbnb · {AIRBNB_RATING.reviewCount} reviews</span>
                {AIRBNB_RATING.superhost && (
                  <>
                    <span className="text-cream-100/40">·</span>
                    <span className="text-cream-100/90 font-medium">Superhost</span>
                  </>
                )}
              </a>
              <Link
                to="/account"
                className="mt-5 sm:ml-4 inline-flex lg:hidden text-sm text-cream-100/90 underline underline-offset-4"
              >
                My Bookings
              </Link>
              {/* A scrim that travels with the copy block, so the paragraph keeps its
                  contrast over the busiest part of the photograph (the lit house, the
                  fence) whatever sits behind it. Last child on purpose: the browser QA
                  script reads the first child div as the eyebrow badge. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-x-6 -inset-y-10 -z-10 rounded-[2.5rem] bg-forest-950/55 blur-2xl"
              />
            </div>
          </div>
        </div>

        {/* Bottom strip: scene marker, scroll cue, at-a-glance facts (all from
            config). `pb-24` clears the mobile sticky CTA; `lg:pb-20` clears the
            floating "Replay tutorial" pill, so the strip sits above that pill in
            its own band instead of the card being shoved inboard to dodge it. */}
        <div className="mx-auto max-w-7xl w-full px-5 lg:px-8 pb-24 lg:pb-20 flex items-end justify-between gap-6">
          <div className="hidden sm:block text-[11px] uppercase tracking-eyebrow text-cream-100/60">
            <span className="font-serif text-2xl text-cream-50/90 not-italic tracking-normal mr-3">01</span>
            {BUSINESS.tagline}
          </div>
          <a
            href="#intro"
            className="flex flex-col items-center gap-2 text-cream-100/70 hover:text-cream-100 transition group mx-auto lg:mx-0"
          >
            <span className="text-[10px] uppercase tracking-eyebrow">Discover the Hacienda</span>
            <ArrowDown size={18} className={reducedMotion ? '' : 'animate-bounce'} />
          </a>
          <dl className="hidden lg:grid grid-cols-3 gap-6 rounded-2xl border border-cream-50/15 bg-forest-950/35 backdrop-blur-md px-6 py-4 text-cream-50">
            <div>
              <dt className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Main House base rate</dt>
              <dd className="font-serif text-2xl leading-tight mt-1">{BUSINESS.policies.mainHouseIncludedGuests} guests included</dd>
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
