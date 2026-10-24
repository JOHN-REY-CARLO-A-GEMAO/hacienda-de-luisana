import type { ComponentType, ReactNode } from 'react'
import { BUSINESS } from '../../config/site'
import { Help, MessageCircle } from '../../lib/icons'
import { Link } from 'react-router-dom'

/**
 * The right-hand column of a Guest page.
 *
 * It carries the things a Guest wants *beside* what they came for: the counts,
 * their own contact details, and the way to reach the Hacienda. It is sticky
 * from `lg` up so it is still there after a long list of Bookings, and it drops
 * underneath the main column on a phone, where a second column would only make
 * the page taller.
 *
 * Nothing here is a metric tile. A count is a label and a number on a hairline —
 * the same shape as every other fact on the page, so the rail reads as part of
 * the document rather than as a dashboard sidebar.
 */
export function AccountRail({ children }: { children: ReactNode }) {
  return <aside className="guest-rail">{children}</aside>
}

/** One panel in the rail. */
export function RailPanel({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="guest-panel px-5 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
      {footer && <div className="guest-rule -mx-5 mt-4 px-5 pt-3.5">{footer}</div>}
    </section>
  )
}

/**
 * The way to a person, which is the thing a Guest page should never make hard to
 * find. The Hacienda answers on Messenger and by phone; both are published in
 * `config/site`, so this panel cannot drift from the footer.
 */
export function HelpPanel() {
  return (
    <RailPanel title="Talk to the Hacienda">
      <p className="text-xs leading-relaxed text-forest-800/85 dark:text-cream-100/80">
        Questions about your dates, your payment, or anything else on your stay. The Admin answers
        here — not by asking for a password, a PIN or a one-time code.
      </p>
      <div className="mt-3.5 flex flex-col gap-2">
        <Link to="/messages" className="btn-quiet btn-sm w-full">
          <MessageCircle size={14} aria-hidden="true" />
          Message the Admin
        </Link>
        <a
          href={BUSINESS.contact.messenger}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost btn-sm w-full"
        >
          Open Messenger
        </a>
        <a
          href={`tel:${BUSINESS.contact.phone}`}
          className="btn-ghost btn-sm w-full"
        >
          Call {BUSINESS.contact.phoneDisplay}
        </a>
      </div>
      <p className="mt-3.5 flex items-start gap-2 text-[11px] leading-relaxed text-forest-600 dark:text-sage-400">
        <Help size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <Link to="/support" className="text-link">
          Disputes and how a booking is reviewed
        </Link>
      </p>
    </RailPanel>
  )
}

/**
 * A rail panel that is a short list of labelled values — the Guest's own contact
 * details, or what they have paid so far.
 */
export function RailFacts({
  icon: Icon,
  rows,
}: {
  icon?: ComponentType<{ size?: number; className?: string }>
  rows: readonly { label: string; value: ReactNode }[]
}) {
  return (
    <div>
      {Icon && <Icon size={18} className="mb-2 text-forest-600 dark:text-sage-400" aria-hidden="true" />}
      <dl>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 border-t border-forest-900/8 py-2 first:border-t-0 dark:border-cream-100/10"
          >
            <dt className="guest-label">{row.label}</dt>
            <dd className="guest-value mt-0 text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
