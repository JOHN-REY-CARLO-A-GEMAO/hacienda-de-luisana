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
      <nav aria-label="On this page" className="mx-auto max-w-7xl px-5 lg:px-8 mt-8">
        <div className="flex flex-wrap items-center gap-2">
          <a href="#stay" className="btn-ghost text-xs">
            Accommodations
          </a>
          <Link to="/rates" className="btn-ghost text-xs">
            Rates &amp; fees
          </Link>
        </div>
      </nav>

      <Accommodations />
      <Amenities />

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-14">
        <p className="text-sm text-forest-800/80 dark:text-cream-200/80 leading-relaxed">
          Ready to compare prices?{' '}
          <Link to="/rates" className="underline underline-offset-2">
            Rates &amp; Fees
          </Link>{' '}
          lists current rates, inclusions, deposits and extras. The{' '}
          <Link to="/faqs" className="underline underline-offset-2">
            FAQs
          </Link>{' '}
          answer the questions guests ask most about a stay. The{' '}
          <Link to="/house-rules" className="underline underline-offset-2">
            house rules
          </Link>{' '}
          cover what the Hacienda asks of every guest.
        </p>
      </div>
    </PageShell>
  )
}
