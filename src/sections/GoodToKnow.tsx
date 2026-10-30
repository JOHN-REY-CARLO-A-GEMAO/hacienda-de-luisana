import { Container } from '../components/ui'
import { Link } from 'react-router-dom'
import { AIRBNB_RATING, GUEST_NOTES, HOUSE_RULES } from '../config/site'
import { ArrowRight, Check, Users } from '../lib/icons'

/**
 * House rules and practical notes, kept in two visibly different voices:
 *
 *   - HOUSE_RULES — what the Hacienda itself publishes about a stay.
 *   - GUEST_NOTES — what guests reported in public reviews, attributed to
 *     them. Useful before a trip, but a guest's account rather than the
 *     Hacienda's promise, and labelled as such until the Hacienda confirms it.
 */
export function GoodToKnow() {
  return (
    <section id="house-rules" className="bg-cream-100/60 dark:bg-forest-950 pt-10 pb-16 lg:pb-20">
      <Container width="wide">
        <div className="grid lg:grid-cols-5 gap-8">
          {/* The Hacienda's rules */}
          <div className="lg:col-span-3 reveal card p-7 lg:p-10">
            <h2 className="font-serif text-2xl text-forest-900 dark:text-cream-50">House rules</h2>
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
              {HOUSE_RULES.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3">
                  <span className="mt-0.5 w-7 h-7 rounded-full bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 shrink-0">
                    <Check size={14} />
                  </span>
                  <div>
                    <div className="font-medium text-forest-900 dark:text-cream-50">{rule.title}</div>
                    <p className="mt-1 text-sm text-forest-800/80 dark:text-cream-100/85 leading-relaxed">{rule.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-8 pt-6 border-t border-forest-900/5 dark:border-cream-100/15 text-sm text-forest-700 dark:text-cream-100/80 leading-relaxed">
              See <Link to="/rates" className="text-link">rates and fees</Link> for listed prices, and confirm current charges with the Hacienda when booking.
              For booking, cancellation, payment and access rules, read the{' '}
              <Link to="/legal" className="text-link">booking and payment terms</Link>.
            </p>
          </div>

          {/* What guests said — attributed */}
          <div className="lg:col-span-2 reveal bg-forest-900 text-cream-100 rounded-[28px] p-7 lg:p-10 shadow-card flex flex-col">
            <h2 className="font-serif text-2xl text-cream-50 inline-flex items-center gap-2">
              <Users size={18} aria-hidden="true" /> What recent guests mention
            </h2>
            <ul className="mt-6 space-y-5">
              {GUEST_NOTES.map((note) => (
                <li key={note.id}>
                  <p className="text-sm leading-relaxed text-cream-50/90">{note.body}</p>
                  <div className="mt-1 text-[11px] text-cream-100/55">— {note.from}, in an Airbnb review</div>
                </li>
              ))}
            </ul>
            <p className="mt-8 pt-6 border-t border-cream-100/10 text-xs text-cream-100/60 leading-relaxed">
              These are guests' own accounts, not the Hacienda's terms — please confirm anything that matters to your
              group when you book.
            </p>
            <a
              href={AIRBNB_RATING.url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-cream-50 hover:underline underline-offset-4 self-start"
            >
              Read the reviews on Airbnb (opens in a new tab) <ArrowRight size={13} aria-hidden="true" />
            </a>
          </div>
        </div>
      </Container>
    </section>
  )
}
