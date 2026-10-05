import { Link } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { Rates } from '../sections/Rates'

/**
 * /rates — rates, fees and booking information.
 *
 * Everything the homepage's three rate tiles deliberately leave out: the
 * weekday/weekend guest schedule, the refundable security deposit, the
 * downpayment percentage, what is included, and every additional or optional
 * charge. The `Rates` section is mounted unchanged, so the figures a guest reads
 * here and the figures the accommodation cards show come from one function.
 *
 * The booking lead-time rule is not restated here. It already appears on /book at
 * the moment the guest chooses dates, which is the only place it changes a
 * decision, so this page links to it rather than keeping a second copy that
 * could fall out of step with the booking form.
 */
export function RatesPage() {
  return (
    <PageShell
      eyebrow="Rates &amp; Fees"
      title="What a stay costs"
      lead={
        <p>
          Accommodation rates, the refundable security deposit, what is included in every stay, and
          the extras the Hacienda charges for when they apply. Nothing is confirmed until the Hacienda
          approves your downpayment screenshot.
        </p>
      }
    >
      <Rates />

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-14">
        <p className="text-sm text-forest-800/80 leading-relaxed">
          Bookings have to be made a minimum time ahead — the exact lead time is shown on the booking
          form itself as you pick your dates.{' '}
          <Link to="/book" className="underline underline-offset-2">
            Open the booking form
          </Link>{' '}
          to see it, and{' '}
          <Link to="/legal#booking-rules" className="underline underline-offset-2">
            read the booking rules
          </Link>{' '}
          for how availability, date holds and confirmation work.
        </p>
      </div>
    </PageShell>
  )
}