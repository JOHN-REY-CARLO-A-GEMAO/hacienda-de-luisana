import { Link } from 'react-router-dom'
import { SceneHeader } from '../components/Scene'
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
    <section id="house-rules" className="py-24 lg:py-36 bg-cream-100/60">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SceneHeader
          index="06"
          eyebrow="House Rules &amp; Good to Know"
          title={
            <>
              Before You
              <br />
              <span className="italic font-light">Arrive</span>
            </>
          }
        >
          <p>
            The few things every guest should know — the Hacienda's own house rules first, then what recent
            guests found useful to pass on.
          </p>
        </SceneHeader>

        <div className="mt-14 grid lg:grid-cols-5 gap-8">
          {/* The Hacienda's rules */}
          <div className="lg:col-span-3 reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-10">
            <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">House rules</div>
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
              {HOUSE_RULES.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3">
                  <span className="mt-0.5 w-7 h-7 rounded-full bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 shrink-0">
                    <Check size={14} />
                  </span>
                  <div>
                    <div className="font-medium text-forest-900">{rule.title}</div>
                    <p className="mt-1 text-sm text-forest-800/80 leading-relaxed">{rule.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-8 pt-6 border-t border-forest-900/5 text-xs text-forest-700/70 leading-relaxed">
              Booking, cancellation, payment and access rules in full:{' '}
              <Link to="/legal" className="underline underline-offset-2 text-forest-800">
                Terms and house rules
              </Link>
            </p>
          </div>

          {/* What guests said — attributed */}
          <div className="lg:col-span-2 reveal bg-forest-900 text-cream-100 rounded-[28px] p-7 lg:p-10 shadow-card flex flex-col">
            <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60 inline-flex items-center gap-2">
              <Users size={14} /> What recent guests mention
            </div>
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
              Read the reviews on Airbnb <ArrowRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
