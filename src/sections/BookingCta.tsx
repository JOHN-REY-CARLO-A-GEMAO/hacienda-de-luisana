import { Container } from '../components/ui'
import { Link } from 'react-router-dom'
import { ArrowRight } from '../lib/icons'
import { ParallaxImage } from '../components/ParallaxImage'
import { BOOKING_JOURNEY_STEPS } from '../components/Booking/FlowSteps'

/**
 * The final homepage scene answers two practical questions before a Guest
 * leaves: exactly how booking works, and where to start. The seven labels are
 * shared with the booking/payment/status pages so the guidance cannot drift.
 */
export function BookingCta() {
  return (
    <section className="relative section-roomy overflow-hidden bg-forest-950 text-cream-100" aria-labelledby="home-booking-guide">
      <Container width="wide">
        <div className="reveal grain relative overflow-hidden rounded-[32px] shadow-depth">
          <ParallaxImage
            src="/images/gmaps/img-13.jpg"
            alt="Campfire in front of the main house at blue hour"
            range={0.06}
            className="absolute inset-0 h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-950/95 via-forest-950/90 to-forest-950/75" />
          <div className="relative grid items-end gap-10 px-7 py-14 sm:px-12 sm:py-20 lg:grid-cols-12 lg:px-20 lg:py-24">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-4">
                <span className="scene-index text-cream-50/70" aria-hidden="true">10</span>
                <span className="h-px w-8 bg-cream-50/25" aria-hidden="true" />
                <span className="eyebrow text-cream-100">Booking sa Hacienda</span>
              </div>
              <h2 id="home-booking-guide" className="display mt-5 text-4xl text-cream-50 sm:text-5xl lg:text-6xl">
                Malinaw na Proseso ng Booking
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-cream-100/90">
                Piliin ang matutuluyan at petsa. Makikita ninyo ang presyo bago magbayad. Pagkatapos
                maipasa ang patunay, ang booking ay <strong>Pending—hindi pa kumpirmado</strong>—hangga’t
                hindi ito ina-aprubahan ng Hacienda.
              </p>

              <ol className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="Pitong hakbang sa booking">
                {BOOKING_JOURNEY_STEPS.map((step, index) => (
                  <li key={step.title} className="flex items-start gap-3 rounded-xl border border-cream-100/15 bg-forest-950/35 p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream-50 font-serif text-base font-semibold text-forest-950" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-base font-medium leading-snug text-cream-50">{step.title}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:col-span-4 lg:flex-col lg:items-stretch">
              <Link to="/book" className="btn-on-dark btn-lg shadow-glow">
                Mag-book ng Matutuluyan <ArrowRight size={22} aria-hidden="true" />
              </Link>
              <Link to="/rates" className="btn-secondary btn-lg">
                Tingnan ang Rates &amp; Fees
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
