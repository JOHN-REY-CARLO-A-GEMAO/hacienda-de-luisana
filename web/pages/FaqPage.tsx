import { PageShell } from '../components/PageShell'
import { FAQ } from '../sections/FAQ'

/**
 * /faqs — the full set of common questions.
 *
 * Off the homepage on purpose. A dozen collapsed answers sit between a visitor
 * and the rooms, and someone reading them before they have decided anything is
 * not being helped by them. The questions that do decide a booking — capacity,
 * rate, check-in times — are answered on /stay and /rates, where the answer has
 * something to sit next to.
 */
export function FaqPage() {
  return (
    <PageShell
      eyebrow="FAQs"
      title="Common questions"
      lead={
        <p>
          The questions guests ask most before booking. For anything not answered here, message the
          Hacienda — we are happy to help.
        </p>
      }
    >
      <FAQ />
    </PageShell>
  )
}