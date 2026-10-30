import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookingDetailsDrawer } from '../components/chat/BookingDetailsDrawer'
import { ConversationHeader } from '../components/chat/ConversationHeader'
import { ConversationListItem } from '../components/chat/ConversationListItem'
import { LiveLocationStatus } from '../components/chat/LiveLocationStatus'
import { MessageComposer } from '../components/chat/MessageComposer'
import { QuickReplyActions, type QuickReplyOption } from '../components/chat/QuickReplyActions'
import { ShareLocationBar } from '../components/chat/ShareLocationBar'
import { MessageTimeline } from '../components/chat/MessageTimeline'
import { Alert, Container, EmptyState, Input, LoadingPanel, Page, PageHeader } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { canShareLocation, useLiveLocation } from '../hooks/useLiveLocation'
import {
  attachmentFailureMessage,
  uploadMessageAttachment,
  validateMessageImage,
  type PendingChatImage,
} from '../lib/chatAttachments'
import {
  ensureBookingConversation,
  fetchConversationSummaries,
  loadMessagePage,
  markConversationReadByGuest,
  mergeMessages,
  sendChatMessage,
  subscribeConversationMeta,
  subscribeMessages,
  type ChatMessage,
  type ConversationSummary,
  type MessageCursor,
} from '../lib/chatCloud'
import { retentionDaysLeft, retentionElapsed } from '../lib/chatRetention'
import { isFirebaseConfigured } from '../lib/firebase'
import { Clock, Lock, MessageCircle } from '../lib/icons'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { MESSAGE_MAX, validateMessage } from '../lib/validation'

export function MessagesPage() {
  const { user, profile } = useAuth()

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'inbox' | 'conversation'>('conversation')
  const [searchQuery, setSearchQuery] = useState('')

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
  const [locationDismissed, setLocationDismissed] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageRef = useRef<PendingChatImage | null>(null)
  const draftByConversation = useRef(new Map<string, { text: string; image: PendingChatImage | null; pendingSend: { fingerprint: string; id: string } | null }>())
  const currentConversationRef = useRef<string | null>(null)
  const pendingSendRef = useRef<{ fingerprint: string; id: string } | null>(null)

  useEffect(() => {
    pendingImageRef.current = pendingImage
  }, [pendingImage])

  // Revoke any dangling object URL when unmounting.
  useEffect(() => {
    return () => {
      if (pendingImageRef.current) URL.revokeObjectURL(pendingImageRef.current.previewUrl)
      for (const draft of draftByConversation.current.values()) {
        if (draft.image) URL.revokeObjectURL(draft.image.previewUrl)
      }
      draftByConversation.current.clear()
    }
  }, [])

  const profileFullName = useMemo(
    () => [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim(),
    [profile?.first_name, profile?.last_name],
  )

  // Load the Guest's unified booking conversation summaries (+ any legacy threads).
  useEffect(() => {
    if (!user?.uid) {
      setConversations([])
      setSelectedConvoId(null)
      setConvosState('ready')
      return
    }

    let cancelled = false
    setConvosState('loading')

    fetchConversationSummaries(user.uid, {
      email: user.email,
      guestName: profileFullName || user.displayName || 'Guest',
    })
      .then((list) => {
        if (cancelled) return
        setConversations(list)
        setSelectedConvoId((prev) => {
          if (prev && list.some((item) => item.conversationId === prev)) return prev
          return list[0]?.conversationId ?? null
        })
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

  const selectedConvo = useMemo(
    () => conversations.find((c) => c.conversationId === selectedConvoId) ?? conversations[0] ?? null,
    [conversations, selectedConvoId],
  )

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((item) => {
      const prop = (item.propertyName ?? '').toLowerCase()
      const ref = (item.bookingReference ?? '').toLowerCase()
      const name = item.guestName.toLowerCase()
      return prop.includes(q) || ref.includes(q) || name.includes(q)
    })
  }, [conversations, searchQuery])

  const activeConvoId = selectedConvo?.conversationId ?? null
  currentConversationRef.current = activeConvoId
  const activeBookingId = selectedConvo?.bookingId ?? null
  const activeGuestName = selectedConvo?.guestName ?? (profileFullName || user?.displayName || 'Guest')
  const activeBookingRef = selectedConvo?.bookingReference ?? null
  const activeAccommodationId = selectedConvo?.booking?.accommodation ?? null
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
        let resolvedConvoId = activeConvoId
        if (!activeIsLegacy && activeBookingId) {
          const ensured = await ensureBookingConversation({
            uid: user.uid,
            bookingId: activeBookingId,
            guestName: activeGuestName,
            bookingReference: activeBookingRef,
            accommodationId: activeAccommodationId,
          })
          resolvedConvoId = ensured.id
          if (!cancelled && ensured.retentionExpiresAt) {
            setConversations((prev) =>
              prev.map((item) =>
                item.conversationId === activeConvoId
                  ? { ...item, retentionExpiresAt: ensured.retentionExpiresAt }
                  : item,
              ),
            )
          }
        }

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
  }, [
    activeAccommodationId,
    activeBookingId,
    activeBookingRef,
    activeConvoId,
    activeGuestName,
    activeIsLegacy,
    retryKey,
    user?.uid,
  ])

  const conversationIds = useMemo(() => conversations.map((item) => item.conversationId).sort().join('\n'), [conversations])
  useEffect(() => {
    const ids = conversationIds ? conversationIds.split('\n').filter((id) => id !== activeConvoId) : []
    const unsubscribers = ids.map((id) => subscribeConversationMeta(id, (meta) => {
      setConversations((previous) => previous.map((item) => item.conversationId === id ? {
        ...item,
        unreadCount: meta.unreadGuest,
        unreadAdminCount: meta.unreadAdmin,
        adminLastReadAt: meta.adminLastReadAt,
        retentionExpiresAt: meta.retentionExpiresAt,
        latestMessageText: meta.lastMessage || item.latestMessageText,
        latestMessageAt: meta.updatedAtMs ?? item.latestMessageAt,
      } : item))
    }))
    return () => { unsubscribers.forEach((unsubscribe) => unsubscribe()) }
  }, [conversationIds, activeConvoId])

  const sharing = useLiveLocation({
    convoId: activeConvoId,
    uid: user?.uid,
  })

  // Re-surface the compact status bar whenever a fresh live-location session opens.
  useEffect(() => {
    if (sharing.session?.stream_secret) {
      setLocationDismissed(false)
    }
  }, [sharing.session?.stream_secret])

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

      const fingerprint = JSON.stringify([selectedConvo.conversationId, draftText.trim(), imageDraft?.id ?? null])
      if (pendingSendRef.current?.fingerprint !== fingerprint) {
        pendingSendRef.current = { fingerprint, id: imageDraft?.id ?? crypto.randomUUID() }
      }
      const messageId = pendingSendRef.current.id
      setComposerError(null)
      setSendStage(imageDraft ? 'uploading' : 'sending')

      try {
        let targetConvoId = selectedConvo.conversationId
        if (!selectedConvo.isLegacy && selectedConvo.bookingId) {
          const ensured = await ensureBookingConversation({
            uid: user.uid,
            bookingId: selectedConvo.bookingId,
            guestName: activeGuestName,
            bookingReference: selectedConvo.bookingReference,
            accommodationId: selectedConvo.booking?.accommodation ?? null,
          })
          targetConvoId = ensured.id
        }

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
    [activeGuestName, clearPendingImage, pendingImage, selectedConvo, sendStage, text, user?.uid],
  )

  const handleQuickReply = useCallback((reply: QuickReplyOption) => {
    setComposerError(null)
    setText(reply.text)
  }, [])

  const handleSelectConversation = useCallback((summary: ConversationSummary) => {
    if (sendStage !== 'idle') return
    if (activeConvoId !== summary.conversationId) {
      if (activeConvoId) draftByConversation.current.set(activeConvoId, { text, image: pendingImage, pendingSend: pendingSendRef.current })
      const draft = draftByConversation.current.get(summary.conversationId)
      draftByConversation.current.delete(summary.conversationId)
      setText(draft?.text ?? '')
      setPendingImage(draft?.image ?? null)
      pendingSendRef.current = draft?.pendingSend ?? null
      currentConversationRef.current = summary.conversationId
      setOlderError(null)
      setLoadingOlder(false)
    }
    setSelectedConvoId(summary.conversationId)
    setMobileView('conversation')
    setComposerError(null)
  }, [activeConvoId, pendingImage, sendStage, text])

  const hasMultipleThreads = conversations.length > 1
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

  return (
    <Page className="guest-ground">
      <Container width="content">
        <PageHeader
          eyebrow="Messages"
          title="Guest Messages"
          lead={
            <p>
              One continuous conversation per booking. Only you and the Hacienda Admin can read
              these messages.
            </p>
          }
          actions={
            conversations.length > 0 ? (
              <Link to="/mybookings" className="btn-quiet btn-sm">
                My reservations
              </Link>
            ) : undefined
          }
        />

        {convosState === 'loading' ? (
          <section className="guest-panel mt-8 p-10" aria-label="Loading conversations">
            <LoadingPanel label="Loading your stay conversations…" bare />
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
        ) : conversations.length === 0 ? (
          <section className="guest-panel mt-8 p-8 sm:p-12" aria-label="No conversations yet">
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              body="One continuous conversation per booking opens automatically as soon as you submit a stay request."
              actions={
                <>
                  <Link to="/book" className="btn-primary">
                    Book a stay
                  </Link>
                  <Link to="/contact" className="btn-ghost">
                    Official contact channels
                  </Link>
                </>
              }
            />
          </section>
        ) : (
          <section
            className="messages-workspace guest-panel"
            aria-label="Booking correspondence workspace"
          >
            {/* Left stay switcher rail (shown when Guest has 2+ stay threads) */}
            {hasMultipleThreads && (
              <aside
                aria-label="Your stays"
                className={`messages-topics ${
                  mobileView === 'inbox' ? 'messages-mobile-visible' : ''
                }`}
              >
                <div className="messages-topics-heading">
                  <h2>Your Stays</h2>
                  <p>Select a booking to view or continue its conversation.</p>
                  {conversations.length > 2 && (
                    <div className="mt-3">
                      <Input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search property or HDL ref…"
                        aria-label="Search stays by property or booking reference"
                      />
                    </div>
                  )}
                </div>

                <div className="messages-topic-list">
                  {filteredConversations.length === 0 ? (
                    <div className="p-5 text-center text-xs text-forest-600 dark:text-sage-400">
                      No stays matched &ldquo;{searchQuery.trim()}&rdquo;.
                    </div>
                  ) : (
                    filteredConversations.map((summary) => (
                      <ConversationListItem
                        key={summary.conversationId}
                        summary={summary}
                        selected={summary.conversationId === selectedConvo?.conversationId}
                        disabled={sendStage !== 'idle'}
                        onSelect={handleSelectConversation}
                      />
                    ))
                  )}
                </div>

                <div className="messages-privacy-note">
                  <Lock size={14} />
                  <p>Messages and photos are private between your account and Hacienda Admin.</p>
                </div>
              </aside>
            )}

            {/* Main unified conversation pane */}
            {selectedConvo && (
              <div
                className={`messages-conversation ${
                  !hasMultipleThreads || mobileView === 'conversation'
                    ? 'messages-mobile-visible'
                    : ''
                }`}
              >
                <ConversationHeader
                  guestName={selectedConvo.guestName}
                  propertyName={selectedConvo.propertyName}
                  bookingReference={selectedConvo.bookingReference}
                  lastActiveAtMs={selectedConvo.latestMessageAt}
                  showBack={hasMultipleThreads}
                  onBack={() => setMobileView('inbox')}
                  detailsOpen={bookingDrawerOpen}
                  onToggleBookingDetails={() => setBookingDrawerOpen((open) => !open)}
                  liveLocationActive={sharing.phase === 'active' && Boolean(sharing.session)}
                  liveLocationCountdown={sharing.countdown}
                  liveLocationDismissed={locationDismissed}
                  onExpandLiveLocation={() => setLocationDismissed(false)}
                />

                {/* Compact active live-location bar (separates minimize vs Stop Sharing) */}
                <LiveLocationStatus
                  sharing={sharing}
                  dismissed={locationDismissed}
                  onDismiss={() => setLocationDismissed(true)}
                />

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

                <MessageComposer
                  value={text}
                  onChange={setText}
                  onSend={handleSend}
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
                  locationSlot={
                    locationAvailable && sharing.phase !== 'active' ? (
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
          booking={selectedConvo?.booking}
          fallbackPropertyName={selectedConvo?.propertyName}
          fallbackReference={selectedConvo?.bookingReference}
        />
      </Container>
    </Page>
  )
}
