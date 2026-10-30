import { Container } from '../components/ui'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { ContactDetails } from '../sections/ContactDetails'

/**
 * /contact — the Hacienda's official channels and contact details.
 *
 * Separate from the homepage's closing booking banner because a question and a
 * reservation are different intents: one ends in a reply, the other in a form.
 * The anti-scam notice travels with the page rather than being a footnote,
 * since this is exactly where somebody looking for a fake number will land.
 *
 * Common questions have their own page. Linking there instead of rendering the
 * entire FAQ again keeps each destination focused and avoids duplicate UI.
 */
export function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to the Hacienda"
      darkMode
      lead={
        <p>
          Get in touch about your stay, a special gathering, or any questions you have.
          You can also visit the FAQs for quick answers.
        </p>
      }
      cta={
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link to="/book" className="btn-primary">
            Check Availability
          </Link>
          <Link to="/faqs" className="btn-ghost">
            Common questions
          </Link>
        </div>
      }
    >
      <section id="contact-details" className="pt-10 pb-16 lg:pb-20 scroll-mt-24">
        <Container width="content" className="space-y-12">
          <Link to="/support" className="btn-ghost">
            Get support
          </Link>
          <ContactDetails />
        </Container>
      </section>

    </PageShell>
  )
}
