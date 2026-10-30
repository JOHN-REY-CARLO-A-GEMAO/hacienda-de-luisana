import { BUSINESS } from '../../config/site'
import { Calendar, Chevron, Lock, MapPin, Phone } from '../../lib/icons'
import { formatConversationTimestamp } from './ConversationListItem'
import { GuestAvatar } from './GuestAvatar'

export type ConversationHeaderProps = {
  guestName: string
  propertyName: string | null
  bookingReference: string | null
  lastActiveAtMs?: number | null
  showBack?: boolean
  onBack?: () => void
  detailsOpen?: boolean
  onToggleBookingDetails: () => void
  /** Guest perspective ('guest', website default) shows Hacienda de LuisAna Concierge; 'admin' shows Guest name. */
  perspective?: 'guest' | 'admin'
  contactPhoneHref?: string | null
  contactPhoneLabel?: string
  liveLocationActive?: boolean
  liveLocationCountdown?: string | null
  liveLocationDismissed?: boolean
  onExpandLiveLocation?: () => void
}

export function ConversationHeader({
  guestName,
  propertyName,
  bookingReference,
  lastActiveAtMs,
  showBack = false,
  onBack,
  detailsOpen = false,
  onToggleBookingDetails,
  perspective = 'guest',
  contactPhoneHref = 'tel:+639258507707',
  contactPhoneLabel = `Call ${BUSINESS.name} at ${BUSINESS.contact.phoneDisplay}`,
  liveLocationActive = false,
  liveLocationCountdown = null,
  liveLocationDismissed = false,
  onExpandLiveLocation,
}: ConversationHeaderProps) {
  const title = perspective === 'admin' ? guestName : `${BUSINESS.name} · Concierge`
  const stayContext = [
    propertyName || 'Stay conversation',
    bookingReference || null,
  ]
    .filter(Boolean)
    .join(' · ')

  const activityText = lastActiveAtMs
    ? `Last activity ${formatConversationTimestamp(lastActiveAtMs)}`
    : 'Private Guest–Admin channel'

  return (
    <header className="messages-conversation-header justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {showBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="messages-back"
            aria-label="Back to stays list"
          >
            <Chevron size={16} className="rotate-90" />
            <span>Stays</span>
          </button>
        )}

        <GuestAvatar
          name={perspective === 'admin' ? guestName : BUSINESS.name}
          variant={perspective === 'admin' ? 'guest' : 'hacienda'}
          size="md"
        />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-forest-900 dark:text-cream-50">
              {title}
            </h2>
            <span className="messages-private" title="Access controlled by Firestore rules">
              <Lock size={11} />
              <span>Private</span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-forest-600 dark:text-sage-300">
            <span>{stayContext}</span>
            <span className="hidden sm:inline"> · {activityText}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {liveLocationActive && liveLocationDismissed && onExpandLiveLocation && (
          <button
            type="button"
            onClick={onExpandLiveLocation}
            className="inline-flex items-center gap-1.5 rounded-full border border-forest-700/25 bg-cream-100 px-2.5 py-1 text-[11px] font-semibold text-forest-800 transition-colors hover:bg-cream-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-400"
            aria-label="Show active live location status bar"
          >
            <MapPin size={12} />
            <span className="tabular-nums">
              Sharing{liveLocationCountdown ? ` · ${liveLocationCountdown}` : ''}
            </span>
          </button>
        )}

        {contactPhoneHref && (
          <a
            href={contactPhoneHref}
            className="btn-ghost btn-sm"
            aria-label={contactPhoneLabel}
            title={contactPhoneLabel}
          >
            <Phone size={15} />
            <span className="hidden md:inline">Call</span>
          </a>
        )}

        <button
          type="button"
          onClick={onToggleBookingDetails}
          aria-expanded={detailsOpen}
          aria-label="Booking details"
          className="btn-quiet btn-sm"
        >
          <Calendar size={15} />
          <span className="hidden sm:inline">Booking details</span>
        </button>
      </div>
    </header>
  )
}
