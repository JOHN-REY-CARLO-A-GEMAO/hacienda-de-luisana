import { Link } from 'react-router-dom'
import { BUSINESS } from '../../config/site'
import { Help, MessageCircle } from '../../lib/icons'
import { monthYear } from './stayFacts'

/**
 * The inside cover of the guest book.
 *
 * This is the page beside the entries, not a dashboard sidebar. It carries the
 * two things that are not about one stay: whose book this is, and how to reach a
 * person at the Hacienda. Both used to be panels of tiles and facts; a bookplate
 * does the first job in a way a Guest can read at a glance and the estate can be
 * proud of, and the second stays a short list of the two channels the Hacienda
 * actually answers on.
 *
 * It is sticky from `lg` up, and drops under the entries on a phone, where a
 * second column would only make the page taller.
 */
export function Flyleaf({
  name,
  email,
  memberSince,
}: {
  name: string
  email?: string | null
  /** When the account was created — the Profile's own `created_at`. */
  memberSince?: string | null
}) {
  return (
    <aside className="flyleaf">
      <div className="bookplate">
        <img
          className="bookplate-seal"
          src="/images/brand/hdl-logo.jpg"
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
        />
        <p className="bookplate-label">This book belongs to</p>
        <p className="bookplate-name">{name}</p>
        {email && <p className="bookplate-meta break-all">{email}</p>}
        {memberSince && <p className="bookplate-meta">Member since {monthYear(memberSince)}</p>}
      </div>

      <section className="flyleaf-block" aria-labelledby="flyleaf-contact">
        <h2 id="flyleaf-contact" className="ledger-aside-title">
          Talk to the Hacienda
        </h2>
        <p className="ledger-aside-copy">
          Questions about your dates, your payment, or anything else on your stay — the Admin
          answers here, and never asks for a password, a PIN or a one-time code.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Link to="/messages" className="btn-quiet btn-sm w-full">
            <MessageCircle size={15} aria-hidden="true" />
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
          <a href={`tel:${BUSINESS.contact.phone}`} className="btn-ghost btn-sm w-full">
            Call {BUSINESS.contact.phoneDisplay}
          </a>
        </div>
        <p className="flyleaf-support">
          <Help size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <Link to="/support" className="text-link">
            Booking, account and official support
          </Link>
        </p>
      </section>
    </aside>
  )
}
