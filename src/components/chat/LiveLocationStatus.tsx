import type { UseLiveLocation } from '../../hooks/useLiveLocation'
import { Close, MapPin } from '../../lib/icons'

export type LiveLocationStatusProps = {
  sharing: UseLiveLocation
  dismissed?: boolean
  onDismiss?: () => void
}

/**
 * Compact 1-line live-location status bar shown at the top of the conversation
 * while the Guest is actively sharing their position.
 *
 * - Never invents a routing ETA when no routing engine is active; shows the
 *   genuine session countdown (`28:14 remaining`) and live publish state.
 * - Separates "Minimize banner" (`onDismiss`) from `Stop Sharing` (`sharing.stop()`).
 */
export function LiveLocationStatus({
  sharing,
  dismissed = false,
  onDismiss,
}: LiveLocationStatusProps) {
  if (sharing.phase !== 'active' || !sharing.session || dismissed) {
    return null
  }

  const stateDetail = sharing.offline
    ? 'Paused — no connection'
    : sharing.fixError
      ? 'Location is not reaching the hacienda'
      : sharing.lastSentAtMs !== null
        ? 'Updating live'
        : 'Locating GPS…'

  // A refused write is not "still locating". The Guest is standing somewhere
  // the hacienda cannot see, and nothing on their screen used to say so: the
  // banner said "Locating GPS…" for the whole session, the Admin's panel said
  // "Waiting for the Guest's first position…", and neither side had a word for
  // what was actually wrong. Name it, and keep the session alive — the code is
  // for the Guest to report, not a reason to end a share that may recover.
  const publishWarning =
    sharing.fixError && sharing.phase === 'active' && !sharing.offline
      ? 'Your position is not reaching the hacienda. Sharing is still on and will keep retrying — if this does not clear, tell the hacienda and send them this code: ' +
        sharing.fixError
      : null

  return (
    <div
      role="status"
      aria-label="Live location active"
      data-tour="live-location-active"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-forest-900/10 bg-cream-100/90 px-4 py-2 text-xs text-forest-900 dark:border-cream-100/10 dark:bg-forest-950/60 dark:text-cream-50 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-700 text-cream-50">
          <MapPin size={12} />
        </span>
        <p className="truncate font-medium">
          <span aria-hidden="true">📍 </span>
          <span>Live Location Active</span>
          {sharing.countdown && (
            <span className="tabular-nums text-forest-700 dark:text-cream-100/85">
              {' '}
              · {sharing.countdown} remaining
            </span>
          )}
          <span className="hidden text-forest-600 dark:text-sage-300 sm:inline">
            {' '}
            · {stateDetail}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="btn-quiet btn-sm"
          onClick={() => void sharing.stop()}
        >
          Stop Sharing
        </button>
        {onDismiss && (
          <button
            type="button"
            className="icon-btn !h-8 !w-8"
            onClick={onDismiss}
            aria-label="Minimize live location bar"
            title="Hide banner while keeping location sharing active"
          >
            <Close size={14} />
          </button>
        )}
      </div>

      {publishWarning && (
        <p role="alert" className="w-full text-[11px] leading-snug text-forest-800 dark:text-cream-100/80">
          {publishWarning}
        </p>
      )}
    </div>
  )
}
