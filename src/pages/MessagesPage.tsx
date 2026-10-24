import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { activeCategories } from '../lib/categories'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { useAuth } from '../hooks/useAuth'
import { ShareLocationBar } from '../components/chat/ShareLocationBar'
import { MessageAttachmentView } from '../components/chat/MessageAttachmentView'
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
import {
  attachmentFailureMessage,
  uploadMessageAttachment,
  validateMessageImage,
  type PendingChatImage,
} from '../lib/chatAttachments'
import { MESSAGE_MAX } from '../lib/validation'
import { formatDateTime, parseDate } from '../lib/formatDate'
import { Alert, Container, EmptyState, Input, LoadingPanel, Page, PageHeader, Spinner } from '../components/ui'
import {
  ArrowDown,
  ArrowRight,
  Calendar,
  Clock,
  Close,
  CreditCard,
  Key,
  Lock,
  MessageCircle,
  Navigation,
  Paperclip,
  Refresh,
} from '../lib/icons'

/** How many older messages one "Load earlier messages" press fetches. */
const OLDER_PAGE_SIZE = 30
const MESSAGE_GROUP_GAP_MS = 5 * 60_000

const TOPIC_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  booking: Calendar,
  'payment-help': CreditCard,
  access: Key,
}

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

function imageSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}

/**
 * Group only messages that read as one thought: the same sender, on the same
 * day, no more than five minutes apart. Day boundaries and sender changes stay
 * visible without printing a full timestamp under every bubble.
 */
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

export function MessagesPage() {
  const { user } = useAuth()
  const [category, setCategory] = useState('booking')
  const [mobileView, setMobileView] = useState<'topics' | 'conversation'>('conversation')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [sendPhase, setSendPhase] = useState<'idle' | 'uploading' | 'sending'>('idle')
  const [sendFailed, setSendFailed] = useState(false)
  const [attachment, setAttachment] = useState<PendingChatImage | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [convoId, setConvoId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<MessageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retention, setRetention] = useState<Date | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [atLatest, setAtLatest] = useState(true)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentRef = useRef<PendingChatImage | null>(null)
  const sending = sendPhase !== 'idle'

  const discardAttachment = useCallback(() => {
    const current = attachmentRef.current
    if (current) URL.revokeObjectURL(current.previewUrl)
    attachmentRef.current = null
    setAttachment(null)
  }, [])

  // Once the Guest has walked into the history, the cursor is theirs: the live
  // listener must not drag it back to the newest page, or "load earlier" would
  // fetch messages already on screen.
  const pagedBack = useRef(false)
  const stickToLatest = useRef(true)
  const olderScrollPosition = useRef<{ height: number; top: number } | null>(null)

  const inquiries = useMemo(() => activeCategories('inquiry'), [])
  const activeCategory = inquiries.find((item) => item.id === category) ?? inquiries[0]
  const sharing = useLiveLocation({ convoId, uid: user?.uid })
  const timeline = useMemo(() => buildTimeline(messages), [messages])

  const scrollToLatest = useCallback((smooth = false) => {
    const thread = threadRef.current
    if (!thread) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const top = thread.scrollHeight
    if (smooth && !reduceMotion && typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top, behavior: 'smooth' })
    } else {
      thread.scrollTop = top
    }
    stickToLatest.current = true
    setAtLatest(true)
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      setStatus('ready')
      setConvoId(null)
      return
    }
    let unsub = () => {}
    let cancelled = false
    setStatus('loading')
    setError(null)
    setLiveError(null)
    setConvoId(null)
    setRetention(null)
    setMessages([])
    setCursor(null)
    setHasMore(false)
    setAtLatest(true)
    pagedBack.current = false
    stickToLatest.current = true
    olderScrollPosition.current = null

    ensureConversation(user.uid, category)
      .then((conversation) => {
        if (cancelled) return
        setConvoId(conversation.id)
        setRetention(conversation.retentionExpiresAt)
        // One listener, bounded to the newest page: it is what makes a reply
        // appear. Older pages are fetched once, on request, and hold no listener.
        unsub = subscribeMessages(
          conversation.id,
          user.uid,
          (page) => {
            if (cancelled) return
            setMessages((current) => mergeMessages(current, page.messages))
            if (!pagedBack.current) {
              setCursor(page.cursor)
              setHasMore(page.hasMore)
            }
            setStatus('ready')
          },
          CHAT_PAGE_SIZE,
          () => {
            if (cancelled) return
            setLiveError('Live message updates stopped. Check your connection and try again.')
            setStatus((current) => (current === 'loading' ? 'error' : current))
          },
        )
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      unsub()
    }
  }, [user?.uid, category, retryKey])

  // Opening a thread and receiving a reply keep the latest message in view.
  // Loading an older page instead preserves the exact reading position.
  useEffect(() => {
    const thread = threadRef.current
    if (!thread || status !== 'ready') return
    const previous = olderScrollPosition.current
    if (previous) {
      thread.scrollTop = thread.scrollHeight - previous.height + previous.top
      olderScrollPosition.current = null
      stickToLatest.current = false
      setAtLatest(false)
      return
    }
    if (stickToLatest.current) scrollToLatest()
  }, [messages, status, scrollToLatest])

  // A viewport resize changes both the thread's height and its wrapped content.
  // Capture the reading intent before the browser's resulting scroll event, then
  // restore the latest message after layout if the Guest was already there.
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      if (!stickToLatest.current) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => scrollToLatest())
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [scrollToLatest])

  useEffect(() => {
    return () => {
      if (attachmentRef.current) URL.revokeObjectURL(attachmentRef.current.previewUrl)
      attachmentRef.current = null
    }
  }, [])

  const loadOlder = useCallback(async () => {
    if (!convoId || !user?.uid || loadingOlder) return
    setLoadingOlder(true)
    setError(null)
    try {
      const page = await loadMessagePage({
        convoId,
        uid: user.uid,
        before: cursor,
        pageSize: OLDER_PAGE_SIZE,
      })
      const thread = threadRef.current
      olderScrollPosition.current = thread
        ? { height: thread.scrollHeight, top: thread.scrollTop }
        : null
      pagedBack.current = true
      stickToLatest.current = false
      setMessages((current) => mergeMessages(current, page.messages))
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch {
      setError('Could not load earlier messages. Check your connection and try again.')
    } finally {
      setLoadingOlder(false)
    }
  }, [convoId, cursor, loadingOlder, user?.uid])

  const chooseImage = (file: File | null) => {
    const validation = validateMessageImage(file)
    if (!validation.ok || !file) {
      setError(validation.ok ? 'Choose an image to attach.' : validation.message)
      setSendFailed(false)
      return
    }
    discardAttachment()
    const pending: PendingChatImage = {
      id: crypto.randomUUID(),
      file,
      contentType: validation.contentType,
      previewUrl: URL.createObjectURL(file),
    }
    attachmentRef.current = pending
    setAttachment(pending)
    setError(null)
    setSendFailed(false)
  }

  const send = async () => {
    if (!user?.uid) {
      setError('Sign in to message the Admin.')
      return
    }
    const draft = attachmentRef.current
    if (!convoId || status !== 'ready' || sending) return
    if (!text.trim() && !draft) return
    if (text.length > MESSAGE_MAX) {
      setError(`Message cannot exceed ${MESSAGE_MAX} characters.`)
      return
    }
    setSendPhase(draft ? 'uploading' : 'sending')
    setSendFailed(false)
    setError(null)
    try {
      const rl = checkRateLimit(`chat:${user.uid}`, LIMITS.chat)
      if (!rl.ok) {
        setError(rl.message)
        return
      }
      const uploaded = draft
        ? await uploadMessageAttachment({
            convoId,
            messageId: draft.id,
            file: draft.file,
            contentType: draft.contentType,
          })
        : undefined
      if (draft) setSendPhase('sending')
      const result = await sendChatMessage({
        convoId,
        uid: user.uid,
        text,
        attachment: uploaded,
        messageId: draft?.id,
      })
      if (!result.ok) {
        setError(result.message)
        setSendFailed(Boolean(draft))
        return
      }
      setText('')
      discardAttachment()
      stickToLatest.current = true
      if (!isFirebaseConfigured) {
        setMessages((current) =>
          mergeMessages(current, [
            {
              id: result.id,
              text: text.trim(),
              at: new Date().toISOString(),
              mine: true,
              sender_uid: user.uid as string,
              attachment: uploaded,
            },
          ]),
        )
      }
    } catch (err) {
      setSendFailed(Boolean(draft))
      setError(
        draft
          ? attachmentFailureMessage(err)
          : err instanceof Error
            ? err.message
            : 'Message could not be sent. Please try again.',
      )
    } finally {
      setSendPhase('idle')
    }
  }

  const retentionDays = retentionDaysLeft(retention)
  const retentionSwept = retentionElapsed(retention)
  const canCompose = status === 'ready' && Boolean(convoId)

  return (
    <Page className="guest-ground">
      <Container width="content">
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
        />

        <section className="messages-workspace guest-panel" aria-label="Private conversations">
          <aside
            className={`messages-topics ${mobileView === 'topics' ? 'messages-mobile-visible' : ''}`}
            aria-label="Conversation navigation"
          >
            <div className="messages-topics-heading">
              <h2>Conversation topics</h2>
              <p>Keep each question with the part of your stay it concerns.</p>
            </div>
            <nav className="messages-topic-list" aria-label="Conversation topics">
              {inquiries.map((item) => {
                const Icon = TOPIC_ICONS[item.id] ?? MessageCircle
                const active = item.id === category
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="messages-topic"
                    data-active={active}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (item.id !== category) {
                        discardAttachment()
                        setSendFailed(false)
                        setError(null)
                      }
                      setCategory(item.id)
                      setMobileView('conversation')
                    }}
                  >
                    <span className="messages-topic-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="messages-topic-name">{item.name}</span>
                      <span className="messages-topic-description">{item.description}</span>
                    </span>
                  </button>
                )
              })}
            </nav>
            <div className="messages-privacy-note">
              <Lock size={15} aria-hidden="true" />
              <p>Only you and the Admin can read these conversations.</p>
            </div>
          </aside>

          <div
            className={`messages-conversation ${mobileView === 'conversation' ? 'messages-mobile-visible' : ''}`}
          >
            <header className="messages-conversation-header">
              <button
                type="button"
                className="messages-back"
                onClick={() => setMobileView('topics')}
                aria-label="Back to conversation topics"
              >
                <ArrowRight size={18} className="rotate-180" />
                <span>Topics</span>
              </button>
              <div className="messages-admin-mark" aria-hidden="true">
                <MessageCircle size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2>Hacienda Admin</h2>
                <p>{activeCategory?.name ?? 'Conversation'}</p>
              </div>
              <span className="messages-private">
                <Lock size={13} />
                Private
              </span>
            </header>

            {retention && (
              <div className="messages-retention">
                <Clock size={14} aria-hidden="true" />
                <p>
                  {retentionSwept
                    ? 'This thread is scheduled to be cleared after its retention period.'
                    : `This thread is kept for ${retentionDays} more day${retentionDays === 1 ? '' : 's'} after its booking closed, then cleared automatically.`}
                </p>
              </div>
            )}

            <div className="messages-thread-wrap">
              <div
                ref={threadRef}
                className="messages-thread"
                onScroll={(event) => {
                  const element = event.currentTarget
                  const nearLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 96
                  stickToLatest.current = nearLatest
                  setAtLatest(nearLatest)
                }}
              >
                {status === 'loading' && (
                  <div className="messages-thread-state">
                    <LoadingPanel label="Loading conversation…" bare />
                  </div>
                )}

                {status === 'error' && (
                  <div className="messages-thread-state px-2">
                    <Alert
                      tone="danger"
                      className="w-full max-w-md text-xs"
                      title="Conversation unavailable."
                      actions={
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          onClick={() => setRetryKey((current) => current + 1)}
                        >
                          Try again
                        </button>
                      }
                    >
                      Check your connection, then try opening this topic again.
                    </Alert>
                  </div>
                )}

                {status === 'ready' && messages.length === 0 && (
                  <div className="messages-thread-state">
                    <EmptyState
                      compact
                      icon={MessageCircle}
                      title="Start the conversation"
                      body={`Ask about ${activeCategory?.name.toLowerCase() ?? 'your stay'}. The Admin’s reply will appear here.`}
                      className="messages-empty"
                    />
                  </div>
                )}

                {status === 'ready' && messages.length > 0 && (
                  <>
                    {hasMore && (
                      <div className="mb-5 flex justify-center">
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          disabled={loadingOlder}
                          onClick={() => void loadOlder()}
                          data-tour="load-older"
                          aria-controls="message-timeline"
                          aria-busy={loadingOlder}
                        >
                          {loadingOlder && <Spinner size={13} />}
                          {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                        </button>
                      </div>
                    )}
                    <div
                      id="message-timeline"
                      role="log"
                      aria-live="polite"
                      aria-relevant="additions"
                      aria-label={`Messages with the Hacienda Admin about ${activeCategory?.name ?? 'your stay'}`}
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
                                <div
                                  key={group.id}
                                  className={`messages-group ${group.mine ? 'messages-group-mine' : ''}`}
                                >
                                  <span className="messages-sender">{group.mine ? 'You' : 'Hacienda Admin'}</span>
                                  <ul>
                                    {group.messages.map((message, index) => {
                                      const position =
                                        group.messages.length === 1
                                          ? 'single'
                                          : index === 0
                                            ? 'first'
                                            : index === group.messages.length - 1
                                              ? 'last'
                                              : 'middle'
                                      return (
                                        <li key={message.id} className={group.mine ? 'flex justify-end' : 'flex justify-start'}>
                                          <div
                                            className={`messages-bubble ${
                                              group.mine ? 'guest-bubble-mine' : 'guest-bubble-theirs'
                                            } ${message.attachment ? 'messages-bubble-has-attachment' : ''}`}
                                            data-position={position}
                                          >
                                            {message.attachment && (
                                              <MessageAttachmentView
                                                attachment={message.attachment}
                                                mine={group.mine}
                                                caption={message.text || undefined}
                                              />
                                            )}
                                            {message.text && <span className="messages-message-text">{message.text}</span>}
                                          </div>
                                          <time className="sr-only" dateTime={message.at}>
                                            {formatDateTime(message.at, 'Time unavailable')}
                                          </time>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                  <time
                                    className="messages-time guest-num"
                                    dateTime={last.at}
                                    title={formatDateTime(last.at, 'Time unavailable')}
                                  >
                                    {messageTime(last.at)}
                                  </time>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {!atLatest && status === 'ready' && messages.length > 0 && (
                <button type="button" className="messages-latest" onClick={() => scrollToLatest(true)}>
                  Latest messages
                  <ArrowDown size={15} />
                </button>
              )}
            </div>

            <footer className="messages-composer">
              {liveError && (
                <Alert
                  tone="warning"
                  className="mb-3 text-xs"
                  actions={
                    <button
                      type="button"
                      className="btn-quiet btn-sm"
                      onClick={() => setRetryKey((current) => current + 1)}
                    >
                      Reconnect
                    </button>
                  }
                >
                  {liveError}
                </Alert>
              )}
              {error && (
                <Alert
                  tone="danger"
                  className="mb-3 text-xs"
                  actions={
                    sendFailed ? (
                      <button type="button" className="btn-quiet btn-sm" disabled={sending} onClick={() => void send()}>
                        <Refresh size={14} />
                        Retry send
                      </button>
                    ) : undefined
                  }
                >
                  {error}
                </Alert>
              )}
              <form
                data-tour="message-composer"
                aria-label="Send a message"
                aria-busy={sending}
                onSubmit={(event) => {
                  event.preventDefault()
                  void send()
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  aria-label="Choose an image attachment"
                  disabled={!canCompose || sending}
                  onChange={(event) => {
                    chooseImage(event.target.files?.[0] ?? null)
                    event.target.value = ''
                  }}
                />
                {attachment && (
                  <div className="messages-attachment-preview" data-testid="attachment-preview">
                    <img src={attachment.previewUrl} alt="Selected attachment preview" />
                    <div className="min-w-0 flex-1">
                      <strong>{attachment.file.name}</strong>
                      <span>
                        {imageSize(attachment.file.size)} · {sendPhase === 'uploading' ? 'Uploading privately…' : sendPhase === 'sending' ? 'Sending message…' : 'Ready to send'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="messages-attachment-remove"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending}
                      aria-label="Replace attached image"
                      title="Choose a different image"
                    >
                      <Refresh size={17} />
                    </button>
                    <button
                      type="button"
                      className="messages-attachment-remove"
                      onClick={() => {
                        discardAttachment()
                        setSendFailed(false)
                        setError(null)
                      }}
                      disabled={sending}
                      aria-label="Remove attached image"
                    >
                      <Close size={18} />
                    </button>
                  </div>
                )}
                <div className="messages-composer-row">
                  <button
                    type="button"
                    className="messages-attach"
                    disabled={!canCompose || sending}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={attachment ? 'Choose another image' : 'Attach image'}
                    title={`${attachment ? 'Replace' : 'Attach'} a JPEG, PNG, or WebP image (5 MB maximum)`}
                  >
                    <Paperclip size={19} />
                  </button>
                  <Input
                    className="min-w-0 flex-1"
                    aria-label="Write a message"
                    aria-describedby="message-composer-hint message-character-count"
                    value={text}
                    maxLength={MESSAGE_MAX}
                    disabled={!canCompose || sending}
                    data-tour-field="message"
                    onChange={(event) => {
                      setText(event.target.value.slice(0, MESSAGE_MAX))
                      if (error) setError(null)
                    }}
                    placeholder={canCompose ? (attachment ? 'Add a caption…' : 'Write a message…') : 'Waiting for the conversation…'}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!canCompose || sending || (!text.trim() && !attachment) || text.length > MESSAGE_MAX}
                    className="btn-primary messages-send"
                    aria-label={sendPhase === 'uploading' ? 'Uploading image' : sending ? 'Sending message' : 'Send message'}
                  >
                    {sending ? <Spinner size={17} /> : <Navigation size={17} />}
                    <span className="hidden sm:inline">
                      {sendPhase === 'uploading' ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
                    </span>
                  </button>
                </div>
                <div id="message-composer-hint" className="messages-composer-meta">
                  <span>{attachment ? 'JPEG, PNG, or WebP · 5 MB max' : 'Enter to send'}</span>
                  <span
                    id="message-character-count"
                    className={`font-mono tabular-nums ${
                      text.length >= MESSAGE_MAX
                        ? 'font-semibold text-amber-700 dark:text-brass-300'
                        : text.length >= MESSAGE_MAX * 0.9
                          ? 'text-amber-600 dark:text-amber-400'
                          : ''
                    }`}
                    aria-live="polite"
                  >
                    {text.length}/{MESSAGE_MAX} characters
                  </span>
                </div>
              </form>
              <ShareLocationBar sharing={sharing} />
              <span className="sr-only" role="status">
                {sending ? 'Sending message' : ''}
              </span>
            </footer>
          </div>
        </section>
      </Container>
    </Page>
  )
}

/** Exported for tests and for the page that renders the composer. */
export { CHAT_PAGE_SIZE }
