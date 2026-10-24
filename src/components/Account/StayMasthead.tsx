import type { ReactNode } from 'react'
import { BUSINESS } from '../../config/site'

import { StatusBadge } from '../ui'
import {
  accommodationImage,
  accommodationName,
  bookingReference,
  daysUntil,
  monthYear,
} from './stayFacts'
import type { Booking } from '../../lib/storage'
import { formatStayDuration } from '../../lib/storage'

/**
 * The top of a Guest's own page.
 *
 * This is the one place on a signed-in page that is allowed to be loud, and it
 * is loud about the subject rather than about the interface: the accommodation
 * the Guest actually booked, on the Hacienda's own photograph, with the dates
 * and the countdown in the display face. Everything under it is a quiet,
 * hairline-ruled document.
 *
 * It renders in two shapes and the page does not change height between them —
 * a Guest with a stay coming gets the photograph, a Guest with none gets the
 * same band in the Hacienda's forest. A page that rearranges itself when the
 * data arrives is a page nobody can aim at.
 */
export function StayMasthead({
  booking,
  greeting,
  roleLabel,
  hasBookings,
  email,
  memberSince,
  actions,
}: {
  /** The Guest's next stay, or null. */
  booking: Booking | null
  greeting: ReactNode
  /** The session's role, for the masthead's one label — e.g. "Guest". */
  roleLabel?: string
  /** True when the account holds bookings, none of them upcoming. */
  hasBookings?: boolean
  email?: string | null
  memberSince?: string | null
  actions?: ReactNode
}) {
  const image = booking ? accommodationImage(booking.accommodation) : null
  const days = booking ? daysUntil(booking.check_in) : 0

  return (
    <section
      className={`guest-masthead guest-rise ${image ? '' : 'guest-masthead-plain'}`}
      aria-label={booking ? 'Your next stay' : 'Your account'}
    >
      {image && (
        <div className="guest-masthead-media" aria-hidden="true">
          <img src={image} alt="" loading="eager" decoding="async" />
        </div>
      )}
      {image && <div className="guest-masthead-scrim" aria-hidden="true" />}

      <div className="px-5 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-10 lg:px-10">
        {/* One label, the same one whether or not a stay is coming. It says
            whose page this is and in what capacity — the two things the rest of
            the band assumes. */}
        <div className="flex items-center gap-3">
          <span className="guest-masthead-rule" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-eyebrow text-cream-100/70">
            Your stay{roleLabel ? ` · ${roleLabel}` : ''}
          </span>
        </div>

        {booking ? (
          <MastheadWithStay
            booking={booking}
            days={days}
            email={email}
            memberSince={memberSince}
            actions={actions}
          />
        ) : (
          <MastheadEmpty
            greeting={greeting}
            hasBookings={hasBookings}
            email={email}
            memberSince={memberSince}
            actions={actions}
          />
        )}
      </div>
    </section>
  )
}

function MastheadWithStay({
  booking,
  days,
  email,
  memberSince,
  actions,
}: {
  booking: Booking
  days: number
  email?: string | null
  memberSince?: string | null
  actions?: ReactNode
}) {
  const countdown =
    days > 0
      ? `${days} day${days === 1 ? '' : 's'} away`
      : days === 0
        ? 'Checking in today'
        : 'In progress'

  return (
    <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h2 className="mt-4 font-serif text-3xl leading-[1.08] text-cream-50 sm:text-4xl lg:text-[2.75rem]">
          {accommodationName(booking.accommodation)}
        </h2>

        <p className="guest-num mt-3 text-lg text-cream-100/95 sm:text-xl">
          {booking.check_in} <span className="text-brass-300">→</span> {booking.check_out}
        </p>
        <p className="mt-1 text-sm text-cream-100/75">
          {formatStayDuration(booking.check_in, booking.check_out)} · {booking.guests} guest
          {booking.guests === 1 ? '' : 's'}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={booking.status} />
          <span className="text-xs font-medium text-cream-100/85">{countdown}</span>
          <span className="text-xs text-cream-100/60">
            Reference <span className="guest-num text-cream-100/90">{bookingReference(booking)}</span>
          </span>
        </div>

        <GuestLine email={email} memberSince={memberSince} />
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>}
    </div>
  )
}

function MastheadEmpty({
  greeting,
  hasBookings,
  email,
  memberSince,
  actions,
}: {
  greeting: ReactNode
  /** True when the account holds bookings, none of them upcoming. */
  hasBookings?: boolean
  email?: string | null
  memberSince?: string | null
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h2 className="mt-4 max-w-xl font-serif text-3xl leading-[1.12] text-cream-50 sm:text-4xl lg:text-[2.75rem]">
          {greeting}
        </h2>

        {/* Two different situations reach this band: an account with nothing on
            it, and an account whose bookings are all behind it. Saying "no stay
            booked yet" to the second one would be wrong — they can see their
            bookings in the list below. */}
        <p className="mt-3 max-w-md text-sm leading-relaxed text-cream-100/80">
          {hasBookings
            ? 'Nothing on the calendar right now. '
            : 'No stay booked yet. '}
          Pick your dates and the Hacienda confirms availability and the final quote with you
          before anything is reserved — {BUSINESS.address.city}, {BUSINESS.address.region}.
        </p>

        <GuestLine email={email} memberSince={memberSince} />
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>}
    </div>
  )
}

/** The signed-in person's own line: who they are, since when. */
function GuestLine({ email, memberSince }: { email?: string | null; memberSince?: string | null }) {
  if (!email && !memberSince) return null
  return (
    <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-cream-100/15 pt-4 text-xs text-cream-100/70">
      {/* A long address is one unbreakable token; without break-all it pushes the
          "Member since" clause out of the band on a narrow screen. */}
      {email && <span className="min-w-0 break-all">{email}</span>}
      {memberSince && (
        <span className="text-cream-100/55">Member since {monthYear(memberSince)}</span>
      )}
    </p>
  )
}
