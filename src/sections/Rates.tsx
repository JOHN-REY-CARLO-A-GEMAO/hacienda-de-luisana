import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, FEES, LISTINGS, type Fee } from '../config/site'
import { ArrowRight, Check, Sparkle } from '../lib/icons'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { ratesForAccommodation } from '../lib/booking'
import { displayedRate } from './Accommodations'

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH')}`
}

/**
 * Rates & Fees — one place that separates four different kinds of money:
 *
 *   1. Accommodation rates — the Admin's Published rates when they exist,
 *      otherwise the Hacienda's own listed price, otherwise "quoted on request".
 *   2. The refundable Security deposit and payment plans — only ever from the
 *      Published rates; described in words until they are published.
 *   3. Additional fees the Hacienda lists (pets).
 *   4. Optional charges available on request (drinking water), unpriced until
 *      the Hacienda publishes a figure.
 *
 * Nothing here is typed in as a guess: a missing figure renders as a plain
 * statement that the Hacienda confirms it, never as a number.
 */
export function Rates() {
  const published = usePublishedRates()
  const active = ACCOMMODATIONS.filter((a) => a.active)

  // Deposit and down payment come from the Published rates alone.
  const publishedFigures = active
    .map((a) => ({ a, q: published ? ratesForAccommodation(published, a.id) : undefined }))
    .filter((x) => x.q !== undefined)

  return (
    <section id="rates" className="py-24 lg:py-36 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 reveal">
          <div className="max-w-2xl">
            <div className="eyebrow">Rates &amp; Fees</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
              What a Stay
              <br />
              <span className="italic font-light">Costs</span>
            </h2>
          </div>
          <p className="max-w-md text-forest-800/80 leading-relaxed">
            No surprises: the nightly rate, what is included, the extras, and the refundable deposit — all
            in one place. The Hacienda confirms the final quote with you before anything is reserved.
          </p>
        </div>

        {/* 1. Accommodation rates */}
        <div className="mt-14 grid md:grid-cols-2 gap-6">
          {active.map((a) => {
            const rate = displayedRate(a, published)
            return (
              <div key={a.id} className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8" data-testid={`rate-${a.id}`}>
                <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">{a.shortName}</div>
                <h3 className="font-serif text-2xl text-forest-900 mt-1">{a.name}</h3>
                <div className="mt-5 font-serif text-4xl text-forest-900">{rate.label}</div>
                <div className="mt-1 text-xs text-forest-700/70">{rate.source}</div>
                <div className="mt-4 text-sm text-forest-800">{a.capacityLabel}{a.availableUnits ? ` · ${a.availableUnits} units` : ''}</div>
                <Link to={`/book?accommodation=${a.id}`} className="btn-ghost mt-6 text-xs group">
                  Request these dates
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            )
          })}
        </div>

        <div className="mt-6 grid lg:grid-cols-3 gap-6">
          {/* 2. Deposit & payment plans */}
          <div className="reveal bg-forest-900 text-cream-100 rounded-[28px] p-7 lg:p-8 shadow-card">
            <div className="eyebrow text-cream-100/60">Deposit &amp; payment</div>
            <h3 className="font-serif text-2xl text-cream-50 mt-2">Refundable security deposit</h3>
            {publishedFigures.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm">
                {publishedFigures.map(({ a, q }) => (
                  <li key={a.id} className="flex items-start justify-between gap-4">
                    <span className="text-cream-100/80">{a.shortName}</span>
                    <span className="text-right">
                      <span className="font-medium text-cream-50">{peso(q!.rateCard.securityDeposit)}</span>
                      <span className="block text-[11px] text-cream-100/60">
                        {q!.rateCard.downPaymentPercent !== undefined
                          ? `${q!.rateCard.downPaymentPercent}% down payment or full payment`
                          : 'Full payment'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-cream-100/80 leading-relaxed">
                A refundable security deposit is held against damage and settled at check-out. Its amount, and
                whether a down-payment plan is offered for your stay, are set in the Hacienda's published rates
                and shown to you at the payment step — nothing is paid when you send a request.
              </p>
            )}
            <p className="mt-5 text-xs text-cream-100/60 leading-relaxed">
              Cancellations follow the policy in force when you choose your payment plan.{' '}
              <Link to="/legal#cancellation" className="underline underline-offset-2 text-cream-100/80">
                Cancellation and refunds
              </Link>
            </p>
          </div>

          {/* Included */}
          <div className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8">
            <div className="eyebrow">Included</div>
            <h3 className="font-serif text-2xl text-forest-900 mt-2">In every stay</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-forest-800">
              {FEES.included.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check size={15} className="mt-0.5 text-forest-600 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 3 + 4. Additional fees & optional charges */}
          <div className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8">
            <div className="eyebrow">Extras</div>
            <h3 className="font-serif text-2xl text-forest-900 mt-2">Additional fees</h3>
            <ul className="mt-4 divide-y divide-forest-900/5">
              {FEES.additional.map((f) => (
                <FeeRow key={f.id} fee={f} />
              ))}
            </ul>

            <h4 className="mt-6 text-[11px] uppercase tracking-eyebrow text-forest-600">Optional, on request</h4>
            <ul className="mt-2 divide-y divide-forest-900/5">
              {FEES.optional.map((f) => (
                <FeeRow key={f.id} fee={f} />
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 text-xs text-forest-700/70 reveal">
          <p className="flex items-start gap-2 max-w-2xl leading-relaxed">
            <Sparkle size={14} className="mt-0.5 text-forest-600 shrink-0" />
            <span>
              Rates shown are for booking directly with the Hacienda. Prefer to pay by card? The same stay is on{' '}
              <a href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{LISTINGS.airbnb.label}</a>{' '}
              and{' '}
              <a href={LISTINGS.agoda.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{LISTINGS.agoda.label}</a>,
              where prices may differ.
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}

function FeeRow({ fee }: { fee: Fee }) {
  return (
    <li className="py-3 flex items-start justify-between gap-4 text-sm">
      <div>
        <div className="font-medium text-forest-900">{fee.label}</div>
        {fee.note && <div className="text-xs text-forest-700/70 mt-0.5 leading-relaxed">{fee.note}</div>}
      </div>
      <div className="text-right shrink-0">
        {fee.amount !== undefined ? (
          <>
            <div className="font-serif text-xl text-forest-900">{peso(fee.amount)}</div>
            {fee.unit && <div className="text-[11px] text-forest-700/60">{fee.unit}</div>}
          </>
        ) : (
          <div className="text-xs text-forest-700/70">Ask for the current price</div>
        )}
      </div>
    </li>
  )
}
