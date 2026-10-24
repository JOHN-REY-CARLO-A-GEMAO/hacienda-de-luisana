import { Link } from 'react-router-dom'
import { BUSINESS } from '../../config/site'
import { effectiveStatus } from '../../lib/booking'
import { sanitizeBookingReference } from '../../lib/chatCloud'
import { Compass, MapPin, Phone } from '../../lib/icons'
import { formatStayDuration, type Booking } from '../../lib/storage'
import { accommodationName, peso, shortDate } from '../Account/stayFacts'
import { Drawer, StatusBadge } from '../ui'

export type BookingDetailsDrawerProps = {
  open: boolean
  onClose: () => void
  booking: Booking | null | undefined
  fallbackPropertyName?: string | null
  fallbackReference?: string | null
}

/**
 * Accessible Booking Details Drawer layered over the unified conversation.
 * Built on the shared `Drawer` (`useOverlay`: Escape key, backdrop click,
 * focus trap & restore, scroll lock) and displays only verified booking &
 * Hacienda facts — never raw document IDs or accommodation slugs.
 */
export function BookingDetailsDrawer({
  open,
  onClose,
  booking,
  fallbackPropertyName,
  fallbackReference,
}: BookingDetailsDrawerProps) {
  const safeRef = sanitizeBookingReference(booking?.ref_id ?? fallbackReference)
  const propertyLabel = booking
    ? accommodationName(booking.accommodation)
    : fallbackPropertyName || 'Hacienda de LuisAna'
  const status = booking ? effectiveStatus(booking) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Booking details"
      description={safeRef ? `Reservation ${safeRef}` : 'Your stay summary and verified resort details'}
    >
      <div className="space-y-5">
        {booking ? (
          <>
            <div className="guest-inset p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="guest-label">Accommodation</span>
                  <p className="mt-1 font-serif text-xl font-medium text-forest-900 dark:text-cream-50">
                    {propertyLabel}
                  </p>
                  <p className="mt-0.5 text-xs text-forest-600 dark:text-sage-400">
                    {safeRef ? `Reference ${safeRef}` : 'Reference assigned upon confirmation'}
                  </p>
                </div>
                {status && <StatusBadge status={status} />}
              </div>

              <dl className="guest-ledger guest-rule mt-4 grid-cols-2 pt-3 text-sm">
                <div className="py-2">
                  <dt className="guest-label">Check-in</dt>
                  <dd className="guest-value">{shortDate(booking.check_in)}</dd>
                </div>
                <div className="py-2">
                  <dt className="guest-label">Check-out</dt>
                  <dd className="guest-value">{shortDate(booking.check_out)}</dd>
                </div>
                <div className="guest-rule py-2">
                  <dt className="guest-label">Duration</dt>
                  <dd className="guest-value">
                    {formatStayDuration(booking.check_in, booking.check_out)}
                  </dd>
                </div>
                <div className="guest-rule py-2">
                  <dt className="guest-label">Guests</dt>
                  <dd className="guest-value">
                    {booking.guests} {booking.guests === 1 ? 'guest' : 'guests'}
                  </dd>
                </div>
                {typeof booking.stay_total === 'number' && booking.stay_total > 0 && (
                  <div className="guest-rule col-span-2 py-2">
                    <dt className="guest-label">Stay total</dt>
                    <dd className="guest-value guest-num text-base">{peso(booking.stay_total)}</dd>
                  </div>
                )}
              </dl>

              {booking.special_requests && booking.special_requests.trim() && (
                <div className="guest-rule mt-2 pt-3">
                  <span className="guest-label">Recorded stay notes</span>
                  <p className="mt-1 text-xs leading-relaxed text-forest-800 dark:text-cream-100/85">
                    {booking.special_requests}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Link to="/account" onClick={onClose} className="btn-quiet btn-sm">
                View full reservation
              </Link>
            </div>
          </>
        ) : (
          <div className="guest-inset p-4 text-xs leading-relaxed text-forest-700 dark:text-cream-100/80">
            This thread is an earlier inquiry without a linked reservation record. Any new stay you
            book will open its own booking conversation automatically.
          </div>
        )}

        <div className="guest-inset space-y-3 p-4">
          <span className="guest-label">Verified Hacienda contact & arrival</span>
          <div className="flex items-start gap-2.5 text-xs text-forest-800 dark:text-cream-100/85">
            <MapPin size={15} className="mt-0.5 shrink-0 text-forest-600" />
            <span>{BUSINESS.address.formatted}</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-forest-800 dark:text-cream-100/85">
            <Phone size={15} className="shrink-0 text-forest-600" />
            <a href="tel:+639258507707" className="text-link">
              {BUSINESS.contact.phoneDisplay}
            </a>
          </div>
          <div className="pt-1">
            <a
              href={BUSINESS.contact.directions}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost btn-sm"
            >
              <Compass size={14} />
              <span>Open Google Maps Directions</span>
            </a>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
