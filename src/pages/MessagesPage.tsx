import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LiveLocationStatus } from '../components/chat/LiveLocationStatus'
import { BookingDetailsDrawer } from '../components/chat/BookingDetailsDrawer'
import { MessageComposer } from '../components/chat/MessageComposer'
import { QuickReplyActions, type QuickReplyOption } from '../components/chat/QuickReplyActions'
import { ShareLocationBar } from '../components/chat/ShareLocationBar'
import { MessageTimeline } from '../components/chat/MessageTimeline'
import { EmailVerificationNotice } from '../components/Auth/EmailVerificationNotice'
import { Alert, Container, EmptyState, LoadingPanel, Page, PageHeader } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { canShareLocation, useLiveLocation } from '../hooks/useLiveLocation'
import {
  attachmentFailureMessage,
  uploadMessageAttachment,
  validateMessageImage,
  type PendingChatImage,
} from '../lib/chatAttachments'
import {
  ensureGuestConversation,
  fetchConversationSummaries,
  loadMessagePage,
  markConversationReadByGuest,
  mergeMessages,
  sanitizeBookingReference,
  sendChatMessage,
  subscribeConversationMeta,
  subscribeMessages,
  type ChatMessage,
  type ConversationSummary,
  type MessageCursor,
} from '../lib/chatCloud'
import { retentionDaysLeft, retentionElapsed } from '../lib/chatRetention'
import { isFirebaseConfigured } from '../lib/firebase'
import { Calendar, Clock, Phone } from '../lib/icons'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { MESSAGE_MAX, validateMessage } from '../lib/validation'

export function MessagesPage() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  // `booking` is what a message is ABOUT — context, never the identity of the
  // thread. `thread` opens a superseded thread read-only, so history filed
  // before the unification stays reachable.
  const bookingId = params.get('booking')?.trim() || null
  const threadId = params.get('thread')?.trim() || null
  // Reset listeners and drafts when the signed-in account or the opened thread
  // changes. Switching the filing Booking is deliberately NOT a remount: it is
  // the same conversation, and remounting would throw away the draft and
  // re-subscribe for no reason.
  return (
    <MessagesWorkspace
      key={JSON.stringify([user?.uid, threadId])}
      bookingId={bookingId}
      threadId={threadId}
    />
  )
}

function MessagesWorkspace({ bookingId, threadId }: { bookingId: string | null; threadId: string | null }) {
  const { user, profile } = useAuth()

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [convosState, setConvosState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [cursor, setCursor] = useState<MessageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [pendingImage, setPendingImage] = useState<PendingChatImage | null>(null)
  const [sendStage, setSendStage] = useState<'idle' | 'uploading' | 'sending'>('idle')
  const [composerError, setComposerError] = useState<string | null>(null)

  const [bookingDrawerOpen, setBookingDrawerOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageRef = useRef<PendingChatImage | null>(null)
  const currentConversationRef = useRef<string | null>(null)
  const pendingSendRef = useRef<{ fingerprint: string; id: string } | null>(null)

  useEffect(() => {
    pendingImageRef.current = pendingImage
  }, [pendingImage])

  // Revoke any dangling object URL when unmounting.
  useEffect(() => {
    return () => {
      if (pendingImageRef.current) URL.revokeObjectURL(pendingImageRef.current.previewUrl)
    }
  }, [])

  const profileFullName = useMemo(
    () => [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim(),
    [profile?.first_name, profile?.last_name],
  )

  // One conversation per account. The account thread is created on first open
  // (idempotently — derived id, in a transaction) and the list afterwards also
  // carries any superseded threads whose history has not been merged yet.
  useEffect(() => {
    if (!user?.uid) {
      setConversations([])
      setConvosState('ready')
      return
    }

    let cancelled = false
    setConvosState('loading')

    const name = profileFullName || user.displayName || 'Guest'
    const load = ensureGuestConversation(user.uid, name)
      .then(() => fetchConversationSummaries(user.uid, { email: user.email, guestName: name }))
      .catch(() => fetchConversationSummaries(user.uid, { email: user.email, guestName: name }))

    load
      .then((list) => {
        if (cancelled) return
        setConversations(list)
        setConvosState('ready')
      })
      .catch((err) => {
        console.error('[Chat] could not load conversations', err)
        if (!cancelled) setConvosState('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileFullName, retryKey, user?.displayName, user?.email, user?.uid])

  // The thread is the account's one conversation. `?thread=` opens a superseded
  // one for reading; nothing here will ever create a second thread.
  const selectedConvo = useMemo(() => {
    if (threadId) {
      return conversations.find((item) => item.conversationId === threadId && item.guestId === user?.uid) ?? null
    }
    return conversations.find((item) => item.isCanonical) ?? null
  }, [conversations, threadId, user?.uid])

  // The Booking a new message will be filed against — context, and always one
  // of this account's own bookings. An id that is not theirs is dropped rather
  // than trusted, so a hand-edited URL cannot tag a message with a stranger's
  // reservation.
  const contextBooking = useMemo(() => {
    if (!selectedConvo || selectedConvo.isLegacy || !bookingId) return null
    return (
      selectedConvo.linkedBookings.find(
        (booking) => booking.id === bookingId && (booking.uid === user?.uid || !booking.uid),
      ) ?? null
    )
  }, [bookingId, selectedConvo, user?.uid])

  const activeConvoId = selectedConvo?.conversationId ?? null
  currentConversationRef.current = activeConvoId
  const activeBookingId = contextBooking?.id ?? null
  const activeGuestName = selectedConvo?.guestName ?? (profileFullName || user?.displayName || 'Guest')
  const activeBookingRef = contextBooking?.ref_id
    ? sanitizeBookingReference(contextBooking.ref_id)
    : null
  const activeAccommodationId = contextBooking?.accommodation ?? null
  const activeIsLegacy = selectedConvo?.isLegacy ?? false

  // Ensure the active booking's conversation doc exists and subscribe to its
  // newest message page + live read/retention metadata, tearing down cleanly.
  useEffect(() => {
    if (!user?.uid || !activeConvoId) {
      setMessages([])
      setCursor(null)
      setHasMore(false)
      setThreadState('idle')
      return
    }

    let cancelled = false
    let unsubMessages: (() => void) | null = null
    let unsubMeta: (() => void) | null = null

    setMessages([])
    setCursor(null)
    setHasMore(false)
    setLoadingOlder(false)
    setOlderError(null)
    setComposerError(null)
    setThreadState('loading')

    const openAndSubscribe = async () => {
      try {
        // The thread already exists and its id is derived from the account, so
        // there is nothing to resolve and nothing to race: subscribe to it.
        const resolvedConvoId = activeConvoId

        if (cancelled) return

        void markConversationReadByGuest(resolvedConvoId)

        let firstDelivery = true
        unsubMessages = subscribeMessages(
          resolvedConvoId,
          user.uid,
          (page) => {
            if (cancelled) return
            setMessages((prev) => mergeMessages(prev, page.messages))
            if (firstDelivery) {
              firstDelivery = false
              setCursor(page.cursor)
              setHasMore(page.hasMore)
            }
            const newest = page.messages[page.messages.length - 1]
            if (newest) {
              setConversations((prev) =>
                prev.map((item) =>
                  item.conversationId === activeConvoId
                    ? {
                        ...item,
                        latestMessageText:
                          newest.text || (newest.attachment ? 'Sent a photo' : item.latestMessageText),
                        latestMessageAt: Date.parse(newest.at) || item.latestMessageAt,
                        unreadCount: 0,
                      }
                    : item,
                ),
              )
            }
            setThreadState('ready')
          },
          undefined,
          () => {
            if (!cancelled) setThreadState('error')
          },
        )

        unsubMeta = subscribeConversationMeta(resolvedConvoId, (meta) => {
          if (cancelled) return
          if (meta.unreadGuest > 0) {
            void markConversationReadByGuest(resolvedConvoId)
          }
          setConversations((prev) =>
            prev.map((item) =>
              item.conversationId === activeConvoId
                ? {
                    ...item,
                    unreadCount: 0,
                    unreadAdminCount: meta.unreadAdmin,
                    adminLastReadAt: meta.adminLastReadAt,
                    retentionExpiresAt: meta.retentionExpiresAt,
                    latestMessageText: meta.lastMessage || item.latestMessageText,
                    latestMessageAt: meta.updatedAtMs ?? item.latestMessageAt,
                  }
                : item,
            ),
          )
        })
      } catch (err) {
        console.error('[Chat] failed to open conversation', err)
        if (!cancelled) setThreadState('error')
      }
    }

    void openAndSubscribe()

    return () => {
      cancelled = true
      unsubMessages?.()
      unsubMeta?.()
    }
  }, [activeConvoId, retryKey, user?.uid])

  const sharing = useLiveLocation({
    convoId: activeConvoId,
    uid: user?.uid,
  })

  const clearPendingImage = useCallback(() => {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }, [])

  const handleChooseFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return
      const validation = validateMessageImage(file)
      if (!validation.ok) {
        setComposerError(validation.message)
        return
      }
      setComposerError(null)
      const previewUrl = URL.createObjectURL(file)
      setPendingImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl)
        return {
          id: crypto.randomUUID(),
          file,
          contentType: validation.contentType,
          previewUrl,
        }
      })
    },
    [],
  )

  const handleLoadOlder = useCallback(async () => {
    if (!user?.uid || !activeConvoId || !hasMore || loadingOlder) return
    const requestConvoId = activeConvoId
    setLoadingOlder(true)
    setOlderError(null)
    try {
      const page = await loadMessagePage({
        convoId: activeConvoId,
        uid: user.uid,
        before: cursor,
      })
      if (currentConversationRef.current !== requestConvoId) return
      setMessages((prev) => mergeMessages(page.messages, prev))
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch {
      if (currentConversationRef.current === requestConvoId) setOlderError('Could not load earlier messages. Check your connection and try again.')
    } finally {
      if (currentConversationRef.current === requestConvoId) setLoadingOlder(false)
    }
  }, [activeConvoId, cursor, hasMore, loadingOlder, user?.uid])

  const handleSend = useCallback(
    async (rawInput?: string) => {
      if (!user?.uid || !selectedConvo || sendStage !== 'idle') return
      const draftText = typeof rawInput === 'string' ? rawInput : text
      const imageDraft = pendingImage

      if (!draftText.trim() && !imageDraft) return

      const messageCheck = imageDraft
        ? draftText.trim().length <= MESSAGE_MAX
          ? ({ ok: true } as const)
          : ({ ok: false, message: `Message must be at most ${MESSAGE_MAX} characters` } as const)
        : validateMessage(draftText)
      if (!messageCheck.ok) {
        setComposerError(messageCheck.message)
        return
      }

      const limited = checkRateLimit(`chat:${selectedConvo.conversationId}`, LIMITS.chat)
      if (!limited.ok) {
        setComposerError(limited.message)
        return
      }

      const fingerprint = JSON.stringify([selectedConvo.conversationId, draftText.trim(), imageDraft?.id ?? null, activeBookingId])
      if (pendingSendRef.current?.fingerprint !== fingerprint) {
        pendingSendRef.current = { fingerprint, id: imageDraft?.id ?? crypto.randomUUID() }
      }
      const messageId = pendingSendRef.current.id
      setComposerError(null)
      setSendStage(imageDraft ? 'uploading' : 'sending')

      try {
        // Always the account thread. A Booking travels with the message as
        // context; it never decides where the message is stored.
        const targetConvoId = selectedConvo.conversationId

        let uploadedAttachment
        if (imageDraft) {
          uploadedAttachment = await uploadMessageAttachment({
            convoId: targetConvoId,
            messageId: imageDraft.id,
            file: imageDraft.file,
            contentType: imageDraft.contentType,
          })
          setSendStage('sending')
        }

        const result = await sendChatMessage({
          convoId: targetConvoId,
          uid: user.uid,
          text: draftText,
          attachment: uploadedAttachment,
          messageId,
          bookingId: activeBookingId,
        })

        if (!result.ok) {
          setComposerError(result.message)
          return
        }

        pendingSendRef.current = null
        setText('')
        clearPendingImage()
      } catch (err) {
        setComposerError(
          imageDraft
            ? attachmentFailureMessage(err)
            : 'Your message could not be sent. Check your connection and retry.',
        )
      } finally {
        setSendStage('idle')
      }
    },
    [activeBookingId, activeGuestName, clearPendingImage, pendingImage, selectedConvo, sendStage, text, user?.uid],
  )

  const handleQuickReply = useCallback((reply: QuickReplyOption) => {
    setComposerError(null)
    setText(reply.text)
  }, [])

  // A superseded thread is history: readable, never written to. New messages
  // always belong to the account's one conversation.
  const readOnlyThread = activeIsLegacy
  const retentionStamp = selectedConvo?.retentionExpiresAt ?? null
  const retentionDays = retentionDaysLeft(retentionStamp)
  const retentionSwept = retentionElapsed(retentionStamp)
  const locationAvailable = canShareLocation(user?.uid)

  const sendStageLabel =
    sendStage === 'uploading'
      ? 'Uploading private image…'
      : sendStage === 'sending'
        ? 'Sending message…'
        : null

  // One thread, several stays: resolve a message's `booking_id` to the
  // reference a person actually recognises. A raw document id is never shown.
  const bookingReferenceFor = useCallback(
    (id: string): string | null => {
      const booking = selectedConvo?.linkedBookings.find((item) => item.id === id)
      return booking ? sanitizeBookingReference(booking.ref_id) : null
    },
    [selectedConvo],
  )

  return (
    <Page className="guest-ground messages-page">
      <Container width="content" className="messages-page-content">
        <EmailVerificationNotice className="mb-6" />
        <PageHeader
          className="messages-page-header"
          eyebrow=""
          title="Guest Messages"
          lead={<p>Private messages between you and the Hacienda Admin.</p>}
          actions={
            <>
              <Link to="/mybookings" className="btn-quiet btn-sm">My reservations</Link>
              <a href="tel:+639258507707" className="btn-ghost btn-sm">
                <Phone size={15} /> Call
              </a>
              {contextBooking && (
                <button type="button" className="btn-quiet btn-sm" aria-expanded={bookingDrawerOpen}
                  onClick={() => setBookingDrawerOpen((open) => !open)}>
                  <Calendar size={15} /> Booking details
                </button>
              )}
            </>
          }
        />

        {convosState === 'loading' ? (
          <section className="guest-panel mt-8 p-10" aria-label="Loading conversations">
            <LoadingPanel label="Opening your conversation…" bare />
          </section>
        ) : convosState === 'error' ? (
          <div className="mt-8">
            <Alert
              tone="danger"
              title="Could not load your conversations"
              actions={
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => setRetryKey((k) => k + 1)}
                >
                  Try again
                </button>
              }
            >
              Check your internet connection and try again. Your existing messages are safe.
            </Alert>
          </div>
        ) : !selectedConvo ? (
          <section className="guest-panel messages-selection" aria-label="Select a reservation">
            <EmptyState
              title={bookingId ? 'Reservation unavailable' : 'Select a reservation'}
              body={bookingId
                ? 'This reservation could not be found on your account. Choose one from My reservations.'
                : 'Choose a reservation to open its private conversation.'}
              actions={<Link to="/mybookings" className="btn-primary">My reservations</Link>}
            />
          </section>
        ) : (
          <section
            className="messages-workspace guest-panel"
            aria-label="Booking correspondence workspace"
          >
            {selectedConvo && (
              <div className="messages-conversation">
                {/* Retention banner when a completed/cancelled stay is in its 90-day window */}
                {retentionStamp && (
                  <div className="messages-retention" role="status">
                    <Clock size={14} />
                    <p>
                      {retentionSwept
                        ? 'This finished stay conversation has reached its retention limit and is scheduled to clear.'
                        : `Finished stay history is kept for ${retentionDays ?? 0} more ${
                            retentionDays === 1 ? 'day' : 'days'
                          }. Your reservation record in My Bookings is kept permanently.`}
                    </p>
                  </div>
                )}

                {olderError && (
                  <Alert tone="danger" className="mx-4 mt-3 text-xs" actions={<button type="button" className="btn-quiet btn-sm" onClick={() => void handleLoadOlder()}>Retry loading earlier messages</button>}>
                    {olderError}
                  </Alert>
                )}
                {threadState === 'error' ? (
                  <div className="messages-thread-wrap flex items-center justify-center p-6">
                    <Alert
                      tone="danger"
                      className="max-w-md text-xs"
                      title="Could not open this conversation"
                      actions={
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          onClick={() => setRetryKey((k) => k + 1)}
                        >
                          Retry
                        </button>
                      }
                    >
                      Check your connection and retry.
                    </Alert>
                  </div>
                ) : (
                  <MessageTimeline
                    messages={messages}
                    loading={threadState === 'loading'}
                    hasMore={hasMore}
                    loadingOlder={loadingOlder}
                    onLoadOlder={handleLoadOlder}
                    isLocalDemo={!isFirebaseConfigured || selectedConvo.conversationId.startsWith('local:')}
                    unreadAdminCount={selectedConvo.unreadAdminCount}
                    adminLastReadAt={selectedConvo.adminLastReadAt}
                    bookingReferenceFor={bookingReferenceFor}
                  />
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    handleChooseFile(file)
                  }}
                />

                {readOnlyThread ? (
                  <div className="messages-context-bar" role="status">
                    <span>
                      This is an earlier conversation, kept so your history stays readable. New
                      messages belong to your main conversation.
                    </span>
                    <Link to="/messages" className="btn-quiet btn-sm">
                      Open my conversation
                    </Link>
                  </div>
                ) : (
                  <div className="messages-context-bar">
                    {contextBooking ? (
                      <>
                        <span className="messages-context-chip">
                          <Calendar size={12} />
                          {activeBookingRef ? `About ${activeBookingRef}` : 'About your reservation'}
                        </span>
                        <span>
                          Filed under this reservation only — your conversation stays the same one.
                        </span>
                        <Link to="/messages" className="btn-quiet btn-sm">
                          General message
                        </Link>
                      </>
                    ) : (
                      <span>
                        One conversation for every reservation and any general question — pick a
                        reservation above to file a message under it.
                      </span>
                    )}
                  </div>
                )}

                <MessageComposer
                  value={text}
                  onChange={setText}
                  onSend={handleSend}
                  readOnly={readOnlyThread}
                  onAttach={() => fileInputRef.current?.click()}
                  attachment={
                    pendingImage
                      ? {
                          name: pendingImage.file.name,
                          size: pendingImage.file.size,
                          previewUrl: pendingImage.previewUrl,
                        }
                      : null
                  }
                  onRemoveAttachment={clearPendingImage}
                  disabled={threadState === 'loading' || threadState === 'error' || retentionSwept}
                  sending={sendStage !== 'idle'}
                  sendStageLabel={sendStageLabel}
                  error={composerError}
                  onRetry={() => void handleSend()}
                  quickRepliesSlot={
                    <QuickReplyActions
                      disabled={sendStage !== 'idle' || threadState !== 'ready' || retentionSwept}
                      onSelect={handleQuickReply}
                    />
                  }
                  locationStatusSlot={
                    <LiveLocationStatus sharing={sharing} />
                  }
                  locationSlot={
                    locationAvailable ? (
                      <ShareLocationBar sharing={sharing} />
                    ) : undefined
                  }
                />
              </div>
            )}
          </section>
        )}

        <BookingDetailsDrawer
          open={bookingDrawerOpen}
          onClose={() => setBookingDrawerOpen(false)}
          booking={contextBooking}
          fallbackPropertyName={null}
          fallbackReference={activeBookingRef}
        />
      </Container>
    </Page>
  )
}
