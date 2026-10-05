import { PageShell } from '../components/PageShell'
import { GoodToKnow } from '../sections/GoodToKnow'

/**
 * /house-rules — what the Hacienda asks of every guest.
 *
 * The house rules and the Guest notes stay together in one section, in two
 * visibly different voices: the Hacienda's own rules, and what recent guests
 * reported in public reviews. Splitting them would put an attributed guest
 * account next to a promise the Hacienda has not made.
 *
 * Booking, cancellation, payment and access terms are *not* here. Those live in
 * `TERMS` on /legal, which is where the booking and payment steps link from and
 * where the version a Guest accepted is recorded — one copy, so the terms a
 * guest reads can never be a different set from the terms they agreed to.
 */
export function HouseRulesPage() {
  return (
    <PageShell
      eyebrow="House Rules"
      title="Before you arrive"
      lead={
        <p>
          The few things every guest should know: the Hacienda&rsquo;s own house rules first, then
          what recent guests found useful to pass on.
        </p>
      }
    >
      <GoodToKnow />
    </PageShell>
  )
}