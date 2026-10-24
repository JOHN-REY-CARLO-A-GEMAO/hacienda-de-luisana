import { useState } from 'react'
import { ArrowLeft, Lock, User } from '../../lib/icons'

/**
 * The conversation context header: guest avatar and name, online/last-seen
 * status, assigned property, booking reference, contact action, and a toggle
 * for the booking details panel. Role-aware: the Admin sees "Call Guest",
 * guests see "Call Host".
 */
export function ConversationHeader({
  guestName,
  propertyName,
  bookingReference,
  status,
  isAdmin,
  onBack,
  onCall,
  onToggleBookingDetails,
  bookingDetailsOpen,
}: {
  guestName: string
  propertyName?: string | null
  bookingReference?: string | null
  /** 'online' | 'offline' | null — null means status is unknown (neutral). */
  status?: 'online' | 'offline' | null
  isAdmin: boolean
  onBack: () => void
  onCall: () => void
  onToggleBookingDetails: () => void
  bookingDetailsOpen: boolean
}) {
  const [showDetails, setShowDetails] = useState(bookingDetailsOpen)

  const hasPhone = Boolean(
    isAdmin ? undefined : true
  )

  return (
    <header
      className="flex items-center justify-between gap-4 px-5 py-4 bg-white border-b border-card-surface"
    >
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm font-medium text-forest-600 hover:text-forest-900 transition-colors"
        onClick={onBack}
        aria-label="Back to inbox"
      >
        <ArrowLeft size={16} />
        <span>Inbox</span>
      </button>

      <div className="flex items-center gap-3 min-w-0">
        <div className="relative flex shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-800 font-medium">
          <span className="text-sm">
            {guestName
              ? guestName.split(' ').map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join('')
              : 'G'}
          </span>
          {status === 'online' && (
            <span className="absolute -right-[2px] -bottom-[2px] flex h-3 w-3 rounded-full bg-status-success border-2 border-white"></span>
          )}
          {status === 'offline' && (
            <span className="absolute -right-[2px] -bottom-[2px] flex h-3 w-3 rounded-full bg-forest-300 border-2 border-white"></span>
          )}
        </div>

        <div className="min-w-0">
          <h2 className="text-base font-semibold text-forest-900 leading-tight truncate">
            {guestName || 'Guest'}
          </h2>
          <p className="text-xs text-forest-500 truncate">
            {propertyName && bookingReference
              ? `${propertyName} · Ref #${bookingReference}`
              : propertyName || bookingReference || 'Booking details unavailable'}
          </p>
          {status != null && (
            <p className="text-[10px] text-forest-400 mt-0.5 leading-none">
              {status === 'online'
                ? 'Online'
                : status === 'offline'
                  ? 'Offline'
                  : 'Status unavailable'}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-forest-900 text-white text-sm font-medium hover:bg-forest-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onCall}
          disabled={!hasPhone}
          aria-label={isAdmin ? 'Call guest' : 'Call host'}
          title={isAdmin ? 'Call guest' : 'Call host'}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>{isAdmin ? 'Call Guest' : 'Call Host'}</span>
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-card-surface text-forest-600 hover:bg-forest-50 transition-colors"
          onClick={() => {
            setShowDetails((prev) => !prev)
            onToggleBookingDetails()
          }}
          aria-expanded={showDetails}
          aria-label={showDetails ? 'Hide booking details' : 'Show booking details'}
        >
          <Lock size={16} />
        </button>
      </div>
    </header>
  )
}
