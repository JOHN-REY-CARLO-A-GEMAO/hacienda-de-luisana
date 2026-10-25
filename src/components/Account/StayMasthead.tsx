import type { ReactNode } from 'react'
import { BUSINESS } from '../../config/site'
import { StatusBadge } from '../ui'
import {
  accommodationImage,
  accommodationName,
  bookingReference,
  countdownLabel,
  guestsPhrase,
  nightsBetween,
  nightsPhrase,
  staySpan,
} from './stayFacts'
import type { Booking } from '../../lib/storage'

/**
 * The page opener.
 *
 * A Guest does not come back to this page to be reminded what the house looks
 * like; they come back to check *when* they are going and whether it is
 * confirmed. So the loud line here is the date range, set in the display face at
 * three times the size of anything else on the page, and the accommodation's
 * name is the line above it. That is the inverse of the usual property-hero
 * hierarchy, and it is deliberate: the place is a fact they already know, the
 * dates are the fact they came to check.
 *
 * It renders in two shapes and the page does not change height between them — a
 * Guest with a stay coming gets the photograph, a Guest with none gets the same
 * band in the Hacienda's forest. The masthead is also the only place on this
 * page that can be loud; everything below it is type, rules and ink.
 */
export function StayMasthead({
  booking,
  greeting,
  roleLabel,
  hasBookings,
  actions,
}: {
  /** The Guest's next stay, or null. */
  booking: Booking | null
  /** The name to greet an account with no stay, or null when it has none. */
  greeting?: string | null
  /** The session's role, for the masthead's one label — e.g. "Guest". */
  roleLabel?: string
  /** True when the account holds bookings, none of them upcoming. */
  hasBookings?: boolean
  actions?: ReactNode
}) {
  const image = booking ? accommodationImage(booking.accommodation) : null

  return (
    <section
      className={`ledger-opener guest-rise ${image ? '' : 'ledger-opener-plain'}`}
      aria-label={booking ? 'Your next stay' : 'Your account'}
    >
      {image && (
        <div className="ledger-opener-media" aria-hidden="true">
          <img src={image} alt="" loading="eager" decoding="async" />
        </div>
      )}
      {image && <div className="ledger-opener-scrim" aria-hidden="true" />}

      <div className="ledger-opener-inner">
        <div className="min-w-0">
          {/* The one label the page keeps, and the same one whether or not a
              stay is coming: whose page this is, and in what capacity. */}
          <p className="ledger-opener-kicker">
            Your stay{roleLabel ? ` · ${roleLabel}` : ''}
          </p>

          {booking ? (
            <MastheadWithStay booking={booking} />
          ) : (
            <MastheadEmpty greeting={greeting} hasBookings={hasBookings} />
          )}
        </div>

        {actions && <div className="ledger-opener-actions">{actions}</div>}
      </div>
    </section>
  )
}

function MastheadWithStay({ booking }: { booking: Booking }) {
  const span = staySpan(booking.check_in, booking.check_out)
  const nights = nightsBetween(booking.check_in, booking.check_out)
  const countdown = countdownLabel(booking.check_in, booking.check_out)

  return (
    <>
      <h2 className="ledger-opener-place">{accommodationName(booking.accommodation)}</h2>
      <p className="ledger-opener-dates">{span.long}</p>
      <p className="ledger-opener-meta">
        {span.weekdays}, {nightsPhrase(nights)}, {guestsPhrase(booking.guests)}
      </p>

      <div className="ledger-opener-status">
        <StatusBadge status={booking.status} size="md" />
        {countdown && <span className="ledger-opener-countdown">{countdown}</span>}
        <span className="ledger-opener-reference">
          Reference <span className="guest-num">{bookingReference(booking)}</span>
        </span>
      </div>
    </>
  )
}

function MastheadEmpty({
  greeting,
  hasBookings,
}: {
  greeting?: string | null
  /** True when the account holds bookings, none of them upcoming. */
  hasBookings?: boolean
}) {
  return (
    <>
      {/* The band greets, in the book's own italic hand, rather than announcing
          the empty list a second time: the sheet below already says what is
          missing and what to do about it. */}
      <h2 className="ledger-opener-headline">
        {greeting ? `Kumusta, ${greeting}.` : hasBookings ? 'Welcome back.' : 'Welcome.'}
      </h2>

      <p className="ledger-opener-copy">
        {hasBookings
          ? 'Nothing on the calendar just now — your stays are all in the book below. '
          : ''}
        Pick your dates and the Hacienda confirms availability and the final quote with you
        before anything is reserved. {BUSINESS.address.city}, {BUSINESS.address.region}.
      </p>
    </>
  )
}
