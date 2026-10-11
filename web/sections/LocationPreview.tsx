import { Link } from 'react-router-dom'
import { BUSINESS, GALLERY } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { MapPin, ArrowRight, Navigation } from '../lib/icons'
import { SceneHeader } from '../components/Scene'

/**
 * Scene 09 — the location preview.
 *
 * Where the Hacienda is and how to open it in Maps. The embed, the address card,
 * the landmarks and both arrival routes are on /location: they are what a guest
 * reads in the week before a stay, not while deciding whether to book one.
 *
 * The directions link goes to the Hacienda's own Google Maps directions URL, the
 * same target the full page and the contact page use.
 */
export function LocationPreview() {
  const approach = GALLERY.find((g) => g.id === 'g11')

  return (
    <section id="location" className="relative py-20 lg:py-28 bg-cream-50 overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <SceneHeader index="09" eyebrow="Location" title="Find Your Way to the Hacienda">
            <p>
              Along the Luisiana–Lucban Road in Brgy. San Isidro, with the waterfalls, lakes and
              heritage towns of Laguna and Quezon within reach.
            </p>
          </SceneHeader>
          <Link to="/location" className="reveal btn-ghost shrink-0 group self-start lg:self-auto lg:mb-2">
            Directions &amp; getting here
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <div className="mt-12 grid lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 reveal bg-white rounded-[32px] border border-forest-900/5 shadow-card p-8 lg:p-10 flex flex-col justify-center">
            <div className="eyebrow">Address</div>
            <div className="mt-3 font-serif text-2xl lg:text-3xl leading-snug text-forest-900">
              {BUSINESS.address.formatted}
            </div>
            <div className="mt-3 text-forest-700 text-sm">
              Approx. {BUSINESS.coordinates.lat.toFixed(4)}, {BUSINESS.coordinates.lng.toFixed(4)}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={BUSINESS.contact.directions}
                target="_blank"
                rel="noreferrer"
                className="btn bg-forest-800 text-cream-50 hover:bg-forest-900 group"
              >
                <MapPin size={16} /> Get Directions
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href={BUSINESS.contact.googleMaps}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                <Navigation size={16} /> Open in Maps
              </a>
            </div>
          </div>

          {/* A photograph rather than an iframe: the map embed belongs on the page
              that explains how to arrive, and an unloaded iframe here is a hole.
              The picture is one the Gallery already carries, so it is looked up
              from the config rather than hard-coded a second time. */}
          {approach && (
            <div className="lg:col-span-5 reveal relative rounded-[32px] overflow-hidden border border-forest-900/5 shadow-card">
              <SmartImage
                src={approach.url}
                alt={approach.caption}
                className="h-full min-h-[260px] w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest-950/45 to-transparent" />
              <div className="absolute bottom-5 left-6 right-6 text-cream-50 text-sm">{approach.caption}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}