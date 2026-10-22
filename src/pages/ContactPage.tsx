import { Link } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { ContactDetails } from '../sections/ContactDetails'
import { FAQ } from '../sections/FAQ'

/**
 * /contact — the Hacienda's channels, contact details and the FAQs.
 *
 * Separate from the homepage's closing booking banner because a question and a
 * reservation are different intents: one ends in a reply, the other in a form.
 * The anti-scam notice travels with the page rather than being a footnote,
 * since this is exactly where somebody looking for a fake number will land.
 *
 * The FAQs are mounted here as well as on /faqs: "Contact" is the nav's single
 * destination for both, and a visitor with a question should not have to guess
 * whether it was answered on this page or the next one. /faqs keeps its own
 * address for existing links, and this page links to it.
 */
export function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to the Hacienda"
      lead={
        <p>
          A question about your dates, a special gathering, or just checking whether the house is
          free — a real person answers, usually the same day. The questions guests ask most are
          answered further down this page.
        </p>
      }
      cta={
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link to="/book" className="btn-primary">
            Check Availability
          </Link>
          <a href="#faqs" className="btn-ghost">
            Common questions
          </a>
        </div>
      }
    >
      <nav aria-label="On this page" className="mx-auto max-w-6xl px-5 lg:px-8 mt-8">
        <div className="flex flex-wrap items-center gap-2">
          <a href="#contact-details" className="btn-ghost text-xs">
            Contact details
          </a>
          <a href="#faqs" className="btn-ghost text-xs">
            FAQs
          </a>
        </div>
      </nav>

      <section id="contact-details" className="pt-10 pb-16 lg:pb-20 scroll-mt-24">
        <div className="mx-auto max-w-6xl px-5 lg:px-8 space-y-12">
          <Link to="/support" className="btn-ghost">
            Report or track an issue
          </Link>
          <ContactDetails />
        </div>
      </section>

      <FAQ />

      <div className="mx-auto max-w-3xl px-5 lg:px-8 pb-16 -mt-10">
        <p className="text-sm text-forest-800/80 dark:text-cream-200/80 leading-relaxed">
          The same questions also live on their own page at{' '}
          <Link to="/faqs" className="underline underline-offset-2">
            /faqs
          </Link>
          . House rules and booking terms are on{' '}
          <Link to="/house-rules" className="underline underline-offset-2">
            House Rules
          </Link>{' '}
          and{' '}
          <Link to="/legal" className="underline underline-offset-2">
            Terms &amp; policies
          </Link>
          .
        </p>
      </div>
    </PageShell>
  )
}
