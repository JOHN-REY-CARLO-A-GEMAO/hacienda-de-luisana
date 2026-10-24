import { MapPin } from '../../lib/icons'

/**
 * Compact, dismissible live-location status chip. Distinguishes between
 * hiding the status indicator and stopping location sharing: dismissal only
 * hides the chip; stopping ends the session via the `onStop` prop.
 *
 * Shows an ETA only when `etaMinutes` is provided (calculated from valid
 * location and routing data — never invented).
 */
export function LiveLocationStatus({
  active,
  etaMinutes,
  dismissed,
  onDismiss,
  onStop,
}: {
  active: boolean
  etaMinutes?: number | null
  dismissed: boolean
  onDismiss: () => void
  onStop: () => void
}) {
  if (!active) return null

  return (
    <div
      className="fixed bottom-24 left-4 right-4 z-[50] flex items-center gap-2 rounded-lg bg-forest-900 px-3 py-2 text-white shadow-xl"
      role="status"
      aria-live="polite"
      aria-label="Live location active"
    >
      <MapPin size={14} className="text-accent-gold" aria-hidden="true" />
      <span className="text-sm font-medium">
        Live Location Active
        {etaMinutes != null ? ` · ETA: ${etaMinutes} mins` : ''}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          onClick={onDismiss}
          aria-label="Hide location status"
          title="Hide"
        >
          <span className="sr-only">Hide location status</span>
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          onClick={onStop}
          aria-label="Stop sharing live location"
          title="Stop Sharing"
        >
          <span className="sr-only">Stop sharing live location</span>
          <span className="text-[10px] font-semibold">Stop Sharing</span>
        </button>
      </div>
    </div>
  )
}
