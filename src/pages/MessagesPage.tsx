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
  ensureBookingConversation,
  ensureGuestConversation,
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
import { Calendar, Clock, Phone } from '../lib/icons'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { MESSAGE_MAX, validateMessage } from '../lib/validation'

export function MessagesPage() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const bookingId = params.get('booking')?.trim() || null
  // Reset listeners, drafts and location sessions when the selected booking or
  // signed-in account changes, including navigation within this same route.
  return <MessagesWorkspace key={JSON.stringify([user?.uid, bookingId])} bookingId={bookingId} />
}

function MessagesWorkspace({ bookingId }: { bookingId: string | null }) {
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

  // General messages use a stable Guest-owned thread. Booking links still open
  // their existing threads so past messages and attachments are not lost.
  useEffect(() => {
    if (!user?.uid) {
      setConversations([])
      setConvosState('ready')
      return
    }

    let cancelled = false
    setConvosState('loading')

    const name = profileFullName || user.displayName || 'Guest'
    const load = bookingId
      ? fetchConversationSummaries(user.uid, { email: user.email, guestName: name })
      : ensureGuestConversation(user.uid, name).then((conversation): ConversationSummary[] => [{
          conversationId: conversation.id,
          guestId: user.uid,
          bookingId: null,
          guestName: name,
          bookingReference: null,
          propertyName: null,
          latestMessageText: null,
          latestMessageAt: null,
          unreadCount: 0,
          unreadAdminCount: 0,
          adminLastReadAt: null,
          retentionExpiresAt: conversation.retentionExpiresAt,
          isLegacy: false,
          booking: null,
        }])
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
  }, [bookingId, profileFullName, retryKey, user?.displayName, user?.email, user?.uid])

  // Resolve either the Guest-wide thread or the explicitly selected Booking.
  // Never substitute another Booking or a legacy inquiry.
  const selectedConvo = useMemo(() => {
    if (!bookingId) return conversations.find((item) => item.bookingId === null) ?? null
    const matches = conversations.filter((item) => !item.isLegacy && item.bookingId === bookingId && item.booking?.uid === user?.uid)
    return matches.length === 1 ? matches[0] : null
  }, [bookingId, conversations, user?.uid])

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
              {selectedConvo?.bookingId && (
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
          booking={selectedConvo?.booking}
          fallbackPropertyName={selectedConvo?.propertyName}
          fallbackReference={selectedConvo?.bookingReference}
        />
      </Container>
    </Page>
  )
}
