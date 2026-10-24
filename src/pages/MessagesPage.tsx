import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { useAuth } from '../hooks/useAuth'
import { useLiveLocation } from '../hooks/useLiveLocation'
import {
  CHAT_PAGE_SIZE,
  ensureBookingConversation,
  fetchConversationSummaries,
  loadMessagePage,
  mergeMessages,
  sendChatMessage,
  subscribeMessages,
  type ChatMessage,
  type ConversationSummary,
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
import { parseDate } from '../lib/formatDate'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { Alert, Container, EmptyState, LoadingPanel, Page, PageHeader, Spinner } from '../components/ui'
import { ArrowDown, Close, Lock, MessageCircle, Paperclip, Refresh } from '../lib/icons'
import { GuestAvatar } from '../components/chat/GuestAvatar'
import { ConversationListItem } from '../components/chat/ConversationListItem'
import { ConversationHeader } from '../components/chat/ConversationHeader'
import { BookingDetailsDrawer } from '../components/chat/BookingDetailsDrawer'
import { TypingIndicator } from '../components/chat/TypingIndicator'
import { LiveLocationStatus } from '../components/chat/LiveLocationStatus'
import { QuickReplyActions, QUICK_REPLIES } from '../components/chat/QuickReplyActions'
import { MessageComposer } from '../components/chat/MessageComposer'
import { MessageTimeline } from '../components/chat/MessageTimeline'

const OLDER_PAGE_SIZE = 30
const TYPING_EXPIRY_MS = 5_000

export function MessagesPage() {
  const { user } = useAuth()
  const [mobileView, setMobileView] = useState<'inbox' | 'conversation'>('inbox')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [sendPhase, setSendPhase] = useState<'idle' | 'uploading' | 'sending'>('idle')
  const [sendFailed, setSendFailed] = useState(false)
  const [attachment, setAttachment] = useState<PendingChatImage | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [cursor, setCursor] = useState<MessageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedConvo, setSelectedConvo] = useState<ConversationSummary | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [convosLoading, setConvosLoading] = useState(false)
  const [retention, setRetention] = useState<Date | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [atLatest, setAtLatest] = useState(true)
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const [typingTimeout, setTypingTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)

  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentRef = useRef<PendingChatImage | null>(null)
  const sending = sendPhase !== 'idle'
  const canCompose = status === 'ready' && Boolean(selectedConvo)

  const pagedBack = useRef(false)
  const stickToLatest = useRef(true)
  const olderScrollPosition = useRef<{ height: number; top: number } | null>(null)

  const sharing = useLiveLocation({
    convoId: selectedConvo?.conversationId ?? null,
    uid: user?.uid,
  })

  const latestMessageAt = useMemo(() => {
    if (messages.length === 0) return null
    return Math.max(...messages.map((m) => Date.parse(m.at)))
  }, [messages])

  // --- Inbox: load bookings and build the unified conversation list ---

  useEffect(() => {
    if (!user?.uid) {
      setConversations([])
      setConvosLoading(false)
      setSelectedConvo(null)
      return
    }

    let cancelled = false
    setConvosLoading(true)

    cloudBookingsDB.listMine(user.uid).then((bookings) => {
      if (cancelled) return

      const ensurePromises = bookings.map((booking) =>
        ensureBookingConversation({
          uid: user.uid,
          bookingId: booking.id,
          guestName: booking.guest_name || 'Guest',
          bookingReference: booking.ref_id || null,
          accommodationId: booking.accommodation || null,
        }),
      )

      Promise.all(ensurePromises).then(() => {
        if (cancelled) return
        return fetchConversationSummaries(user.uid)
      }).then((summaries) => {
        if (cancelled) return
        setConversations(summaries)
        setConvosLoading(false)
      }).catch(() => {
        if (!cancelled) setConvosLoading(false)
      })
    }).catch(() => {
      if (!cancelled) setConvosLoading(false)
    })

    return () => { cancelled = true }
  }, [user?.uid])

  // --- Conversation: open the selected thread ---

  useEffect(() => {
    if (!user?.uid || !selectedConvo?.conversationId) {
      setStatus('ready')
      setMessages([])
      setCursor(null)
      setHasMore(false)
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)
    setLiveError(null)
    setMessages([])
    setCursor(null)
    setHasMore(false)
    setRetention(null)
    setAtLatest(true)
    pagedBack.current = false
    stickToLatest.current = true
    olderScrollPosition.current = null

    ensureBookingConversation({
      uid: user.uid,
      bookingId: selectedConvo.bookingId ?? '',
      guestName: selectedConvo.guestName,
      bookingReference: selectedConvo.bookingReference,
      accommodationId: null,
    }).then((convo) => {
      if (cancelled) return
      const unsub = subscribeMessages(
        convo.id,
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
        (err) => {
          if (cancelled) return
          setLiveError('Live message updates stopped. Check your connection and try again.')
          setStatus((current) => current === 'loading' ? 'error' : current)
        },
      )
      return () => {
        cancelled = true
        unsub()
      }
    }).catch(() => {
      if (!cancelled) setStatus('error')
    })

    return () => {
      cancelled = true
    }
  }, [selectedConvo?.conversationId, user?.uid])

  // --- Scroll to latest when messages arrive ---

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
    if (stickToLatest.current) {
      thread.scrollTop = thread.scrollHeight
    }
  }, [messages, status])

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

  const loadOlder = useCallback(async () => {
    if (!selectedConvo?.conversationId || !user?.uid || loadingOlder) return
    setLoadingOlder(true)
    setError(null)
    try {
      const page = await loadMessagePage({
        convoId: selectedConvo.conversationId,
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
  }, [selectedConvo?.conversationId, cursor, loadingOlder, user?.uid])

  const discardAttachment = useCallback(() => {
    const current = attachmentRef.current
    if (current) URL.revokeObjectURL(current.previewUrl)
    attachmentRef.current = null
    setAttachment(null)
  }, [])

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
    if (!user?.uid || !selectedConvo?.conversationId) {
      setError('Sign in to message the Admin.')
      return
    }
    const draft = attachmentRef.current
    if (sending) return
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
            convoId: selectedConvo.conversationId,
            messageId: draft.id,
            file: draft.file,
            contentType: draft.contentType,
          })
        : undefined
      if (draft) setSendPhase('sending')
      const result = await sendChatMessage({
        convoId: selectedConvo.conversationId,
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
      setTypingUsers((prev) => new Set([...prev].filter((id) => id !== user.uid)))
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

  const startTyping = useCallback(() => {
    if (!user?.uid || !selectedConvo?.conversationId) return
    if (typingTimeout) clearTimeout(typingTimeout)
    setTypingUsers((prev) => new Set([...prev, user.uid]))
    setTypingTimeout(setTimeout(() => {
      setTypingUsers((prev) => new Set([...prev].filter((id) => id !== user.uid)))
    }, TYPING_EXPIRY_MS))
  }, [user?.uid, selectedConvo?.conversationId, typingTimeout])

  const handleQuickReply = useCallback((reply: typeof QUICK_REPLIES[number]) => {
    if (reply.sendImmediately) {
      setText(reply.text)
      void send()
    } else {
      setText(reply.text)
    }
  }, [send])

  const retentionDays = retentionDaysLeft(retention)
  const retentionSwept = retentionElapsed(retention)

  return (
    <Page className="guest-ground">
      <Container width="content">
        <PageHeader
          eyebrow="Messages"
          title={
            mobileView === 'conversation' && selectedConvo
              ? selectedConvo.guestName
              : 'Guest Messages'
          }
          lead={
            <p>
              One continuous conversation per booking. Only you and the Admin can read these messages.
            </p>
          }
        />

        {/* Inbox view */}
        {mobileView === 'inbox' && (
          <section className="messages-workspace guest-panel" aria-label="Guest conversations">
            {convosLoading && (
              <div className="messages-thread-state">
                <LoadingPanel label="Loading conversations…" bare />
              </div>
            )}

            {status === 'error' && (
              <div className="messages-thread-state px-2">
                <Alert
                  tone="danger"
                  className="w-full max-w-md text-xs"
                  title="Could not load conversations."
                  actions={
                    <button
                      type="button"
                      className="btn-quiet btn-sm"
                      onClick={() => setRetryKey((c) => c + 1)}
                    >
                      Try again
                    </button>
                  }
                >
                  Check your connection, then try opening your messages again.
                </Alert>
              </div>
            )}

            {conversations.length === 0 && !convosLoading && status !== 'error' && (
              <div className="messages-thread-state">
                <EmptyState
                  compact
                  icon={MessageCircle}
                  title="No conversations yet"
                  body="When you message the Admin about a booking, the thread appears here. Each booking has one continuous conversation."
                  className="messages-empty"
                />
              </div>
            )}

            {conversations.length > 0 && !convosLoading && (
              <div className="space-y-2" role="list" aria-label="Conversation list">
                {conversations.map((summary) => (
                  <ConversationListItem
                    key={summary.conversationId}
                    summary={summary}
                    active={Boolean(selectedConvo && selectedConvo.conversationId === summary.conversationId)}
                    onSelect={setSelectedConvo}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Conversation view */}
        {mobileView === 'conversation' && selectedConvo && (
          <section className="messages-conversation guest-panel" aria-label="Conversation">
            <ConversationHeader
              guestName={selectedConvo.guestName}
              propertyName={selectedConvo.propertyName}
              bookingReference={selectedConvo.bookingReference}
              status={null}
              isAdmin={false}
              onBack={() => setMobileView('inbox')}
              onCall={() => {
                if (typeof window !== 'undefined') {
                  void window.location.assign('tel:+639258507707')
                }
              }}
              onToggleBookingDetails={() => setBookingDetailsOpen((prev) => !prev)}
              bookingDetailsOpen={bookingDetailsOpen}
            />

            {retention && (
              <div className="messages-retention px-4 py-2 text-xs text-forest-500 border-b border-card-surface">
                <span className="flex items-center gap-1">
                  <Lock size={14} aria-hidden="true" />
                  {retentionSwept
                    ? 'This thread is scheduled to be cleared after its retention period.'
                    : `This thread is kept for ${retentionDays} more day${retentionDays === 1 ? '' : 's'} after its booking closed.`}
                </span>
              </div>
            )}

            <div className="flex flex-col h-[calc(100vh-14rem)]">
              <div className="flex-1 overflow-y-auto relative min-h-0">
                <div ref={threadRef} className="messages-thread px-4 pb-4 pt-2">
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
                        Check your connection, then try opening this conversation again.
                      </Alert>
                    </div>
                  )}

                  {status === 'ready' && messages.length === 0 && (
                    <div className="messages-thread-state">
                      <EmptyState
                        compact
                        icon={MessageCircle}
                        title="Start the conversation"
                        body={`Ask about ${selectedConvo.propertyName ?? 'your stay'}. The Admin's reply will appear here.`}
                        className="messages-empty"
                      />
                    </div>
                  )}

                  {status === 'ready' && messages.length > 0 && (
                    <MessageTimeline
                      messages={messages}
                      hasMore={hasMore}
                      loadingOlder={loadingOlder}
                      onLoadOlder={loadOlder}
                      onScrollToLatest={scrollToLatest}
                      atLatest={atLatest}
                      typingUsers={typingUsers}
                      isAdmin={false}
                      ariaLabel={`Messages with the Hacienda Admin about ${selectedConvo.guestName ?? 'your stay'}`}
                      emptyTitle="Start the conversation"
                      emptyBody={`Ask about ${selectedConvo.propertyName ?? 'your stay'}. The Admin's reply will appear here.`}
                    />
                  )}

                  {!atLatest && status === 'ready' && messages.length > 0 && (
                    <button type="button" className="messages-latest absolute bottom-[calc(7rem+2px)] left-4 z-10" onClick={() => scrollToLatest(true)}>
                      Latest messages
                      <ArrowDown size={15} />
                    </button>
                  )}
                </div>
              </div>

              {/* Compact live location status (only when actively sharing) */}
              {sharing.phase === 'active' && sharing.session && (
                <LiveLocationStatus
                  active={true}
                  etaMinutes={null}
                  dismissed={false}
                  onDismiss={() => {
                    // Dismissal only hides the chip; sharing continues.
                  }}
                  onStop={async () => {
                    await sharing.stop()
                  }}
                />
              )}

              {/* Quick reply chips */}
              <QuickReplyActions
                onSelect={handleQuickReply}
                disabled={!canCompose || sending}
              />

              {/* Message composer */}
              <MessageComposer
                disabled={!canCompose || sending}
                sending={sending}
                value={text}
                onChange={(value) => {
                  setText(value)
                  if (error) setError(null)
                  void startTyping()
                }}
                onSend={send}
                onAttach={() => fileInputRef.current?.click()}
                attachment={attachment
                  ? {
                      name: attachment.file.name,
                      size: attachment.file.size,
                      previewUrl: attachment.previewUrl,
                    }
                  : null}
                onRemoveAttachment={discardAttachment}
                sendError={sendFailed ? error : null}
                onRetry={() => void send()}
              />

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

              {liveError && (
                <Alert
                  tone="warning"
                  className="mx-4 mb-2 text-xs"
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
                  className="mx-4 mb-2 text-xs"
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
            </div>
          </section>
        )}

        {bookingDetailsOpen && selectedConvo && (
          <BookingDetailsDrawer
            open={bookingDetailsOpen}
            onClose={() => setBookingDetailsOpen(false)}
            booking={null}
          />
        )}
      </Container>
    </Page>
  )
}

export { CHAT_PAGE_SIZE }
