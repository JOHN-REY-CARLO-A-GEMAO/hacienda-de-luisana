import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, FEES } from '../config/site'
import { SceneHeader } from '../components/Scene'
import { ArrowRight, Check } from '../lib/icons'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { displayedRate } from './Accommodations'

/**
 * Scene 05 — the rates preview.
 *
 * The one number per Accommodation that a guest can act on, plus the handful of
 * things that are free. The weekday/weekend guest schedule, the refundable
 * deposit, the downpayment percentage and every additional fee stay on /rates:
 * they matter at the moment of payment, not while choosing between three rooms,
 * and they are the part of this material that most often goes stale.
 *
 * As everywhere else, the rate is `displayedRate`'s — Published rates first,
 * then the listed price, then "quoted on request". Nothing here is typed in.
 */

/** How many of the free-included lines fit before the list stops being a preview. */
const INCLUDED_PREVIEW = 4

export function RatesPreview() {
  const published = usePublishedRates()
  const active = ACCOMMODATIONS.filter((a) => a.active)

  return (
    <section id="rates" className="py-20 lg:py-28 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <SceneHeader
            index="05"
            eyebrow="Rates"
            title={
              <>
                What a Stay
                <br />
                <span className="italic font-light">Costs</span>
              </>
            }
          >
            <p>
              The figure each Accommodation is quoted at today. The final amount is computed before
              payment and confirmed by the Hacienda.
            </p>
          </SceneHeader>
          <Link to="/rates" className="reveal btn-ghost shrink-0 group self-start lg:self-auto lg:mb-2">
            Full rates &amp; fees
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {active.map((a, i) => {
            const rate = displayedRate(a, published)
            return (
              <div
                key={a.id}
                className="reveal bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 flex flex-col"
                style={{ transitionDelay: `${i * 60}ms` }}
                data-testid={`rate-${a.id}`}
              >
                <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">{a.shortName}</div>
                <h3 className="font-serif text-2xl text-forest-900 mt-1">{a.name}</h3>
                <div className="mt-5 font-serif text-3xl text-forest-900">{rate.label}</div>
                <div className="mt-1 text-[11px] text-forest-700/70">{rate.source}</div>
                <div className="mt-4 text-sm text-forest-800">{a.capacityLabel}</div>
                <div className="mt-auto pt-6">
                  <Link
                    to={`/book?accommodation=${a.id}`}
                    className="btn-ghost text-xs group w-full"
                  >
                    Check availability
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-8 bg-white rounded-[28px] border border-forest-900/5 shadow-card p-7 lg:p-8 reveal">
          <div className="eyebrow">Included in every stay</div>
          <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-forest-800">
            {FEES.included.slice(0, INCLUDED_PREVIEW).map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check size={15} className="mt-0.5 text-forest-600 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link to="/rates" className="mt-5 inline-flex items-center gap-1.5 text-sm text-forest-800 underline underline-offset-4 hover:text-forest-950">
            Everything included, plus fees and the deposit
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  )
}