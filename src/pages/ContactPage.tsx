import { Link } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { ContactDetails } from '../sections/ContactDetails'

/**
 * /contact — the Hacienda's channels.
 *
 * Separate from the homepage's closing booking banner because a question and a
 * reservation are different intents: one ends in a reply, the other in a form.
 * The anti-scam notice travels with the page rather than being a footnote,
 * since this is exactly where somebody looking for a fake number will land.
 */
export function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to the Hacienda"
      lead={
        <p>
          A question about your dates, a special gathering, or just checking whether the house is
          free — a real person answers, usually the same day.
        </p>
      }
      cta={
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link to="/book" className="btn-primary">
            Check Availability
          </Link>
          <Link to="/faqs" className="btn-ghost">
            Read the FAQs first
          </Link>
        </div>
      }
    >
      <section className="py-16 lg:py-20">
        <div className="mx-auto max-w-6xl px-5 lg:px-8">
          <ContactDetails />
        </div>
      </section>
    </PageShell>
  )
}