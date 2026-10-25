import type { ReactNode } from 'react'
import { StatusBadge, statusMeaning } from '../ui'
import { BookingHistory } from '../Booking/BookingHistory'
import { StatusTrack } from './StatusTrack'
import {
  accommodationName,
  bookingReference,
  calendarDate,
  daysUntil,
  guestsPhrase,
  nightsBetween,
  nightsPhrase,
  peso,
  stageIndex,
  staySpan,
} from './stayFacts'
import { effectiveStatus } from '../../lib/booking'
import type { Booking } from '../../lib/storage'

/**
 * One stay, as an entry in the Hacienda's guest book.
 *
 * The page used to be a stack of identical rounded cards, each with a photo
 * strip, a grid of tinted tiles, a progress bar and an activity box. Every
 * booking had the same weight, so a Guest scanning for the stay they are about
 * to take had to read all of them — and a completed stay from last quarter took
 * as much room as the one in three weeks.
 *
 * An entry is a row in a book instead:
 *
 * 1. **The date sits in the margin**, on the brass rule, because that is how
 *    anybody finds an entry in a ledger — by when. One tick per night draws the
 *    length of the stay, so "3 nights" is seen before it is read.
 * 2. **The facts are calm prose**, not a grid: what the place is, when it was
 *    booked, who is coming.
 * 3. **The record is folded away.** The stage track and the activity log are
 *    what a Guest opens when something is disputed, not what they need on every
 *    visit, so they live behind one disclosure.
 *
 * Deliberately presentational: it owns no Booking state and calls no lifecycle
 * method. The actions and the conditional forms are handed in by `AccountPage`,
 * which is where the permissions, the confirm dialogs and the transitions
 * already live.
 */
export function StayEntry({
  booking,
  actions,
  review,
  children,
}: {
  booking: Booking
  /** The Guest's own controls for this Booking, under the entry's facts. */
  actions?: ReactNode
  /** The review prompt, for a stay that has already happened. */
  review?: ReactNode
  /** Between the money and the actions: the hold countdown, a payment form, a refusal. */
  children?: ReactNode
}) {
  const status = effectiveStatus(booking)
  const span = staySpan(booking.check_in, booking.check_out)
  const nights = nightsBetween(booking.check_in, booking.check_out)
  const stage = stageIndex(status)
  // "Live" is a stay the Guest can still act on or still take: it is what the
  // brass marks. A closed or finished booking gets the quiet ink.
  const live = stage !== null && daysUntil(booking.check_out) >= 0

  const money = [
    typeof booking.amount_due === 'number' ? { label: 'Downpayment required', value: booking.amount_due } : null,
    typeof booking.amount_claimed === 'number' ? { label: 'Downpayment sent', value: booking.amount_claimed } : null,
    typeof booking.stay_total === 'number' ? { label: 'Stay total', value: booking.stay_total } : null,
    typeof booking.security_deposit === 'number' && booking.security_deposit > 0
      ? { label: 'Refundable deposit', value: booking.security_deposit }
      : null,
  ].filter((row): row is { label: string; value: number } => row !== null)

  // A Pending Booking is still a request; once the Hacienda has answered it is
  // a booking. The word in front of the reference says which one this is.
  const referenceWord = status === 'Pending' ? 'Request' : 'Reference'

  return (
    <article className="ledger-entry" data-live={live || undefined}>
      {/* The margin: the date, the length of the stay, the year. */}
      <div className="ledger-date">
        <span className="ledger-month">{span.month}</span>
        <span className="ledger-days" aria-hidden="true">
          {span.days}
        </span>
        <span className="ledger-year">{span.year}</span>
        <span className="ledger-ticks" aria-hidden="true">
          {Array.from({ length: Math.min(nights, 7) }).map((_, index) => (
            <span key={index} className="ledger-tick" />
          ))}
          {nights > 7 && <span className="ledger-tick-more">+{nights - 7}</span>}
        </span>
        <span className="sr-only">
          Stay from {span.long}, {nightsPhrase(nights)}
        </span>
      </div>

      <div className="ledger-body">
        {/* The tour rings this block rather than the whole entry: an entry can
            be a thousand pixels tall once its payment form is open, and a
            highlight around all of it points at nothing. */}
        <div className="ledger-head" data-tour="booking-card">
          <div className="min-w-0">
            <h3 className="ledger-place">{accommodationName(booking.accommodation)}</h3>
            <p className="ledger-reference">
              {referenceWord}{' '}
              <span className="guest-num">{bookingReference(booking)}</span>
            </p>
          </div>
          <StatusBadge status={status} size="md" />
        </div>

        <p className="ledger-facts">
          Booked {calendarDate(booking.created_at)}, {nightsPhrase(nights)},{' '}
          {guestsPhrase(booking.guests)}
        </p>

        <p className="ledger-meaning">{statusMeaning(status)}</p>

        {money.length > 0 && (
          <dl className="ledger-money">
            {money.map((row) => (
              <div key={row.label} className="ledger-money-row">
                <dt>{row.label}</dt>
                <dd className="guest-num">{peso(row.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {children && <div className="ledger-forms">{children}</div>}
        {actions && <div className="ledger-actions">{actions}</div>}
        {review && <div className="ledger-review">{review}</div>}

        <details className="ledger-record">
          <summary className="ledger-fold">
            Progress and activity
            <span className="ledger-fold-mark" aria-hidden="true" />
          </summary>
          <div className="ledger-record-body">
            <StatusTrack status={status} />
            <BookingHistory bookingId={booking.id} />
          </div>
        </details>
      </div>
    </article>
  )
}
