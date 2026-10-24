import type { ReactNode } from 'react'
import { StatusBadge } from '../ui'
import {
  accommodationImage,
  accommodationName,
  bookingReference,
  daysUntil,
  shortDate,
} from './stayFacts'
import { formatStayDuration, type Booking } from '../../lib/storage'
import { effectiveStatus } from '../../lib/booking'
import { StatusTrack } from './StatusTrack'

/**
 * One Booking, drawn as the document it is.
 *
 * The Guest's page used to be a stack of identical rounded cards, every fact the
 * same size and nothing about the place in any of them. A folio is different in
 * three ways that each do work:
 *
 * 1. **The accommodation's own photograph** leads, so a Booking is a place and
 *    not a row, and the reference number sits on it rather than beside it.
 * 2. **The facts are a ledger** — label over value on a hairline, in the display
 *    face for the figures — instead of a grid of tinted tiles. A Guest scanning
 *    for their dates reads down one edge.
 * 3. **The stages are a track**, so "what happens next" is visible without
 *    reading the status word and translating it.
 *
 * Deliberately presentational: it owns no Booking state and calls no lifecycle
 * method. The actions and the trailing forms are handed in by `AccountPage`,
 * which is where the permissions, the confirm dialogs and the transitions
 * already live.
 */
export function BookingFolio({
  booking,
  actions,
  trailing,
  children,
}: {
  booking: Booking
  /** The Guest's own controls for this Booking, in the folio's foot band. */
  actions?: ReactNode
  /** What renders under the activity log: the optional review prompt. */
  trailing?: ReactNode
  /** Between the ledger and the action band: the hold countdown, a refusal. */
  children?: ReactNode
}) {
  const status = effectiveStatus(booking)
  const image = accommodationImage(booking.accommodation)
  const days = daysUntil(booking.check_in)
  const soon = days > 0 && days <= 30

  return (
    <article className="guest-panel overflow-hidden" data-tour="booking-card">
      {/* Photograph + the folio's own title block */}
      <div className="flex flex-col sm:flex-row">
        {image && (
          <div className="guest-photo h-36 w-full shrink-0 sm:h-auto sm:w-44" aria-hidden="true">
            <img src={image} alt="" loading="lazy" decoding="async" />
          </div>
        )}

        <div className="min-w-0 flex-1 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="guest-label">
                Request <span className="guest-num text-forest-800 dark:text-cream-100">{bookingReference(booking)}</span>
              </span>
              <h3 className="mt-1 font-serif text-2xl leading-tight text-forest-900 dark:text-cream-50">
                {accommodationName(booking.accommodation)}
              </h3>
              {soon && (
                <p className="mt-1 text-xs font-medium text-brass-600 dark:text-brass-300">
                  {days} day{days === 1 ? '' : 's'} until check-in
                </p>
              )}
            </div>
            <span className="shrink-0">
              <StatusBadge status={status} size="md" />
            </span>
          </div>

          <div className="mt-4">
            <StatusTrack status={status} />
          </div>
        </div>
      </div>

      {/* The ledger */}
      <div className="px-5 pb-5 sm:px-6">
        <dl className="guest-ledger sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Check in">
            <span className="guest-num text-base">{shortDate(booking.check_in)}</span>
            <span className="sr-only"> ({booking.check_in})</span>
          </Fact>
          <Fact label="Check out">
            <span className="guest-num text-base">{shortDate(booking.check_out)}</span>
            <span className="sr-only"> ({booking.check_out})</span>
          </Fact>
          <Fact label="Length of stay">{formatStayDuration(booking.check_in, booking.check_out)}</Fact>
          <Fact label="Guests">
            <span className="guest-num text-base">{booking.guests}</span>{' '}
            <span className="text-xs font-normal text-forest-600 dark:text-sage-400">
              guest{booking.guests === 1 ? '' : 's'}
            </span>
          </Fact>
          {typeof booking.amount_claimed === 'number' && (
            <Fact label="Downpayment sent">
              <span className="guest-num text-base">
                ₱{booking.amount_claimed.toLocaleString('en-PH')}
              </span>
            </Fact>
          )}
          {typeof booking.amount_due === 'number' && (
            <Fact label="Required downpayment">
              <span className="guest-num text-base">
                ₱{booking.amount_due.toLocaleString('en-PH')}
              </span>
            </Fact>
          )}
          {typeof booking.stay_total === 'number' && (
            <Fact label="Stay total">
              <span className="guest-num text-base">
                ₱{booking.stay_total.toLocaleString('en-PH')}
              </span>
            </Fact>
          )}
          {typeof booking.security_deposit === 'number' && booking.security_deposit > 0 && (
            <Fact label="Refundable deposit">
              <span className="guest-num text-base">
                ₱{booking.security_deposit.toLocaleString('en-PH')}
              </span>
            </Fact>
          )}
        </dl>

        {children && <div className="mt-4 space-y-3">{children}</div>}
      </div>

      {actions && <div className="guest-actionbar">{actions}</div>}

      {trailing && <div className="guest-rule px-5 py-5 sm:px-6">{trailing}</div>}
    </article>
  )
}

/** One label-over-value pair in the folio's ledger. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-forest-900/8 py-2.5 first:border-t-0 sm:border-t-0 sm:py-0 dark:border-cream-100/10">
      <dt className="guest-label">{label}</dt>
      <dd className="guest-value">{children}</dd>
    </div>
  )
}
