import { PageShell } from '../components/PageShell'
import { Accommodations } from '../sections/Accommodations'
import { Amenities } from '../sections/Amenities'
import { Rates } from '../sections/Rates'
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
 * The `Rates` section is mounted here too, so the nav's single "Stay & Rates"
 * link reaches both the rooms and what they cost. /rates keeps its own address
 * and its own page: a bookmark, a footer link or a search result that says
 * /rates still opens the full rate tables, and the link at the foot of this
 * page goes there for anyone who wants the figures without the rooms above.
 */
export function StayPage() {
  return (
    <PageShell
      eyebrow="Stay &amp; Rates"
      title="Accommodations at the Hacienda"
      lead={
        <p>
          Three ways to stay on the same grounds, from the private Main House to an A-frame camping
          unit. Every stay is a standard {BUSINESS.policies.standardStayHours}-hour booking — check-in
          from {BUSINESS.policies.checkIn}, check-out by {BUSINESS.policies.checkOut}. Rates for each
          accommodation are below, with the deposit, inclusions and extras.
        </p>
      }
    >
      <nav aria-label="On this page" className="mx-auto max-w-7xl px-5 lg:px-8 mt-8">
        <div className="flex flex-wrap items-center gap-2">
          <a href="#stay" className="btn-ghost text-xs">
            Accommodations
          </a>
          <a href="#rates" className="btn-ghost text-xs">
            Rates &amp; fees
          </a>
        </div>
      </nav>

      <Accommodations />
      <Amenities />
      <Rates />

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-14">
        <p className="text-sm text-forest-800/80 dark:text-cream-200/80 leading-relaxed">
          Prefer the figures on a page of their own?{' '}
          <Link to="/rates" className="underline underline-offset-2">
            Rates &amp; Fees
          </Link>{' '}
          has the same tables, and the{' '}
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
