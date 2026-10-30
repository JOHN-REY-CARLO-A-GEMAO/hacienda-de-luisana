import type { ConversationSummary } from '../../lib/chatCloud'
import { shortDate } from '../Account/stayFacts'
import { GuestAvatar } from './GuestAvatar'

export type ConversationListItemProps = {
  summary: ConversationSummary
  selected: boolean
  disabled?: boolean
  /** When 'guest' (website default), rows highlight the stay property & reference; when 'admin', rows lead with the Guest name. */
  perspective?: 'guest' | 'admin'
  onSelect: (summary: ConversationSummary) => void
}

export function formatConversationTimestamp(atMs: number | null): string {
  if (!atMs || Number.isNaN(atMs)) return ''
  const date = new Date(atMs)
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffSec >= 0 && diffSec < 45) return 'Just now'
  if (diffSec >= 45 && diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return 'Yesterday'

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ConversationListItem({
  summary,
  selected,
  disabled = false,
  perspective = 'guest',
  onSelect,
}: ConversationListItemProps) {
  const propertyTitle = summary.propertyName || (summary.isLegacy ? 'Earlier inquiry' : 'Stay inquiry')
  const referenceBadge = summary.bookingReference
    ? summary.bookingReference
    : summary.isLegacy
      ? summary.legacyLabel || 'Earlier inquiry'
      : 'Pending reference'

  const stayDates =
    summary.booking?.check_in && summary.booking?.check_out
      ? `${shortDate(summary.booking.check_in)} – ${shortDate(summary.booking.check_out)}`
      : null

  const primaryTitle = perspective === 'admin' ? summary.guestName : propertyTitle
  const secondaryLine =
    perspective === 'admin'
      ? `${propertyTitle} · ${referenceBadge}`
      : [referenceBadge, stayDates].filter(Boolean).join(' · ')

  const preview = summary.latestMessageText?.trim() || 'Start your conversation with Hacienda de LuisAna'
  const timeText = formatConversationTimestamp(summary.latestMessageAt)
  const unread = summary.unreadCount > 0

  const accessibleLabel = [
    primaryTitle,
    secondaryLine,
    unread ? `${summary.unreadCount} unread` : null,
    `Latest message: ${preview}`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(summary)}
      data-active={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      aria-label={accessibleLabel}
      className={`messages-topic group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass-400 ${
        selected ? 'bg-white dark:bg-forest-900' : ''
      }`}
    >
      <GuestAvatar
        name={perspective === 'admin' ? summary.guestName : 'Hacienda de LuisAna'}
        variant={perspective === 'admin' ? 'guest' : 'hacienda'}
        size="sm"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[13.5px] leading-snug text-forest-900 dark:text-cream-50 ${
              unread ? 'font-bold' : 'font-semibold'
            }`}
          >
            {primaryTitle}
          </span>
          {timeText && (
            <time
              className={`shrink-0 text-[11px] tabular-nums ${
                unread
                  ? 'font-semibold text-forest-800 dark:text-brass-300'
                  : 'text-forest-600 dark:text-sage-400'
              }`}
            >
              {timeText}
            </time>
          )}
        </div>

        <p className="mt-0.5 truncate text-[11.5px] font-medium text-forest-700/85 dark:text-sage-300">
          {secondaryLine}
        </p>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p
            className={`truncate text-xs leading-snug ${
              unread
                ? 'font-semibold text-forest-900 dark:text-cream-50'
                : 'text-forest-600 dark:text-sage-400'
            }`}
          >
            {preview}
          </p>
          {unread && (
            <span className="inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-forest-700 px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-cream-50 dark:bg-brass-400 dark:text-forest-950">
              {summary.unreadCount > 99 ? '99+' : summary.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
