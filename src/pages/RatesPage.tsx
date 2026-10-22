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
            Accommodation rates, the refundable security deposit, what is included in every stay, and the
            extras the Hacienda charges for when they apply. Nothing is confirmed until the Hacienda
            approves your downpayment screenshot. Booking lead time and the booking rules are on the{' '}
            <Link to="/book" className="text-link">
              booking form
            </Link>{' '}
            and in{' '}
            <Link to="/legal#booking-rules" className="text-link">
              the terms
            </Link>
            .
        </p>
      }
    >
      <Rates />

    </PageShell>
  )
}