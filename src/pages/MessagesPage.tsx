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

/** How many older messages one "Load earlier messages" press fetches. */
const OLDER_PAGE_SIZE = 30

export function MessagesPage() {
  const { user } = useAuth()
  const [category, setCategory] = useState('booking')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    setError(null)
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
  }

  const retentionDays = retentionDaysLeft(retention)
  const retentionSwept = retentionElapsed(retention)

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-xl px-5">
        <div className="eyebrow">Messages</div>
        <h1 className="display text-4xl mt-2 text-forest-900">Chat with the Admin</h1>
        <p className="mt-3 text-sm text-forest-800/80">
          Only your conversation is visible. {isFirebaseConfigured ? 'Messages sync to the Admin app.' : 'Demo mode: messages stay in this browser until Firebase is configured.'}
        </p>
        {retention && (
          <p className="mt-2 text-xs text-forest-700/70">
            {retentionSwept
              ? 'This thread is scheduled to be cleared after its retention period.'
              : `This thread is kept for ${retentionDays} more day${retentionDays === 1 ? '' : 's'} after its booking closed, then cleared automatically.`}
          </p>
        )}
        <label className="block mt-6">
          <span className="label">Topic</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {inquiries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 bg-white rounded-[24px] border border-forest-900/5 p-4 min-h-[240px]">
          {status === 'loading' && <p className="text-sm text-forest-700/70">Loading conversation…</p>}
          {status === 'error' && <p className="text-sm text-red-700">Could not open the conversation.</p>}
          {status === 'ready' && messages.length === 0 ? (
            <p className="text-sm text-forest-700/70">No messages yet. Send a question below.</p>
          ) : (
            <>
              {hasMore && (
                <button
                  type="button"
                  className="btn-ghost text-xs mb-3"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                  data-tour="load-older"
                >
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              )}
              <ul className="space-y-3">
                {messages.map((m) => (
                  <li key={m.id} className={`text-sm ${m.mine ? 'text-right' : ''}`}>
                    <span className="inline-block rounded-2xl px-3 py-2 bg-cream-100 text-forest-900 max-w-[85%] text-left">
                      {m.text}
                    </span>
                    <div className="text-[10px] text-forest-600 mt-1">{formatDateTime(m.at, 'Time unavailable')}</div>
                  </li>
                ))}
              </ul>
              <div ref={bottomRef} />
            </>
          )}
        </div>
        <div className="mt-4 flex gap-2" data-tour="message-composer">
          <input
            className="field flex-1"
            value={text}
            maxLength={MESSAGE_MAX}
            data-tour-field="message"
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message"
          />
          <button type="button" className="btn-primary text-xs" onClick={() => void send()}>
            Send
          </button>
        </div>
        <p className="mt-1 text-[11px] text-forest-700/60 text-right">
          {text.length}/{MESSAGE_MAX}
        </p>
        <ShareLocationBar sharing={sharing} />
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  )
}

/** Exported for tests and for the page that renders the composer. */
export { CHAT_PAGE_SIZE }
