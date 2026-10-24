import { parseDate, formatDateTime } from '../../lib/formatDate'
import type { ChatMessage } from '../../lib/chatCloud'
import { MessageBubble } from './MessageBubble'

const MESSAGE_GROUP_GAP_MS = 5 * 60_000

type MessageGroup = {
  id: string
  mine: boolean
  messages: ChatMessage[]
}

type MessageDay = {
  id: string
  label: string
  groups: MessageGroup[]
}

function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayLabel(date: Date | null): string {
  if (!date) return 'Date unavailable'
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(date) === dayKey(today)) return 'Today'
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  try {
    return date.toLocaleDateString('en-PH', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return 'Date unavailable'
  }
}

function messageTime(value: unknown): string {
  const date = parseDate(value)
  if (!date) return 'Time unavailable'
  try {
    return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return 'Time unavailable'
  }
}

function buildTimeline(messages: readonly ChatMessage[]): MessageDay[] {
  const days: MessageDay[] = []

  for (const message of messages) {
    const date = parseDate(message.at)
    const id = date ? dayKey(date) : 'date-unavailable'
    let day = days[days.length - 1]
    if (!day || day.id !== id) {
      day = { id, label: dayLabel(date), groups: [] }
      days.push(day)
    }

    let group = day.groups[day.groups.length - 1]
    const previous = group?.messages[group.messages.length - 1]
    const previousDate = previous ? parseDate(previous.at) : null
    const separatedByTime =
      !date || !previousDate || date.getTime() - previousDate.getTime() > MESSAGE_GROUP_GAP_MS

    if (!group || group.mine !== message.mine || separatedByTime) {
      group = { id: message.id, mine: message.mine, messages: [] }
      day.groups.push(group)
    }
    group.messages.push(message)
  }

  return days
}

type MessageTimelineProps = {
  messages: ChatMessage[]
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onScrollToLatest: () => void
  atLatest: boolean
  typingUsers: Set<string>
  isAdmin: boolean
  ariaLabel: string
  emptyTitle: string
  emptyBody: string
}

export function MessageTimeline({
  messages,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onScrollToLatest,
  atLatest,
  typingUsers,
  isAdmin,
  ariaLabel,
  emptyTitle,
  emptyBody,
}: MessageTimelineProps) {
  const timeline = buildTimeline(messages)

  if (messages.length === 0) {
    return null // handled by parent EmptyState
  }

  return (
    <>
      {hasMore && (
        <div className="mb-5 flex justify-center">
          <button
            type="button"
            className="btn-quiet btn-sm"
            disabled={loadingOlder}
            onClick={onLoadOlder}
            data-tour="load-older"
            aria-controls="message-timeline"
            aria-busy={loadingOlder}
          >
            {loadingOlder && <span className="flex h-13 w-13 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        </div>
      )}
      <div
        id="message-timeline"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={ariaLabel}
      >
        {timeline.map((day) => (
          <div key={day.id} className="messages-day">
            <div className="messages-day-label" role="separator" aria-label={day.label}>
              <time dateTime={day.id === 'date-unavailable' ? undefined : day.id}>{day.label}</time>
            </div>
            <div className="space-y-4">
              {day.groups.map((group) => {
                const last = group.messages[group.messages.length - 1]
                return (
                  <div key={group.id} className={`messages-group ${group.mine ? 'messages-group-mine' : ''}`}>
                    {group.messages.map((message, index) => (
                      <li
                        key={message.id}
                        className={`${group.mine ? 'flex justify-end' : 'flex justify-start'} ${index === 0 ? 'mt-1' : ''} ${index === group.messages.length - 1 ? 'mb-1' : ''}`}
                      >
                        <MessageBubble
                          id={message.id}
                          text={message.text}
                          at={message.at}
                          mine={group.mine}
                          isFirst={index === 0}
                          isLast={index === group.messages.length - 1}
                          attachment={message.attachment ?? null}
                        />
                      </li>
                    ))}
                    <time className="messages-time guest-num" dateTime={last.at} title={formatDateTime(last.at, 'Time unavailable')}>
                      {messageTime(last.at)}
                    </time>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {!atLatest && (
        <button type="button" className="messages-latest" onClick={() => onScrollToLatest(true)}>
          Latest messages
          <span className="flex h-15 w-15" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 13l7 7 7-7" />
            </svg>
          </span>
        </button>
      )}

      {typingUsers.size > 0 && (
        <div className="px-4 pt-2 pb-1">
          <span className="flex items-center gap-1.5 text-sm text-forest-500">
            <span className="flex h-2.5 w-2.5">
              <span className="h-[3px] w-[3px] rounded-full bg-forest-500 animate-bounce" />
            </span>
            <span>typing…</span>
          </span>
        </div>
      )}
    </>
  )
}
