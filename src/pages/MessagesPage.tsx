import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeCategories } from '../lib/categories'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { useAuth } from '../hooks/useAuth'
import { ShareLocationBar } from '../components/chat/ShareLocationBar'
import { useLiveLocation } from '../hooks/useLiveLocation'
import {
  CHAT_PAGE_SIZE,
  ensureConversation,
  loadMessagePage,
  mergeMessages,
  sendChatMessage,
  subscribeMessages,
  type ChatMessage,
  type MessageCursor,
} from '../lib/chatCloud'
import { retentionDaysLeft, retentionElapsed } from '../lib/chatRetention'
import { isFirebaseConfigured } from '../lib/firebase'
import { MESSAGE_MAX } from '../lib/validation'
import { formatDateTime } from '../lib/formatDate'
import { Alert, Container, EmptyState, Field, Input, LoadingPanel, Page, PageHeader, Select } from '../components/ui'
import { MessageCircle } from '../lib/icons'

/** How many older messages one "Load earlier messages" press fetches. */
const OLDER_PAGE_SIZE = 30

export function MessagesPage() {
  const { user } = useAuth()
  const [category, setCategory] = useState('booking')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [convoId, setConvoId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<MessageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retention, setRetention] = useState<Date | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  // Once the Guest has walked into the history, the cursor is theirs: the live
  // listener must not drag it back to the newest page, or "load earlier" would
  // fetch messages already on screen.
  const pagedBack = useRef(false)

  const inquiries = useMemo(() => activeCategories('inquiry'), [])
  const sharing = useLiveLocation({ convoId, uid: user?.uid })

  useEffect(() => {
    if (!user?.uid) {
      setStatus('ready')
      return
    }
    let unsub = () => {}
    let cancelled = false
    setStatus('loading')
    setError(null)
    ensureConversation(user.uid, category)
      .then((conversation) => {
        if (cancelled) return
        setConvoId(conversation.id)
        setRetention(conversation.retentionExpiresAt)
        setMessages([])
        setCursor(null)
        setHasMore(false)
        pagedBack.current = false
        setStatus('ready')
        // One listener, bounded to the newest page: it is what makes a reply
        // appear. Older pages are fetched once, on request, and hold no listener.
        unsub = subscribeMessages(
          conversation.id,
          user.uid,
          (page) => {
            setMessages((current) => mergeMessages(current, page.messages))
            setHasMore(page.hasMore)
            if (!pagedBack.current) setCursor(page.cursor)
          },
          CHAT_PAGE_SIZE,
          () => {
            if (!cancelled) setError('Live message updates stopped. Check your connection and try again.')
          },
        )
      })
      .catch(() => setStatus('error'))
    return () => {
      cancelled = true
      unsub()
    }
  }, [user?.uid, category])

  const loadOlder = useCallback(async () => {
    if (!convoId || !user?.uid || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await loadMessagePage({
        convoId,
        uid: user.uid,
        before: cursor,
        pageSize: OLDER_PAGE_SIZE,
      })
      pagedBack.current = true
      setMessages((current) => mergeMessages(current, page.messages))
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch {
      setError('Could not load earlier messages.')
    } finally {
      setLoadingOlder(false)
    }
  }, [convoId, cursor, loadingOlder, user?.uid])

  const send = async () => {
    if (!user?.uid || !convoId) {
      setError('Sign in to message the Admin.')
      return
    }
    if (!text.trim()) {
      setError('Please type a message before sending.')
      return
    }
    if (text.length > MESSAGE_MAX) {
      setError(`Message cannot exceed ${MESSAGE_MAX} characters.`)
      return
    }
    setSending(true)
    setError(null)
    try {
      const rl = checkRateLimit(`chat:${user.uid}`, LIMITS.chat)
      if (!rl.ok) {
        setError(rl.message)
        return
      }
      const result = await sendChatMessage({ convoId, uid: user.uid, text })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setText('')
      if (!isFirebaseConfigured) {
        setMessages((m) =>
          mergeMessages(m, [
            {
              id: crypto.randomUUID(),
              text: text.trim(),
              at: new Date().toISOString(),
              mine: true,
              sender_uid: user.uid as string,
            },
          ]),
        )
      }
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const retentionDays = retentionDaysLeft(retention)
  const retentionSwept = retentionElapsed(retention)

  return (
    <Page>
      <Container width="form">
        <PageHeader
          eyebrow="Messages"
          title="Chat with the Admin"
          lead={
            <p>
              Only your conversation is visible.{' '}
              {isFirebaseConfigured
                ? 'Messages sync to the Admin app.'
                : 'Demo mode: messages stay in this browser until Firebase is configured.'}
            </p>
          }
          aside={
            retention && (
              <p className="text-xs text-forest-700/70">
                {retentionSwept
                  ? 'This thread is scheduled to be cleared after its retention period.'
                  : `This thread is kept for ${retentionDays} more day${retentionDays === 1 ? '' : 's'} after its booking closed, then cleared automatically.`}
              </p>
            )
          }
        />

        <div className="guest-panel mt-6 flex flex-wrap items-end gap-3 px-4 py-3.5">
          <Field label="Topic" className="min-w-[12rem] flex-1">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {inquiries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* The thread: a dotted ground so a run of bubbles has somewhere to sit,
            with the Guest's own messages in the Hacienda's forest and the
            Admin's on white. Which side a message came from should be readable
            without reading the timestamp. */}
        <div className="guest-thread mt-4 flex min-h-[20rem] flex-col p-4">
          {status === 'loading' && <LoadingPanel label="Loading conversation…" bare />}
          {status === 'error' && (
            <Alert tone="danger" className="text-xs">
              Could not open the conversation. Check your connection, then reload the page.
            </Alert>
          )}
          {status === 'ready' && messages.length === 0 && (
            <EmptyState
              compact
              icon={MessageCircle}
              title="No messages yet"
              body="Send a question below and the Admin answers here."
            />
          )}
          {status === 'ready' && messages.length > 0 && (
            <>
              {hasMore && (
                <button
                  type="button"
                  className="btn-ghost btn-sm mb-4 self-center"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                  data-tour="load-older"
                >
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              )}
              <ul className="flex flex-1 flex-col justify-end gap-4">
                {messages.map((m) => (
                  <li key={m.id} className={`flex flex-col gap-1 ${m.mine ? 'items-end' : 'items-start'}`}>
                    <span
                      className={`max-w-[85%] text-left ${
                        m.mine ? 'guest-bubble-mine' : 'guest-bubble-theirs'
                      }`}
                    >
                      {m.text}
                    </span>
                    <span className="guest-num px-1 text-[11px] text-forest-600 dark:text-sage-400">
                      {formatDateTime(m.at, 'Time unavailable')}
                    </span>
                  </li>
                ))}
              </ul>
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="mt-3 flex gap-2" data-tour="message-composer">
          <Input
            className="flex-1"
            aria-label="Write a message"
            value={text}
            maxLength={MESSAGE_MAX}
            data-tour-field="message"
            onChange={(e) => {
              setText(e.target.value.slice(0, MESSAGE_MAX))
              if (error) setError(null)
            }}
            placeholder="Write a message…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="button"
            disabled={sending || !text.trim() || text.length > MESSAGE_MAX || Boolean(error)}
            className="btn-primary shrink-0"
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className="text-forest-600/90 dark:text-cream-200/75">Press Enter to send</span>
          <span
            className={`font-mono tabular-nums transition-colors ${
              text.length >= MESSAGE_MAX
                ? 'text-amber-700 font-semibold dark:text-brass-300'
                : text.length >= MESSAGE_MAX * 0.9
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-forest-600/90 dark:text-cream-200/75'
            }`}
            aria-live="polite"
          >
            {text.length}/{MESSAGE_MAX} characters
          </span>
        </div>
        <ShareLocationBar sharing={sharing} />
        {error && (
          <Alert tone="danger" className="mt-2 text-xs">
            {error}
          </Alert>
        )}
      </Container>
    </Page>
  )
}

/** Exported for tests and for the page that renders the composer. */
export { CHAT_PAGE_SIZE }
