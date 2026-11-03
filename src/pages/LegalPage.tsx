import { Link } from 'react-router-dom'
import { BUSINESS, LISTINGS } from '../config/site'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { formatRefundPolicySummary } from '../lib/booking'
import { MAX_STAY_NIGHTS } from '../lib/booking/availability'
import { Logo } from '../components/Logo'
import {
  LEGAL_DOCUMENT_CONTROL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_REVIEWED,
  LEGAL_NEXT_REVIEW,
  LEGAL_PARTS,
  LEGAL_SUMMARY,
  LEGAL_VERSION,
  LEGAL_VERSION_HISTORY,
  TERMS,
  sectionNumber,
  sectionsInPart,
  type LegalBlock,
  type LegalSection,
} from '../lib/legal'
import { Container, Page } from '../components/ui'

// -----------------------------------------------------------------------------
// /legal — "The estate ledger"
// -----------------------------------------------------------------------------
// A document, not a card grid. The page is the Hacienda's guest agreement: a
// title-page band, a paper reading surface, hanging section numerals, ledger
// tables and a book-style index. The brand palette stays; the layout and the
// typography carry the identity.
//
// The wording lives in `src/lib/legal`; this file only renders it. The dynamic
// cancellation policy is read from the Admin's published rates and shown as a
// marginal note inside section 9, labelled as current rather than as the policy
// stamped on an existing booking.
// -----------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date)
}

/** Rough reading time, so a Guest knows what they are committing to. */
function readingMinutes(): number {
  const words = TERMS.reduce((total, section) => {
    const inBlocks = section.blocks.reduce((sum, block) => {
      if (block.kind === 'p' || block.kind === 'sub') return sum + block.text.split(/\s+/).length
      if (block.kind === 'list') return sum + block.items.join(' ').split(/\s+/).length
      if (block.kind === 'note') return sum + `${block.title} ${block.text}`.split(/\s+/).length
      if (block.kind === 'table') {
        return sum + [...block.head, ...block.rows.flat()].join(' ').split(/\s+/).length
      }
      return sum
    }, 0)
    return total + inBlocks
  }, 0)
  return Math.max(1, Math.round(words / 220))
}

const PART_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function LegalTable({ head, rows, caption }: { head: string[]; rows: string[][]; caption?: string }) {
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={`${cellIndex}-${cell.slice(0, 24)}`} scope="row">{cell}</th>
                ) : (
                  <td key={`${cellIndex}-${cell.slice(0, 24)}`}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'p') return <p key={index}>{block.text}</p>
        if (block.kind === 'sub') return <h4 key={index}>{block.text}</h4>
        if (block.kind === 'list') {
          if (block.ordered) {
            return (
              <ol key={index}>
                {block.items.map((item) => <li key={item}>{item}</li>)}
              </ol>
            )
          }
          return (
            <ul key={index}>
              {block.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )
        }
        if (block.kind === 'table') {
          return <LegalTable key={index} head={block.head} rows={block.rows} caption={block.caption} />
        }
        return (
          <aside key={index} className="legal-note">
            <div className="legal-note-label">{block.title}</div>
            <p className="legal-note-text">{block.text}</p>
          </aside>
        )
      })}
    </>
  )
}

function LegalSection({
  section,
  publishedRefund,
}: {
  section: LegalSection
  publishedRefund: ReturnType<typeof usePublishedRates>
}) {
  const number = String(sectionNumber(section.id) ?? 0).padStart(2, '0')
  return (
    <section id={section.id} className="legal-section" aria-labelledby={`${section.id}-title`}>
      <div className="legal-section-head">
        <span className="legal-section-number" aria-hidden="true">{number}</span>
        <div className="legal-section-heading">
          <h3 id={`${section.id}-title`} className="legal-section-title">{section.title}</h3>
          <p className="legal-section-summary">{section.summary}</p>
        </div>
      </div>
      <div className="legal-section-body">
        <span className="legal-section-number legal-section-number-body" aria-hidden="true">{number}</span>
        <div className="legal-body">
          <LegalBlocks blocks={section.blocks} />
          {section.id === 'cancellation' && publishedRefund?.refund && (
            <aside className="legal-note legal-note-current">
              <div className="legal-note-label">Current policy</div>
              <p className="legal-note-text">
                {formatRefundPolicySummary(publishedRefund.refund)} This is the current policy, not necessarily
                the one stamped on an existing booking. Check your booking’s recorded policy for the terms that
                apply to it.
              </p>
            </aside>
          )}
        </div>
      </div>
    </section>
  )
}

function LegalIndex({ compact = false }: { compact?: boolean }) {
  return (
    <nav aria-label="Index" className={`legal-index${compact ? ' legal-index-compact' : ''}`}>
      <div className="legal-index-heading">Index</div>
      {LEGAL_PARTS.map((part, partIndex) => {
        const sections = sectionsInPart(part.id)
        if (sections.length === 0) return null
        return (
          <div key={part.id} className="legal-index-part-group">
            <div className="legal-index-part">
              <span className="legal-index-letter" aria-hidden="true">{PART_LETTERS[partIndex]}</span>
              <span className="legal-index-part-title">{part.title}</span>
            </div>
            <ol className="legal-index-list">
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="legal-index-link">
                    <span className="legal-index-number">{String(sectionNumber(section.id)).padStart(2, '0')}</span>
                    <span className="legal-index-title">{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )
      })}
      <div className="legal-index-note">
        <div>Version {LEGAL_VERSION}</div>
        <div>Effective {formatDate(LEGAL_EFFECTIVE_DATE)}</div>
      </div>
    </nav>
  )
}

function LegalSummary() {
  return (
    <section className="legal-summary" aria-labelledby="legal-summary-title">
      <h2 id="legal-summary-title" className="legal-summary-title">The short version</h2>
      <p className="legal-summary-standfirst">
        What you need to know before you book. A guide to the full terms below; if the two differ, the full
        terms apply.
      </p>
      <div className="legal-summary-grid">
        {LEGAL_SUMMARY.map((point) => (
          <div key={point.lead} className="legal-summary-point">
            <div className="legal-summary-lead">{point.lead}</div>
            <p className="legal-summary-text">{point.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function LegalGlance() {
  const facts = [
    { label: 'Check-in', value: '2:00 PM' },
    { label: 'Check-out', value: '12:00 noon' },
    { label: 'Standard stay', value: '22 hours' },
    { label: 'Maximum stay', value: `${MAX_STAY_NIGHTS} nights` },
    { label: 'Minimum lead time', value: '30 days' },
    { label: 'Downpayment', value: '50% of stay total' },
    { label: 'Balance', value: 'At check-in' },
    { label: 'Pets', value: '₱300 per pet' },
    { label: 'Late checkout', value: '₱250 / hour, by approval' },
    { label: 'Smoking', value: 'Not permitted indoors' },
    { label: 'Security deposit', value: 'See Rates page' },
    { label: 'Chat retention', value: '90 days after closing' },
  ]
  return (
    <section className="legal-glance" aria-labelledby="legal-glance-title">
      <div className="legal-glance-head">
        <h2 id="legal-glance-title" className="legal-glance-title">The practical numbers</h2>
        <p className="legal-glance-note">
          The security deposit and the cancellation policy are published live by the Admin. See the{' '}
          <Link to="/rates">Rates &amp; fees</Link> page and section 9.
        </p>
      </div>
      <dl className="legal-glance-grid">
        {facts.map((fact) => (
          <div key={fact.label} className="legal-glance-row">
            <dt className="legal-glance-label">{fact.label}</dt>
            <dd className="legal-glance-value">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function LegalColophon() {
  return (
    <section id="document-control" className="legal-colophon" aria-labelledby="legal-colophon-title">
      <h2 id="legal-colophon-title" className="legal-colophon-title">Document control</h2>
      <p className="legal-colophon-standfirst">
        This page is the controlled version of the Hacienda’s terms, privacy notice and booking rules. The
        Admin reviews it at least once a year and whenever a booking, payment, privacy or access rule changes.
      </p>
      <div className="legal-colophon-grid">
        <div className="legal-colophon-item">
          <span className="legal-colophon-label">Version</span>
          <span className="legal-colophon-value">{LEGAL_VERSION}</span>
        </div>
        <div className="legal-colophon-item">
          <span className="legal-colophon-label">Effective</span>
          <span className="legal-colophon-value">{formatDate(LEGAL_EFFECTIVE_DATE)}</span>
        </div>
        <div className="legal-colophon-item">
          <span className="legal-colophon-label">Last reviewed</span>
          <span className="legal-colophon-value">{formatDate(LEGAL_LAST_REVIEWED)}</span>
        </div>
        <div className="legal-colophon-item">
          <span className="legal-colophon-label">Next review</span>
          <span className="legal-colophon-value">{formatDate(LEGAL_NEXT_REVIEW)}</span>
        </div>
      </div>
      <LegalTable
        head={['Field', 'Detail']}
        rows={LEGAL_DOCUMENT_CONTROL.map((item) => [item.field, item.value])}
      />
      <h3 className="legal-colophon-subtitle">Version history</h3>
      <LegalTable
        head={['Version', 'Effective', 'Summary of changes']}
        rows={LEGAL_VERSION_HISTORY.map((entry) => [entry.version, entry.effective, entry.summary])}
      />
    </section>
  )
}

function LegalContact() {
  return (
    <section id="legal-contact" className="legal-contact" aria-labelledby="legal-contact-title">
      <h2 id="legal-contact-title" className="legal-contact-title">Talk to the Hacienda</h2>
      <p className="legal-contact-standfirst">
        Contact the Hacienda through an official channel. For a booking or stay issue, include your booking
        reference and dates. For a privacy request, use the subject line “Privacy request”.
      </p>
      <div className="legal-contact-grid">
        <div className="legal-contact-item">
          <span className="legal-contact-label">Phone</span>
          <a className="legal-contact-link" href={`tel:${BUSINESS.contact.phone.replace(/\s/g, '')}`}>
            {BUSINESS.contact.phoneDisplay}
          </a>
        </div>
        <div className="legal-contact-item">
          <span className="legal-contact-label">Email</span>
          <a className="legal-contact-link" href={`mailto:${BUSINESS.contact.email}`}>
            {BUSINESS.contact.email}
          </a>
        </div>
        <div className="legal-contact-item">
          <span className="legal-contact-label">Address</span>
          <span className="legal-contact-value">{BUSINESS.address.formatted}</span>
        </div>
        <div className="legal-contact-item">
          <span className="legal-contact-label">Official listings</span>
          <span className="legal-contact-value">
            <a className="legal-contact-link" href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer">
              {LISTINGS.airbnb.label}
            </a>
            {' '}
            <a className="legal-contact-link" href={LISTINGS.agoda.url} target="_blank" rel="noreferrer">
              {LISTINGS.agoda.label}
            </a>
          </span>
        </div>
      </div>
      <div className="legal-footer-links">
        <Link to="/contact">Contact page</Link>
        <Link to="/support">Guest support</Link>
        <Link to="/house-rules">House rules</Link>
      </div>
    </section>
  )
}

function LegalEnd() {
  return (
    <div className="legal-end">
      <span className="legal-end-version">Version {LEGAL_VERSION}</span>
      <span className="legal-end-version">Effective {formatDate(LEGAL_EFFECTIVE_DATE)}</span>
      <a href="#top" className="legal-back-to-top">Back to top</a>
    </div>
  )
}

export function LegalPage() {
  const published = usePublishedRates()
  const minutes = readingMinutes()

  return (
    <Page className="legal-document dark:bg-forest-950 dark:text-cream-50">
      <div id="top" />
      <Container width="content" className="legal-container">
        <header className="legal-masthead">
          <div className="legal-masthead-top">
            <Logo tone="light" />
            <button type="button" onClick={() => window.print()} className="legal-print-link no-print">
              Print / save PDF
            </button>
          </div>
          <div className="legal-masthead-title">
            <div className="legal-kicker">A guest agreement from Hacienda de LuisAna</div>
            <h1 className="legal-title">Terms, privacy and booking rules</h1>
            <p className="legal-standfirst dark:text-cream-100/85">
              The full agreement for a stay at Hacienda de LuisAna: how a booking is confirmed, what the
              payment covers, how a cancellation is handled, what the Hacienda does with your personal data,
              and what is expected of every guest. Please read it before you book or pay. Acceptance is never
              assumed — you must tick the box on the booking and payment steps. For the Hacienda’s stay rules,
              see <Link to="/house-rules">House rules</Link>; for the live rates and the security deposit, see
              the <Link to="/rates">Rates &amp; fees</Link> page.
            </p>
          </div>
          <div className="legal-titlepage">
            <div className="legal-titlepage-item">
              <span className="legal-titlepage-label">Terms version:</span>{' '}
              <span className="legal-titlepage-value"><time dateTime={LEGAL_VERSION}>{LEGAL_VERSION}</time></span>
            </div>
            <div className="legal-titlepage-item">
              <span className="legal-titlepage-label">Effective:</span>{' '}
              <span className="legal-titlepage-value">{formatDate(LEGAL_EFFECTIVE_DATE)}</span>
            </div>
            <div className="legal-titlepage-item">
              <span className="legal-titlepage-label">Last reviewed:</span>{' '}
              <span className="legal-titlepage-value">{formatDate(LEGAL_LAST_REVIEWED)}</span>
            </div>
            <div className="legal-titlepage-item">
              <span className="legal-titlepage-label">Next review:</span>{' '}
              <span className="legal-titlepage-value">{formatDate(LEGAL_NEXT_REVIEW)}</span>
            </div>
            <div className="legal-titlepage-item">
              <span className="legal-titlepage-label">Reading time:</span>{' '}
              <span className="legal-titlepage-value">About {minutes} minutes</span>
            </div>
          </div>
        </header>

        <div className="legal-mobile-index no-print">
          <details>
            <summary>Index <span>{TERMS.length} sections</span></summary>
            <LegalIndex compact />
          </details>
        </div>

        <div className="legal-grid">
          <div className="legal-main">
            <LegalSummary />
            <LegalGlance />

            {LEGAL_PARTS.map((part, partIndex) => {
              const sections = sectionsInPart(part.id)
              if (sections.length === 0) return null
              return (
                <section key={part.id} className="legal-part" aria-labelledby={`part-${part.id}`}>
                  <div className="legal-part-head">
                    <span className="legal-part-letter" aria-hidden="true">{PART_LETTERS[partIndex]}</span>
                    <div>
                      <div className="legal-part-label">Part {PART_LETTERS[partIndex]}</div>
                      <h2 id={`part-${part.id}`} className="legal-part-title">{part.title}</h2>
                      <p className="legal-part-blurb">{part.blurb}</p>
                    </div>
                  </div>
                  <div className="legal-sections">
                    {sections.map((section) => (
                      <LegalSection key={section.id} section={section} publishedRefund={published} />
                    ))}
                  </div>
                </section>
              )
            })}

            <LegalColophon />
            <LegalContact />
            <LegalEnd />
          </div>

          <aside className="legal-aside no-print">
            <LegalIndex />
          </aside>
        </div>
      </Container>
    </Page>
  )
}
