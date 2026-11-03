import { Container } from '../components/ui'
import { useState } from 'react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, AIRBNB_RATING, BUSINESS, GETTING_HERE, NEARBY } from '../config/site'
import type { NearbyAttraction } from '../config/site'
import { MapPin, ArrowRight, Car, Navigation, Compass, Star, Close } from '../lib/icons'
import { SceneHeader } from '../components/Scene'

// Pin placement on the stylised area map, as a percent of the panel. Real
// geography stays with the Google embed (the "Google Maps" toggle) — these
// positions only spread the pins out so every spot is tappable.
const HACIENDA_PIN = { x: 52, y: 46 }
const SPOT_PINS: Record<string, { x: number; y: number }> = {
  'hulugan-falls': { x: 64, y: 24 },
  'kamay-ni-hesus': { x: 82, y: 42 },
  'aliw-falls': { x: 36, y: 58 },
  'sumucab-twin-falls': { x: 70, y: 74 },
  'caliraya-lake': { x: 18, y: 74 },
  'cavinti-cave': { x: 42, y: 88 },
}

export function Location() {
  const { lat, lng } = BUSINESS.coordinates
  const mapSrc = `https://www.google.com/maps?q=${lat},${lng}&z=13&output=embed`

  // Map panel state: 'area' shows the stylised pin map, 'google' the live embed.
  const [mapMode, setMapMode] = useState<'area' | 'google'>('area')
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null)

  // Cheapest published stay price for the map's price pin. Accommodations
  // without a published `price` are "quoted on request", never guessed.
  const fromPrice = ACCOMMODATIONS.reduce<number | null>(
    (min, a) => (typeof a.price === 'number' ? Math.min(min ?? a.price, a.price) : min),
    null,
  )
  const fromPriceLabel = fromPrice != null ? `from ₱${fromPrice.toLocaleString('en-PH')}` : 'quoted on request'
  const selectedNearby = NEARBY.find((s) => s.id === selectedSpot) ?? null

  const landmarks = [
    'Lucban Poblacion & Kamay ni Hesus',
    'Hulugan Falls trailhead (Luisiana)',
    'Caliraya Lake (Lumban / Cavinti)',
    'San Pablo & Sampaloc Lake',
  ]

  return (
    <section id="location" className="relative section-full bg-cream-50 dark:bg-forest-950 overflow-hidden">
      <Container width="wide">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <SceneHeader
            index="07"
            eyebrow="Location"
            title={
              <>
                Find Your Way
                <br />
                <span className="italic font-normal">to the Hacienda</span>
              </>
            }
          />
          <p className="reveal max-w-md text-forest-800/80 dark:text-cream-100/80 leading-relaxed lg:pb-2">
            Along the Luisiana–Lucban Road in Brgy. San Isidro, with the waterfalls, lakes and heritage
            towns of Laguna and Quezon within reach.
          </p>
        </div>

        {/* Immersive map panel — reference pattern: price pins over a map, a spot-count
            pill up top, and a listing card docked to the bottom edge on mobile. The live
            Google embed stays mounted behind the "Google Maps" toggle for real directions. */}
        <div className="mt-14 reveal">
          <div
            className="relative h-[540px] sm:h-[580px] lg:h-[620px] rounded-[32px] overflow-hidden border border-forest-900/5 shadow-depth bg-cream-100"
            onClick={() => setSelectedSpot(null)}
          >
            {/* Google embed — stays in the DOM (and for the content tests) even in area mode */}
            <div className={`absolute inset-0 ${mapMode === 'google' ? '' : 'hidden'}`}>
              <iframe
                title="Hacienda de LuisAna on Google Maps"
                src={mapSrc}
                className="h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
              {/* Vignette so the floating card reads against any map tile */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-forest-950/30 via-transparent to-transparent hidden lg:block" />
            </div>

            {/* Stylised area map with the hacienda price pin and nearby spot pins */}
            <div className={`absolute inset-0 ${mapMode === 'area' ? '' : 'hidden'}`}>
              <AreaMapSvg />

              {/* Hacienda price pin — the reference's price pill on the map */}
              <Link
                to="/stay"
                aria-label={`${BUSINESS.name} — view stays, ${fromPriceLabel} per night`}
                className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${HACIENDA_PIN.x}%`, top: `${HACIENDA_PIN.y}%` }}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="absolute left-1/2 top-1/2 -z-10 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-brass-400/40" />
                <span className="flex items-center gap-1.5 rounded-full bg-brass-400 py-1.5 pl-2.5 pr-3.5 text-xs font-bold text-forest-950 shadow-float ring-2 ring-white/80 transition-transform group-hover:scale-105">
                  <MapPin size={13} />
                  {fromPriceLabel}
                  <span className="font-semibold text-forest-900/60">/night</span>
                </span>
                <span className="mx-auto mt-1.5 block w-fit whitespace-nowrap rounded-full bg-white/95 px-2.5 py-0.5 text-[10px] font-semibold text-forest-800 shadow">
                  {BUSINESS.name}
                </span>
              </Link>

              {/* Nearby spot pins — tap to open the spot card */}
              {NEARBY.map((spot) => {
                const pin = SPOT_PINS[spot.id] ?? { x: 50, y: 50 }
                const selected = selectedSpot === spot.id
                return (
                  <button
                    key={spot.id}
                    type="button"
                    aria-label={spot.name}
                    aria-pressed={selected}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedSpot(selected ? null : spot.id)
                    }}
                    className="group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                  >
                    <span
                      className={`block h-3.5 w-3.5 rounded-full border-2 border-white shadow-md transition-colors ${
                        selected ? 'bg-brass-500' : 'bg-forest-700 group-hover:bg-brass-500'
                      }`}
                    />
                    <span
                      className={`mt-1 whitespace-nowrap rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-forest-800 shadow transition-opacity ${
                        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                      }`}
                    >
                      {spot.name}
                    </span>
                  </button>
                )
              })}

              {selectedNearby && (
                <SpotCard
                  spot={selectedNearby}
                  pin={SPOT_PINS[selectedNearby.id] ?? { x: 50, y: 50 }}
                  onClose={() => setSelectedSpot(null)}
                />
              )}
            </div>

            {/* Spot-count pill — the reference's "Over 1,000 places" badge */}
            <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-full border border-forest-900/5 bg-white/95 px-4 py-2 shadow-float">
              <MapPin size={14} className="shrink-0 text-brass-600" />
              <span className="text-xs font-semibold text-forest-900 sm:text-sm">
                <span className="sm:hidden">{NEARBY.length} spots</span>
                <span className="hidden sm:inline">
                  {NEARBY.length} spots around {BUSINESS.address.city}
                </span>
              </span>
              <span className="hidden text-xs text-forest-700/70 md:inline">· stays {fromPriceLabel}/night</span>
            </div>

            {/* Map mode toggle */}
            <div className="absolute right-3 top-3 z-20 flex rounded-full border border-forest-900/5 bg-white/95 p-1 shadow-float">
              {(
                [
                  { mode: 'area' as const, label: 'Area map' },
                  { mode: 'google' as const, label: 'Google Maps' },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  aria-pressed={mapMode === opt.mode}
                  onClick={() => {
                    setMapMode(opt.mode)
                    setSelectedSpot(null)
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mapMode === opt.mode ? 'bg-forest-900 text-cream-50' : 'text-forest-800 hover:bg-forest-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Address card floats over the map on desktop */}
            <div className="hidden lg:absolute lg:bottom-8 lg:left-8 lg:z-20 lg:block lg:w-[380px] bg-forest-900 text-cream-100 p-8 lg:rounded-[28px] lg:shadow-float">
              <div className="eyebrow text-cream-100/70">Address</div>
              <div className="mt-3 font-serif text-2xl leading-snug text-cream-50">
                {BUSINESS.address.formatted}
              </div>
              <div className="mt-3 text-cream-100/70 text-sm">
                Approximate map location: {BUSINESS.coordinates.lat.toFixed(4)}, {BUSINESS.coordinates.lng.toFixed(4)}. Confirm the exact pin with the Hacienda before travelling.
              </div>

              <a
                href={BUSINESS.contact.directions}
                target="_blank"
                rel="noreferrer"
                className="btn-on-dark group mt-8"
              >
                <MapPin size={16} /> Get Directions
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </a>
              <p className="mt-2 text-xs text-cream-100/70">Opens Google Maps in a new tab.</p>
            </div>

            {/* Listing card docked to the bottom edge of the map on mobile —
                the reference's bottom sheet over the map */}
            <Link
              to="/stay"
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-[20px] border border-forest-900/5 bg-white/95 p-3 shadow-float backdrop-blur lg:hidden"
            >
              <img
                src={ACCOMMODATIONS[0].images[0]}
                alt={BUSINESS.name}
                className="h-16 w-16 shrink-0 rounded-xl object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-forest-900">{BUSINESS.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-forest-800/80">
                  <Star size={11} className="shrink-0 text-brass-500" />
                  {AIRBNB_RATING.rating.toFixed(1)} ({AIRBNB_RATING.reviewCount} reviews)
                  {AIRBNB_RATING.guestFavorite && (
                    <span className="ml-1 rounded-full bg-forest-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-forest-700">
                      Guest favorite
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold text-forest-900">
                  {fromPriceLabel} / night · {BUSINESS.address.city}, {BUSINESS.address.region}
                </span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest-900 text-cream-50">
                <ArrowRight size={15} />
              </span>
            </Link>
          </div>

          <div className="mt-6 bg-white dark:bg-forest-900 rounded-[28px] p-8 border border-forest-900/5 dark:border-cream-100/10 shadow-card">
            <div className="eyebrow">Nearby Landmarks</div>
            <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-forest-800 dark:text-cream-100/85">
              {landmarks.map((l) => (
                <li key={l} className="flex items-start gap-3">
                  <MapPin size={16} className="mt-1 text-forest-600 dark:text-sage-400 shrink-0" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Getting here — the landmark and the two standard routes, no invented travel times */}
        <div id="getting-here" className="scroll-mt-24 lg:scroll-mt-28 mt-8 grid md:grid-cols-3 gap-6">
          <div className="reveal card p-7 lg:p-8">
            <div className="w-11 h-11 rounded-xl bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 mb-4">
              <Compass size={20} />
            </div>
            <div className="eyebrow">Getting here</div>
            <h3 className="font-serif text-2xl text-forest-900 dark:text-cream-50 mt-2">{GETTING_HERE.landmark.title}</h3>
            <p className="mt-3 text-sm text-forest-800/85 dark:text-cream-100/85 leading-relaxed">{GETTING_HERE.landmark.body}</p>
          </div>

          <RouteCard icon={Car} title={GETTING_HERE.byCar.title} steps={GETTING_HERE.byCar.steps} />
          <RouteCard icon={Navigation} title={GETTING_HERE.byCommute.title} steps={GETTING_HERE.byCommute.steps} />
        </div>

        <p className="mt-6 text-xs text-forest-700/70 dark:text-cream-100/75 max-w-2xl reveal">
          Travel times depend on the day and the traffic, so we don't quote one. If you're unsure about the last
          stretch, message the Hacienda before you set off.
        </p>
      </Container>
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
    <div className="reveal card p-7 lg:p-8">
      <div className="w-11 h-11 rounded-xl bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 mb-4">
        <Icon size={20} />
      </div>
      <div className="eyebrow">Route</div>
      <h3 className="font-serif text-2xl text-forest-900 dark:text-cream-50 mt-2">{title}</h3>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm text-forest-800/85 dark:text-cream-100/85 leading-relaxed">
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

/**
 * Stylised area map backdrop in the project palette — a "paper map" of the
 * towns around the Hacienda (cream land, sage forest patches, the main
 * Luisiana–Lucban road). It is decorative; the pins and labels are HTML on
 * top, and the live map is one toggle away.
 */
function AreaMapSvg() {
  return (
    <svg
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="1200" height="700" fill="#F5F1E8" />
      {/* forest patches */}
      <ellipse cx="170" cy="130" rx="160" ry="95" fill="#d7e1d5" />
      <ellipse cx="640" cy="105" rx="140" ry="75" fill="#d7e1d5" />
      <ellipse cx="1060" cy="105" rx="180" ry="105" fill="#c0cfbc" opacity="0.85" />
      <ellipse cx="240" cy="590" rx="190" ry="105" fill="#d7e1d5" />
      <ellipse cx="990" cy="600" rx="210" ry="115" fill="#c0cfbc" opacity="0.8" />
      <ellipse cx="55" cy="390" rx="110" ry="85" fill="#d7e1d5" />
      {/* Caliraya Lake */}
      <path d="M120 545 q70 -45 150 -12 q55 28 8 66 q-70 34 -138 2 q-42 -34 -20 -56 z" fill="#c3d9d2" />
      {/* river */}
      <path
        d="M760 720 C 780 610 700 550 735 470 C 770 395 860 380 895 290"
        stroke="#c3d9d2"
        strokeWidth="15"
        fill="none"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* secondary roads */}
      <path d="M560 720 C 585 580 520 440 585 300 C 630 200 610 100 650 -20" stroke="#c6d6c1" strokeWidth="7" fill="none" />
      <path d="M300 720 C 335 580 430 520 560 430" stroke="#c6d6c1" strokeWidth="7" fill="none" />
      <path d="M700 430 C 830 490 1000 505 1220 530" stroke="#c6d6c1" strokeWidth="7" fill="none" />
      <path d="M585 300 C 740 250 920 210 1220 170" stroke="#c6d6c1" strokeWidth="6" fill="none" />
      <path d="M585 300 C 450 250 300 220 60 200" stroke="#c6d6c1" strokeWidth="6" fill="none" />
      {/* main road: the Luisiana–Lucban Rd, passing the hacienda pin (~52%, 46%) */}
      <path
        d="M-20 500 C 220 460 430 400 620 330 C 840 250 1040 230 1220 210"
        stroke="#9ab895"
        strokeWidth="12"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-20 500 C 220 460 430 400 620 330 C 840 250 1040 230 1220 210"
        stroke="#FAF7F2"
        strokeWidth="2.5"
        fill="none"
        strokeDasharray="16 14"
      />
      {/* town labels */}
      <g
        fill="#243D2E"
        opacity="0.5"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="19"
        fontWeight="600"
        letterSpacing="4"
      >
        <text x="668" y="385">LUISIANA</text>
        <text x="985" y="160">LUCBAN</text>
        <text x="430" y="665">CAVINTI</text>
        <text x="70" y="480">LUMBAN</text>
        <text x="110" y="80">STA. CRUZ</text>
      </g>
    </svg>
  )
}

/** Popover shown when a nearby spot pin is tapped — photo, town, and the real map link. */
function SpotCard({
  spot,
  pin,
  onClose,
}: {
  spot: NearbyAttraction
  pin: { x: number; y: number }
  onClose: () => void
}) {
  const below = pin.y > 60
  const clampedX = Math.min(Math.max(pin.x, 22), 78)
  return (
    <div
      className="absolute z-30 w-[220px] rounded-2xl border border-forest-900/5 bg-white p-3 shadow-float"
      style={{
        left: `${clampedX}%`,
        top: `${pin.y}%`,
        transform: below ? 'translate(-50%, 20px)' : 'translate(-50%, calc(-100% - 20px))',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${spot.name}`}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-forest-800 shadow"
      >
        <Close size={12} />
      </button>
      <img src={spot.image} alt={spot.name} className="h-24 w-full rounded-xl object-cover" />
      <div className="mt-2 pr-5 text-sm font-semibold text-forest-900">{spot.name}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-forest-700/70">{spot.area}</div>
      {spot.mapsUrl && (
        <a
          href={spot.mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-forest-700 underline underline-offset-2"
        >
          <MapPin size={12} /> Open in Google Maps
        </a>
      )}
    </div>
  )
}
