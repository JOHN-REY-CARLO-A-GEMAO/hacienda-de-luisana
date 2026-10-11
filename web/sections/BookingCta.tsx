import { Link } from 'react-router-dom'
import { ArrowRight } from '../lib/icons'
import { ParallaxImage } from '../components/ParallaxImage'

/**
 * Scene 10 — the booking call to action, over the Hacienda's own dusk
 * photograph. This is the last thing on the homepage, so it carries the only
 * two things a visitor needs at that point: check the dates, or go read the
 * rates first.
 *
 * Split out of the old `Contact` scene, which held this banner and the contact
 * channels together. The channels moved to /contact; what is left here is the
 * conversion, which is what belongs at the foot of a landing page.
 */
export function BookingCta() {
  return (
    <section className="relative py-20 lg:py-28 bg-forest-950 text-cream-100 overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="reveal relative rounded-[32px] overflow-hidden shadow-depth grain">
          <ParallaxImage
            src="/images/gmaps/img-13.jpg"
            alt="Campfire in front of the main house at blue hour"
            range={0.06}
            className="absolute inset-0 h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-950/90 via-forest-950/75 to-forest-950/50" />
          <div className="relative px-7 py-14 sm:px-12 sm:py-20 lg:px-20 lg:py-28 grid lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-4">
                <span className="scene-index text-cream-50/70" aria-hidden="true">10</span>
                <span className="h-px w-8 bg-cream-50/25" aria-hidden="true" />
                <span className="eyebrow text-cream-100/70">Book your stay</span>
              </div>
              <h2 className="display text-4xl sm:text-5xl lg:text-7xl mt-5 text-cream-50">
                Ready for the
                <br />
                <span className="italic font-light">quiet side?</span>
              </h2>
              <p className="mt-6 text-cream-100/80 leading-relaxed max-w-lg">
                Pick your dates and send a booking request. The Hacienda confirms availability and
                the final quote with you before anything is reserved.
              </p>
            </div>
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 lg:items-stretch">
              <Link to="/book" className="btn bg-cream-50 text-forest-900 hover:bg-white shadow-glow text-base px-8 py-4">
                Check Availability <ArrowRight size={18} />
              </Link>
              <Link
                to="/rates"
                className="btn bg-transparent text-cream-50 border border-cream-50/40 hover:bg-cream-50/10 px-8 py-4"
              >
                See Rates &amp; Fees
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}