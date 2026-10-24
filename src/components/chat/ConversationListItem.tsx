import { User } from '../../lib/icons'
import type { ConversationSummary } from '../../lib/chatCloud'

/**
 * One inbox row: guest avatar, name, property + booking reference, latest
 * message preview, timestamp, and unread indicator. No raw identifiers
 * appear anywhere in the card.
 */
export function ConversationListItem({
  summary,
  active,
  onSelect,
}: {
  summary: ConversationSummary
  active: boolean
  onSelect: (summary: ConversationSummary) => void
}) {
  const hasUnread = (summary.unreadCount ?? 0) > 0
  const latestTime = summary.latestMessageAt
    ? new Date(summary.latestMessageAt).toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <button
      type="button"
      className={`
        group relative flex w-full items-center gap-4 p-4 rounded-xl
        transition-colors
        border border-transparent
        ${active
          ? 'bg-forest-900/10 border-forest-900/20 shadow-sm'
          : 'bg-white border-card-surface hover:bg-forest-50/50'}
      `}
      onClick={() => onSelect(summary)}
      aria-current={active ? 'true' : undefined}
      aria-label={
        summary.guestName +
        (summary.bookingReference ? `, booking ${summary.bookingReference}` : '') +
        (hasUnread ? `, ${summary.unreadCount} unread` : '')
      }
    >
      {/* Left: guest avatar */}
      <div className="shrink-0">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-forest-100 text-forest-800 font-medium">
          <span className="text-sm">
            {summary.guestName
              ? summary.guestName.split(' ').map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join('')
              : 'G'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-forest-900 group-hover:text-forest-700 transition-colors truncate">
            {summary.guestName || 'Guest'}
          </span>
          {hasUnread && (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full bg-forest-600 text-white text-[10px] font-bold shrink-0"
              aria-label={`${summary.unreadCount} unread`}
            >
              {summary.unreadCount > 9 ? '9+' : summary.unreadCount}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-forest-600 truncate">
          {summary.propertyName && summary.bookingReference
            ? `${summary.propertyName} · Ref #${summary.bookingReference}`
            : summary.propertyName || summary.bookingReference || 'Booking details unavailable'}
        </p>
        <p className="mt-1 text-sm text-forest-500 truncate">
          {summary.latestMessageText || 'No messages yet — start the conversation.'}
        </p>
      </div>

      {/* Right: timestamp + unread indicator */}
      <div className="shrink-0 flex flex-col items-end gap-1 text-right">
        {latestTime ? (
          <span className="text-xs text-forest-400 leading-none">
            {latestTime}
          </span>
        ) : null}
        {hasUnread && latestTime ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-forest-100 text-forest-700 text-xs font-semibold border border-forest-200">
            <span className="flex h-2.5 w-2.5 rounded-full bg-forest-600" aria-hidden="true" />
            {summary.unreadCount > 9 ? '9+' : summary.unreadCount}
          </span>
        ) : null}
      </div>
    </button>
  )
}
