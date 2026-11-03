import { Link } from 'react-router-dom'
import { BUSINESS, LISTINGS } from '../config/site'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { formatRefundPolicySummary } from '../lib/booking'
import { MAX_STAY_NIGHTS } from '../lib/booking/availability'
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
import { Alert, Card, Container, Page, PageHeader } from '../components/ui'

// -----------------------------------------------------------------------------
// /legal — the full terms, privacy notice and booking rules.
// -----------------------------------------------------------------------------
// The page is a reading page, not a form. It is also the copy the booking and
// payment steps link into and the version a Guest records when they accept, so
// the wording lives in `src/lib/legal` and this file only renders it.
//
// Three things make a long legal page usable:
//   1. A plain-language summary at the top, so a Guest can orient before the
//      full text. It is labelled as a guide, not a substitute.
//   2. A sticky table of contents on desktop and a collapsible one on mobile,
//      with anchors on every section.
//   3. Print styles, so a Guest can save a PDF of the exact version they read.
//
// The dynamic cancellation policy is read from the Admin's published rates and
// shown inside the cancellation section. It is labelled as the current policy,
// not the one stamped on an existing booking, because the two can differ.
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
    <div className="mt-4 overflow-x-auto rounded-2xl border border-forest-900/10 dark:border-cream-100/10">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        {caption && <caption className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-forest-600 dark:text-sage-300">{caption}</caption>}
        <thead className="bg-cream-100/70 dark:bg-forest-900/60">
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-forest-600 dark:text-sage-300">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`} className="border-t border-forest-900/5 dark:border-cream-100/10">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${cellIndex}-${cell.slice(0, 24)}`}
                  className={`px-4 py-3 align-top leading-relaxed ${
                    cellIndex === 0
                      ? 'font-medium text-forest-900 dark:text-cream-50'
                      : 'text-forest-800/85 dark:text-cream-100/85'
                  }`}
                >
                  {cell}
                </td>
              ))}
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
        if (block.kind === 'p') {
          return (
            <p key={index} className="mt-3 text-sm leading-relaxed text-forest-800/85 dark:text-cream-100/85">
              {block.text}
            </p>
          )
        }
        if (block.kind === 'sub') {
          return (
            <h4 key={index} className="mt-6 font-serif text-lg text-forest-900 dark:text-cream-50">
              {block.text}
            </h4>
          )
        }
        if (block.kind === 'list') {
          if (block.ordered) {
            return (
              <ol key={index} className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-forest-800/85 dark:text-cream-100/85">
                {block.items.map((item) => (
                  <li key={item} className="pl-1">{item}</li>
                ))}
              </ol>
            )
          }
          return (
            <ul key={index} className="mt-3 space-y-2 text-sm leading-relaxed text-forest-800/85 dark:text-cream-100/85">
              {block.items.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-forest-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'table') {
          return <LegalTable key={index} head={block.head} rows={block.rows} caption={block.caption} />
        }
        return (
          <Alert key={index} tone={block.tone} title={block.title} className="mt-4 text-sm">
            {block.text}
          </Alert>
        )
      })}
    </>
  )
}

function SectionCard({ section, publishedRefund }: { section: LegalSection; publishedRefund: ReturnType<typeof usePublishedRates> }) {
  const number = sectionNumber(section.id) ?? 0
  return (
    <Card
      as="section"
      padding="lg"
      id={section.id}
      className="legal-card scroll-mt-28"
      aria-labelledby={`${section.id}-title`}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest-700 text-sm font-semibold text-cream-50 dark:bg-cream-100 dark:text-forest-950"
        >
          {String(number).padStart(2, '0')}
        </span>
        <div className="min-w-0">
          <h3 id={`${section.id}-title`} className="font-serif text-xl leading-snug text-forest-900 dark:text-cream-50 lg:text-2xl">
            {section.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-forest-600 dark:text-cream-200/70">{section.summary}</p>
        </div>
      </div>

      <div className="mt-5 border-t border-forest-900/5 pt-2 dark:border-cream-100/10">
        <LegalBlocks blocks={section.blocks} />
      </div>

      {section.id === 'cancellation' && publishedRefund?.refund && (
        <Alert tone="success" title="Currently published cancellation policy" className="mt-5 text-sm">
          {formatRefundPolicySummary(publishedRefund.refund)}{' '}
          <span className="font-medium">
            This is the current policy, not necessarily the one stamped on an existing booking.
          </span>{' '}
          Check your booking’s recorded policy for the terms that apply to it.
        </Alert>
      )}
    </Card>
  )
}

function TableOfContents({ compact = false }: { compact?: boolean }) {
  return (
    <nav aria-label="On this page" className={compact ? '' : 'legal-toc'}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="eyebrow">On this page</span>
        <span className="text-xs text-forest-600 dark:text-cream-200/60">{TERMS.length} sections</span>
      </div>
      <div className={compact ? 'max-h-[60vh] space-y-5 overflow-y-auto pr-1' : 'max-h-[calc(100vh-12rem)] space-y-5 overflow-y-auto pr-2'}>
        {LEGAL_PARTS.map((part, partIndex) => {
          const sections = sectionsInPart(part.id)
          if (sections.length === 0) return null
          const first = sectionNumber(sections[0].id) ?? 0
          const last = sectionNumber(sections[sections.length - 1].id) ?? first
          return (
            <div key={part.id}>
              <div className="flex items-baseline gap-2">
                <span aria-hidden="true" className="font-serif text-sm font-semibold text-brass-700 dark:text-brass-300">
                  {PART_LETTERS[partIndex]}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-forest-700 dark:text-sage-300">
                  {part.title}
                </span>
              </div>
              <ol className="mt-2 space-y-1.5 border-l border-forest-900/10 pl-3 dark:border-cream-100/10">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="group flex gap-2 text-xs leading-snug text-forest-700 transition hover:text-forest-950 dark:text-cream-200/75 dark:hover:text-cream-50"
                    >
                      <span className="w-5 shrink-0 tabular-nums text-forest-500 dark:text-sage-400">
                        {String(sectionNumber(section.id)).padStart(2, '0')}
                      </span>
                      <span className="underline decoration-transparent underline-offset-2 group-hover:decoration-forest-700/40 dark:group-hover:decoration-cream-100/40">
                        {section.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
              <div className="mt-1 pl-3 text-[10px] uppercase tracking-wide text-forest-500 dark:text-cream-200/40">
                Sections {first}–{last}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 border-t border-forest-900/10 pt-3 text-xs leading-relaxed text-forest-600 dark:border-cream-100/10 dark:text-cream-200/60">
        <div>Version {LEGAL_VERSION}</div>
        <div>Effective {formatDate(LEGAL_EFFECTIVE_DATE)}</div>
      </div>
    </nav>
  )
}

function SummaryCard() {
  return (
    <Card padding="lg" className="legal-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">The short version</div>
          <h2 className="mt-2 font-serif text-2xl text-forest-900 dark:text-cream-50 lg:text-3xl">
            What you need to know before you book
          </h2>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-forest-600 dark:text-cream-200/60">
          A guide to the full terms below. If the two differ, the full terms apply.
        </p>
      </div>
      <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {LEGAL_SUMMARY.map((point, index) => (
          <div key={point.lead} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brass-600/30 text-[10px] font-semibold tabular-nums text-brass-700 dark:border-brass-300/30 dark:text-brass-300"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <div className="text-sm font-semibold leading-snug text-forest-900 dark:text-cream-50">{point.lead}</div>
              <p className="mt-1 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">{point.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function AtAGlance() {
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
    <Card padding="lg" className="legal-card mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">At a glance</div>
          <h2 className="mt-2 font-serif text-2xl text-forest-900 dark:text-cream-50">The practical numbers</h2>
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-forest-600 dark:text-cream-200/60">
          The security deposit and the cancellation policy are published live by the Admin. See the{' '}
          <Link to="/rates" className="text-link">Rates &amp; fees</Link> page and section 9.
        </p>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="border-t border-forest-900/5 pt-3 dark:border-cream-100/10">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">{fact.label}</dt>
            <dd className="mt-1 text-sm font-medium leading-snug text-forest-900 dark:text-cream-50">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function DocumentControl() {
  return (
    <Card padding="lg" className="legal-card mt-14" id="document-control">
      <div className="eyebrow">Document control</div>
      <h2 className="mt-2 font-serif text-2xl text-forest-900 dark:text-cream-50 lg:text-3xl">
        Version, review and history
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
        This page is the controlled version of the Hacienda’s terms, privacy notice and booking rules. The Admin
        reviews it at least once a year and whenever a booking, payment, privacy or access rule changes.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="panel-muted p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Version</div>
          <div className="mt-1 font-serif text-lg text-forest-900 dark:text-cream-50">{LEGAL_VERSION}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Effective</div>
          <div className="mt-1 font-serif text-lg text-forest-900 dark:text-cream-50">{formatDate(LEGAL_EFFECTIVE_DATE)}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Last reviewed</div>
          <div className="mt-1 font-serif text-lg text-forest-900 dark:text-cream-50">{formatDate(LEGAL_LAST_REVIEWED)}</div>
        </div>
      </div>
      <LegalTable head={['Field', 'Detail']} rows={LEGAL_DOCUMENT_CONTROL.map((item) => [item.field, item.value])} />
      <h3 className="mt-8 font-serif text-xl text-forest-900 dark:text-cream-50">Version history</h3>
      <LegalTable
        head={['Version', 'Effective', 'Summary of changes']}
        rows={LEGAL_VERSION_HISTORY.map((entry) => [entry.version, entry.effective, entry.summary])}
      />
    </Card>
  )
}

function ContactCard() {
  return (
    <Card padding="lg" className="legal-card mt-6" id="legal-contact">
      <div className="eyebrow">Talk to the Hacienda</div>
      <h2 className="mt-2 font-serif text-2xl text-forest-900 dark:text-cream-50 lg:text-3xl">
        Questions, complaints and privacy requests
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
        Contact the Hacienda through an official channel. For a booking or stay issue, include your booking
        reference and dates. For a privacy request, use the subject line “Privacy request”.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <a href={`tel:${BUSINESS.contact.phone.replace(/\s/g, '')}`} className="panel-muted block p-4 transition hover:border-forest-700/30">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Phone</div>
          <div className="mt-1 text-sm font-medium text-forest-900 dark:text-cream-50">{BUSINESS.contact.phoneDisplay}</div>
        </a>
        <a href={`mailto:${BUSINESS.contact.email}`} className="panel-muted block p-4 transition hover:border-forest-700/30">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Email</div>
          <div className="mt-1 break-all text-sm font-medium text-forest-900 dark:text-cream-50">{BUSINESS.contact.email}</div>
        </a>
        <div className="panel-muted p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Address</div>
          <div className="mt-1 text-sm font-medium leading-snug text-forest-900 dark:text-cream-50">{BUSINESS.address.formatted}</div>
        </div>
        <div className="panel-muted p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">Official listings</div>
          <div className="mt-1 flex flex-col gap-1 text-sm font-medium text-forest-900 dark:text-cream-50">
            <a href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer" className="text-link">{LISTINGS.airbnb.label}</a>
            <a href={LISTINGS.agoda.url} target="_blank" rel="noreferrer" className="text-link">{LISTINGS.agoda.label}</a>
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/contact" className="btn-primary btn-sm">Contact page</Link>
        <Link to="/support" className="btn-ghost btn-sm">Guest support</Link>
        <Link to="/house-rules" className="btn-ghost btn-sm">House rules</Link>
      </div>
    </Card>
  )
}

export function LegalPage() {
  const published = usePublishedRates()
  const minutes = readingMinutes()

  return (
    <Page className="legal-page dark:bg-forest-950 dark:text-cream-50">
      <div id="top" />
      <Container width="content" className="legal-container">
        <div>
          <PageHeader
            eyebrow="Legal & privacy"
            title="Terms, privacy and booking rules"
            lead={
              <p>
                The full agreement for a stay at Hacienda de LuisAna: how a booking is confirmed, what the
                payment covers, how a cancellation is handled, what the Hacienda does with your personal data,
                and what is expected of every guest. Please read it before you book or pay. Acceptance is never
                assumed — you must tick the box on the booking and payment steps.
              </p>
            }
            actions={
              <span className="no-print">
                <button type="button" onClick={() => window.print()} className="btn-ghost btn-sm">
                  Print / save PDF
                </button>
              </span>
            }
            aside={
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="badge border border-forest-900/10 bg-cream-100/60 dark:border-cream-100/15 dark:bg-forest-900/60">Version {LEGAL_VERSION}</span>
                <span className="badge border border-forest-900/10 bg-cream-100/60 dark:border-cream-100/15 dark:bg-forest-900/60">Effective {formatDate(LEGAL_EFFECTIVE_DATE)}</span>
                <span className="badge border border-forest-900/10 bg-cream-100/60 dark:border-cream-100/15 dark:bg-forest-900/60">About {minutes} min read</span>
              </div>
            }
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-forest-700 dark:text-cream-100/85">
          <span>
            Terms version: <time dateTime={LEGAL_VERSION}>{LEGAL_VERSION}</time>
          </span>
          <span aria-hidden="true" className="text-forest-400 dark:text-cream-200/40">·</span>
          <span>Last reviewed {formatDate(LEGAL_LAST_REVIEWED)}</span>
          <span aria-hidden="true" className="text-forest-400 dark:text-cream-200/40">·</span>
          <span>Next review {formatDate(LEGAL_NEXT_REVIEW)}</span>
        </div>
        <p className="mt-3 text-sm text-forest-800 dark:text-cream-100/85">
          For the Hacienda’s stay rules, see <Link to="/house-rules" className="text-link">House rules &amp; good to know</Link>.
          For the live rates and the security deposit, see the <Link to="/rates" className="text-link">Rates &amp; fees</Link> page.
        </p>

        <div className="no-print mt-6 lg:hidden">
          <Card padding="md">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-forest-900 dark:text-cream-50">
                On this page · {TERMS.length} sections
              </summary>
              <div className="mt-4">
                <TableOfContents compact />
              </div>
            </details>
          </Card>
        </div>

        <div className="mt-8">
          <SummaryCard />
          <AtAGlance />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
          <div className="min-w-0">
            {LEGAL_PARTS.map((part, partIndex) => {
              const sections = sectionsInPart(part.id)
              if (sections.length === 0) return null
              const first = sectionNumber(sections[0].id) ?? 0
              const last = sectionNumber(sections[sections.length - 1].id) ?? first
              return (
                <section key={part.id} className="mt-12 first:mt-0" aria-labelledby={`part-${part.id}`}>
                  <div className="flex items-start gap-4 border-t border-forest-900/10 pt-6 dark:border-cream-100/10">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass-600/30 font-serif text-xl text-brass-700 dark:border-brass-300/30 dark:text-brass-300"
                    >
                      {PART_LETTERS[partIndex]}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-forest-500 dark:text-sage-400">
                        Part {PART_LETTERS[partIndex]} · Sections {first}–{last}
                      </div>
                      <h2 id={`part-${part.id}`} className="mt-1 font-serif text-2xl text-forest-900 dark:text-cream-50 lg:text-3xl">
                        {part.title}
                      </h2>
                      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-forest-700/80 dark:text-cream-100/70">{part.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-6 space-y-6">
                    {sections.map((section) => (
                      <SectionCard key={section.id} section={section} publishedRefund={published} />
                    ))}
                  </div>
                </section>
              )
            })}

            <DocumentControl />
            <ContactCard />

            <div className="no-print mt-8 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Link to="/book" className="btn-primary btn-sm">Check availability</Link>
                <Link to="/faqs" className="btn-ghost btn-sm">Common questions</Link>
                <Link to="/support" className="btn-ghost btn-sm">Guest support</Link>
              </div>
              <a href="#top" className="text-sm text-forest-700 underline underline-offset-4 hover:text-forest-950 dark:text-cream-200/80 dark:hover:text-cream-50">
                Back to top ↑
              </a>
            </div>
          </div>

          <aside className="no-print hidden lg:block">
            <div className="sticky top-28">
              <Card padding="md">
                <TableOfContents />
              </Card>
              <div className="mt-4 rounded-2xl border border-forest-900/10 bg-cream-100/60 p-4 text-xs leading-relaxed text-forest-700 dark:border-cream-100/10 dark:bg-forest-900/40 dark:text-cream-200/70">
                <div className="font-semibold text-forest-900 dark:text-cream-50">A note on this page</div>
                <p className="mt-1">
                  This page is the Hacienda’s own terms for guests. It is written to be read, not to replace advice
                  from a lawyer. If a clause is unclear, ask before you book.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </Page>
  )
}
