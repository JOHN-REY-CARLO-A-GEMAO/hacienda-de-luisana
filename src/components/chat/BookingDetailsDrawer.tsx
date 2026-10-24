import type { Booking } from '../../lib/storage'

/**
 * A toggleable booking summary drawer showing only information the current
 * user is authorized to see. Reuses existing booking data — no second source
 * of truth. On mobile it slides in from the bottom; on desktop it is a side
 * panel beside the message timeline.
 */
export function BookingDetailsDrawer({
  open,
  onClose,
  booking,
}: {
  open: boolean
  onClose: () => void
  booking: Booking | null
}) {
  if (!open) return null

  const formatDate = (value: string | undefined | null): string => {
    if (!value) return 'Not recorded'
    try {
      return new Date(value).toLocaleDateString('en-PH', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return 'Not recorded'
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col lg:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label="Booking details"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-forest-950/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col bg-white shadow-2xl lg:static lg:w-80 lg:rounded-none lg:border-l border-card-surface lg:shadow-none"
        aria-label="Booking summary"
      >
        <div className="flex items-center justify-between gap-4 border-b border-card-surface px-5 py-4">
          <h2 className="text-sm font-semibold text-forest-900">
            Booking Details
          </h2>
          <button
            type="button"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-forest-600 hover:bg-forest-50 transition-colors"
            onClick={onClose}
            aria-label="Close booking details"
          >
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!booking ? (
            <div className="text-center py-10">
              <p className="text-sm text-forest-500">Booking details unavailable.</p>
            </div>
          ) : (
            <>
              {booking.ref_id && (
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                    Reference
                  </span>
                  <p className="text-sm text-forest-900 font-medium truncate">
                    Ref #{booking.ref_id}
                  </p>
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                  Property
                </span>
                <p className="text-sm text-forest-900 truncate">
                  {booking.accommodation ? booking.accommodation : 'Not recorded'}
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                  Check-in
                </span>
                <p className="text-sm text-forest-900">{formatDate(booking.check_in)}</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                  Check-out
                </span>
                <p className="text-sm text-forest-900">{formatDate(booking.check_out)}</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                  Status
                </span>
                <p className="text-sm text-forest-900 font-medium capitalize">
                  {booking.status || 'Not recorded'}
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-forest-400 uppercase tracking-wider">
                  Guests
                </span>
                <p className="text-sm text-forest-900">
                  {booking.guests != null ? String(booking.guests) : 'Not recorded'}
                </p>
              </div>
              {booking.special_requests && booking.special_requests.trim() && (
                <div>
                  <span className="block text-xs font-semibold text-forest-400 uppercase tracking-wider mb-1">
                    Notes
                  </span>
                  <p className="text-sm text-forest-700/90 leading-relaxed">
                    {booking.special_requests}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-card-surface p-4">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-forest-600 border border-transparent rounded-lg hover:bg-forest-50 transition-colors"
            onClick={onClose}
          >
            Close &rarr;
          </button>
        </div>
      </aside>
    </div>
  )
}
