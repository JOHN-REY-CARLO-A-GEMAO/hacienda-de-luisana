import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../lib/chatCloud'
import { ArrowDown } from '../../lib/icons'
import { EmptyState, LoadingPanel } from '../ui'
import { MessageBubble, type DeliveryStatus } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'

export type MessageTimelineProps = {
  messages: readonly ChatMessage[]
  loading?: boolean
  hasMore?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  typing?: boolean
  typingLabel?: string
  /** True when running in local offline demo mode (honest delivery state). */
  isLocalDemo?: boolean
  /** Cloud unread_admin counter & admin_last_read_at watermark for genuine read status. */
  unreadAdminCount?: number
  adminLastReadAt?: string | null
  emptyTitle?: string
  emptyDescription?: string
}

type DayBucket = {
  dayKey: string
  dayLabel: string
  items: ChatMessage[]
}

function formatDayHeading(iso: string): { key: string; label: string } {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: 'Recent' }
  }
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  if (key === todayKey) return { key, label: 'Today' }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(yesterday.getDate()).padStart(2, '0')}`
  if (key === yesterdayKey) return { key, label: 'Yesterday' }

  return {
    key,
    label: date.toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    }),
  }
}

export function MessageTimeline({
  messages,
  loading = false,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  typing = false,
  typingLabel,
  isLocalDemo = false,
  unreadAdminCount = 0,
  adminLastReadAt = null,
  emptyTitle = 'Start your conversation',
  emptyDescription = 'Ask about arrival times, gate access, stay requests, or directions — everything for this booking stays in one thread.',
}: MessageTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const prevSnapshotRef = useRef<{
    firstId: string | null
    lastId: string | null
    scrollHeight: number
    scrollTop: number
  }>({ firstId: null, lastId: null, scrollHeight: 0, scrollTop: 0 })
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false)

  const buckets = useMemo<DayBucket[]>(() => {
    const out: DayBucket[] = []
    for (const msg of messages) {
      const { key, label } = formatDayHeading(msg.at)
      const current = out[out.length - 1]
      if (!current || current.dayKey !== key) {
        out.push({ dayKey: key, dayLabel: label, items: [msg] })
      } else {
        current.items.push(msg)
      }
    }
    return out
  }, [messages])

  const scrollToLatest = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    nearBottomRef.current = true
    setHasUnseenBelow(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNear = distanceFromBottom <= 96
    nearBottomRef.current = isNear
    if (isNear) setHasUnseenBelow(false)
    prevSnapshotRef.current.scrollTop = el.scrollTop
    prevSnapshotRef.current.scrollHeight = el.scrollHeight
  }, [])

  // Preserve scroll offset when older messages are prepended, and auto-scroll
  // when opening a thread or sending/receiving while near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const firstId = messages[0]?.id ?? null
    const lastId = messages[messages.length - 1]?.id ?? null
    const prev = prevSnapshotRef.current

    if (prev.firstId === null && messages.length > 0) {
      // Initial page render: jump straight to latest message.
      el.scrollTop = el.scrollHeight
      nearBottomRef.current = true
      setHasUnseenBelow(false)
    } else if (
      prev.firstId !== null &&
      firstId !== prev.firstId &&
      lastId === prev.lastId
    ) {
      // Older page prepended above: keep the user's exact reading position.
      const heightAdded = el.scrollHeight - prev.scrollHeight
      el.scrollTop = prev.scrollTop + Math.max(0, heightAdded)
    } else if (lastId !== prev.lastId && messages.length > 0) {
      const newest = messages[messages.length - 1]
      if (nearBottomRef.current || newest?.mine) {
        el.scrollTop = el.scrollHeight
        nearBottomRef.current = true
        setHasUnseenBelow(false)
      } else {
        setHasUnseenBelow(true)
      }
    }

    prevSnapshotRef.current = {
      firstId,
      lastId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    }
  }, [messages])

  useEffect(() => {
    if (typing && nearBottomRef.current) {
      scrollToLatest(false)
    }
  }, [scrollToLatest, typing])

  // Determine the latest Admin reply timestamp so outgoing Guest messages
  // before an Admin reply (or before `adminLastReadAt` when `unreadAdminCount === 0`)
  // show genuine `Seen` status without ever fabricating read receipts.
  const latestAdminMessageAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (!messages[i].mine) return messages[i].at
    }
    return null
  }, [messages])

  const lastOwnMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].mine) return messages[i].id
    }
    return null
  }, [messages])

  const statusForMessage = (msg: ChatMessage): DeliveryStatus => {
    if (!msg.mine || msg.id !== lastOwnMessageId) return null
    if (isLocalDemo) return 'local'
    if (latestAdminMessageAt && latestAdminMessageAt >= msg.at) return 'seen'
    if (unreadAdminCount === 0 && adminLastReadAt && adminLastReadAt >= msg.at) {
      return 'seen'
    }
    return 'sent'
  }

  return (
    <div className="messages-thread-wrap">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="messages-thread"
        role="log"
        aria-live="polite"
        aria-label="Conversation message history"
      >
        {loading ? (
          <div className="messages-thread-state">
            <LoadingPanel label="Loading messages…" bare />
          </div>
        ) : messages.length === 0 ? (
          <div className="messages-thread-state messages-empty">
            <EmptyState compact title={emptyTitle} body={emptyDescription} />
          </div>
        ) : (
          <>
            {hasMore && onLoadOlder && (
              <div className="mb-5 flex justify-center">
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  disabled={loadingOlder}
                  onClick={() => {
                    if (scrollRef.current) {
                      prevSnapshotRef.current.scrollHeight = scrollRef.current.scrollHeight
                      prevSnapshotRef.current.scrollTop = scrollRef.current.scrollTop
                    }
                    onLoadOlder()
                  }}
                >
                  {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                </button>
              </div>
            )}

            {buckets.map((bucket) => (
              <div key={bucket.dayKey} className="messages-day">
                <div className="messages-day-label">
                  <time>{bucket.dayLabel}</time>
                </div>
                <ul className="space-y-2.5">
                  {bucket.items.map((msg, idx) => {
                    const prev = idx > 0 ? bucket.items[idx - 1] : null
                    const next = idx + 1 < bucket.items.length ? bucket.items[idx + 1] : null
                    const showSenderLabel = !prev || prev.mine !== msg.mine
                    const showTimestamp =
                      !next ||
                      next.mine !== msg.mine ||
                      msg.id === lastOwnMessageId ||
                      Math.abs(Date.parse(next.at) - Date.parse(msg.at)) > 5 * 60_000

                    return (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        showSenderLabel={showSenderLabel}
                        showTimestamp={showTimestamp}
                        deliveryStatus={statusForMessage(msg)}
                      />
                    )
                  })}
                </ul>
              </div>
            ))}

            {typing && (
              <div className="mt-3">
                <TypingIndicator senderLabel={typingLabel} />
              </div>
            )}
          </>
        )}
      </div>

      {hasUnseenBelow && (
        <button
          type="button"
          className="messages-latest"
          onClick={() => scrollToLatest(true)}
        >
          <ArrowDown size={14} />
          <span>New message below</span>
        </button>
      )}
    </div>
  )
}
