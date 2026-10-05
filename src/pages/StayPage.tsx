import { PageShell } from '../components/PageShell'
import { Accommodations } from '../sections/Accommodations'
import { Amenities } from '../sections/Amenities'
import { BUSINESS } from '../config/site'
import { Link } from 'react-router-dom'

/**
 * /stay — the full accommodations page.
 *
 * The homepage shows one card per Accommodation; this is where the beds room by
 * room, the whole amenity list and every accommodation's sources live. The
 * sections are the same ones the homepage used to carry, mounted unchanged, so
 * there is one description of each accommodation in the codebase and not two
 * that can drift apart.
 */
export function StayPage() {
  return (
    <PageShell
      eyebrow="Stay"
      title="Accommodations at the Hacienda"
      lead={
        <p>
          Three ways to stay on the same grounds, from the private Main House to an A-frame camping
          unit. Every stay is a standard {BUSINESS.policies.standardStayHours}-hour booking — check-in
          from {BUSINESS.policies.checkIn}, check-out by {BUSINESS.policies.checkOut}.
        </p>
      }
    >
      <Accommodations />
      <Amenities />

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-14">
        <p className="text-sm text-forest-800/80 leading-relaxed">
          Still deciding between them?{' '}
          <Link to="/faqs" className="underline underline-offset-2">
            The FAQs
          </Link>{' '}
          answer the questions guests ask most about a stay, and{' '}
          <Link to="/house-rules" className="underline underline-offset-2">
            house rules
          </Link>{' '}
          cover what the Hacienda asks of every guest.
        </p>
      </div>
    </PageShell>
  )
}