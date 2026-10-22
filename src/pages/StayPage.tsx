import { PageShell } from '../components/PageShell'
import { Accommodations } from '../sections/Accommodations'
import { Amenities } from '../sections/Amenities'
import { BUSINESS } from '../config/site'
import { Link } from 'react-router-dom'

/**
 * /stay — the full accommodations page, and the nav's "Stay & Rates"
 * destination.
 *
 * The homepage shows one card per Accommodation; this is where the beds room by
 * room, the whole amenity list and every accommodation's sources live. The
 * sections are the same ones the homepage used to carry, mounted unchanged, so
 * there is one description of each accommodation in the codebase and not two
 * that can drift apart.
 *
 * Rates have their own page. Keeping the full rate tables out of this page
 * avoids making guests read the same UI twice while preserving a direct link
 * for anyone comparing accommodations and prices.
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
          from {BUSINESS.policies.checkIn}, check-out by {BUSINESS.policies.checkOut}. Rates for each
          accommodation are available on the Rates &amp; Fees page.
        </p>
      }
    >
      <div className="mx-auto mt-8 max-w-7xl px-5 lg:px-8">
        <Link to="/rates" className="btn-ghost btn-sm">
          Compare rates &amp; fees
        </Link>
      </div>

      <Accommodations />
      <Amenities />

    </PageShell>
  )
}
