import { Link } from 'react-router-dom'
import { TERMS } from '../lib/legal'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { formatRefundPolicySummary } from '../lib/booking'
import { Alert, Card, Container, Page, PageHeader } from '../components/ui'

/**
 * /legal — the terms a Guest accepts, in one canonical copy.
 *
 * The booking and payment steps link here and record the version accepted, so
 * this page is the only place the wording lives. It is a reading page: a narrow
 * column, one card per section, and anchors (`#booking-rules`) that other pages
 * link into.
 */
export function LegalPage() {
  const published = usePublishedRates()

  return (
    <Page>
      <Container width="narrow">
        <PageHeader
          eyebrow="Policies"
          title="Terms and house rules"
          lead={
            <p>
              Please read these before you book or pay. Acceptance is never assumed — you must tick the
              box on the booking and payment steps.
            </p>
          }
        />

        <div className="mt-10 space-y-6">
          {TERMS.map((section) => (
            <Card key={section.id} as="section" padding="lg" className="scroll-mt-28" id={section.id}>
              <h2 className="h2">{section.title}</h2>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-forest-800/85">
                {section.body.map((paragraph) => (
                  <li key={paragraph} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-forest-500" />
                    <span>{paragraph}</span>
                  </li>
                ))}
                {section.id === 'cancellation' && published?.refund && (
                  <li>
                    <Alert tone="success" className="text-xs">
                      Currently published cancellation policy: {formatRefundPolicySummary(published.refund)}
                    </Alert>
                  </li>
                )}
              </ul>
            </Card>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/book" className="btn-primary">
            Continue to booking
          </Link>
          <Link to="/faqs" className="btn-ghost">
            Common questions
          </Link>
        </div>
      </Container>
    </Page>
  )
}
