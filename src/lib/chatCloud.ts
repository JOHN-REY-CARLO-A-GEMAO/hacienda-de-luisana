// ----------------------------------------------------------------------------
// Conversations — the Guest ↔ Admin chat, page by page.
//
// One continuous conversation per booking (`booking-${bookingId}`), with full
// non-destructive backward compatibility for earlier `inquiry-${uid}-${topic}`
// threads so historical messages remain accessible.
//
// Three cost and security invariants hold everywhere here:
//   1. A thread is read a page at a time (`CHAT_PAGE_SIZE`, max 50).
//   2. Only one live listener runs for the open conversation's newest page,
//      and it is torn down on thread switch or unmount.
//   3. Messages are capped at 1,000 characters (`MESSAGE_MAX`), matching
//      `firestore.rules`.
//
// With no Firebase project configured, the same pagination and per-booking
// conversation lookup run locally against `hdl:chat` and `bookingsDB`.
// ----------------------------------------------------------------------------

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { ACCOMMODATIONS } from '../config/site'
import { activeCategories, isActiveCategory } from './categories'
import {
  attachmentDocument,
  messageAttachmentPath,
  parseChatAttachment,
  type ChatAttachment,
} from './chatAttachments'
import { db, isFirebaseConfigured } from './firebase'
import { dateToISOString, parseDate } from './formatDate'
import { bookingsDB, type Booking } from './storage'
import { validateMessage } from './validation'

export type { ChatAttachment } from './chatAttachments'

// ----------------------------------------------------------------------------
// Unified conversation types — one continuous thread per guest booking.
// ----------------------------------------------------------------------------

export type ConversationSummary = {
  /** Internal document id (`booking-${bookingId}`, `local:booking-${bookingId}`, or legacy `inquiry-*-*`). Never shown in UI. */
  conversationId: string
  /** Internal guest Firebase uid. Never shown in UI. */
  guestId: string
  /** Internal booking document id, or null for legacy/pre-stay threads. Never shown in UI. */
  bookingId: string | null
  /** Human-readable guest full name. */
  guestName: string
  /** Human-readable booking reference (`HDL-…`), or null when none is assigned yet. Never a raw document id. */
  bookingReference: string | null
  /** Human-readable property / villa / room name, or null. */
  propertyName: string | null
  latestMessageText: string | null
  latestMessageAt: number | null
  unreadCount: number
  unreadAdminCount: number
  adminLastReadAt: string | null
  retentionExpiresAt: Date | null
  /** True when this is an earlier topic-based thread (`inquiry-*-*`) preserved for history. */
  isLegacy: boolean
  /** Human-readable label for a legacy thread (never raw IDs). */
  legacyLabel?: string | null
  /** Linked booking record when available, used by the Booking Details drawer. */
  booking?: Booking | null
}

/** Derive a stable, booking-scoped conversation id from a booking document id. */
export function bookingConversationId(bookingId: string): string {
  return `booking-${bookingId}`
}

/** Is a conversation id the booking-scoped form? */
export function isBookingConversationId(convoId: string): boolean {
  return convoId.startsWith('booking-') || convoId.startsWith('local:booking-')
}

/** Is a conversation id a legacy topic-based form (`inquiry-*-*`)? */
export function isLegacyConversationId(convoId: string): boolean {
  return convoId.startsWith('inquiry-')
}

/** Clean human-readable booking reference (`HDL-…`), never a raw internal id. */
export function sanitizeBookingReference(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  if (/^HDL-[A-Z0-9-]+$/i.test(trimmed)) return trimmed.toUpperCase()
  return null
}

/** Resolve a human-readable property display name from an accommodation id or label. */
export function propertyNameFromAccommodation(accommodationId: string | null | undefined): string | null {
  const raw = (accommodationId ?? '').trim()
  if (!raw) return null
  const match = ACCOMMODATIONS.find((a) => a.id === raw || a.name.toLowerCase() === raw.toLowerCase())
  if (match) return match.name
  switch (raw.toLowerCase()) {
    case 'main-house':
      return 'The Main House'
    case 'annex':
      return 'HDL Annex'
    case 'house-a-camping':
    case 'a-house':
      return 'A-House'
    default:
      return null
  }
}

export type ChatMessage = {
  id: string
  /** Empty only when this message carries an image without a caption. */
  text: string
  /** ISO-8601 timestamp. */
  at: string
  mine: boolean
  sender_uid: string
  attachment?: ChatAttachment
  /** Optional local-storage conversation tag for demo multi-booking isolation. */
  convo_id?: string
}

export type MessageCursor = { at: string; id: string }

export type MessagePage = {
  /** Oldest first, chronological. */
  messages: ChatMessage[]
  /** Cursor for the page before this one; null when at the beginning. */
  cursor: MessageCursor | null
  /** True when older messages exist before `cursor`. */
  hasMore: boolean
}

export const CHAT_PAGE_SIZE = 40
export const CHAT_MAX_PAGE_SIZE = 50

export function conversationDocId(uid: string, category: string): string {
  return `inquiry-${uid}-${category}`
}

export const CHAT_PREVIEW_CHARS = 140

export const BOOKING_CONVO_CREATE_FIELDS = [
  'booking_id',
  'guest_uid',
  'guest_name',
  'booking_reference',
  'property_name',
  'category',
  'created_at',
  'updated_at',
  'last_message',
  'unread_admin',
  'unread_guest',
] as const

const LOCAL_KEY = 'hdl:chat'
const localSubscribers = new Set<() => void>()

function notifyLocalSubscribers() {
  for (const listener of localSubscribers) {
    try {
      listener()
    } catch {
      // Ignore subscriber errors.
    }
  }
}

function conversations() {
  return collection(db as never, 'conversations')
}

function messagesOf(convoId: string) {
  return collection(db as never, 'conversations', convoId, 'messages')
}

function toMessage(snap: QueryDocumentSnapshot<DocumentData>, uid: string): ChatMessage {
  const data = snap.data()
  const at = dateToISOString(data.created_at, new Date().toISOString())
  return {
    id: snap.id,
    text: String(data.text ?? ''),
    at,
    sender_uid: String(data.sender_uid ?? ''),
    mine: data.sender_uid === uid,
    attachment: parseChatAttachment(data.attachment),
  }
}

// ---------------------------------------------------------------------------
// Demo mode — local browser storage with per-conversation scoping
// ---------------------------------------------------------------------------

function localLoad(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as ChatMessage[]
  } catch {
    return []
  }
}

function localStore(next: ChatMessage[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
  notifyLocalSubscribers()
}

function localMessagesFor(convoId: string, uid: string): ChatMessage[] {
  const all = localLoad()
  const isLegacyUserThread = convoId === `local:${uid}`
  return all.filter((m) => {
    if (m.convo_id) return m.convo_id === convoId
    // Messages seeded without `convo_id` (e.g. legacy local chat or unit tests)
    // belong to `local:${uid}` when the sender matches or when viewing `local:${uid}`.
    return isLegacyUserThread
  })
}

function localPage(convoId: string, uid: string, before: MessageCursor | null, pageSize: number): MessagePage {
  const all = localMessagesFor(convoId, uid)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const older = before ? all.filter((m) => m.at < before.at) : all
  const slice = older.slice(0, pageSize)
  const oldest = slice.length ? slice[slice.length - 1] : null
  return {
    messages: slice
      .map((m) => ({ ...m, mine: m.sender_uid === uid }))
      .reverse(),
    cursor: oldest ? { at: oldest.at, id: oldest.id } : null,
    hasMore: older.length > slice.length,
  }
}

const isLocal = (convoId: string) => convoId.startsWith('local:')
const offline = (): boolean => !isFirebaseConfigured || !db

// ---------------------------------------------------------------------------
// Opening / ensuring a conversation (concurrency-safe)
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  /** Firestore TTL stamp: when this thread is scheduled to be swept. Null = kept. */
  retentionExpiresAt: Date | null
}

const inflightEnsure = new Map<string, Promise<Conversation>>()

export async function ensureConversation(uid: string, category: string): Promise<Conversation> {
  if (!isActiveCategory(category, 'inquiry')) {
    throw new Error('Choose a valid inquiry category.')
  }
  if (offline()) return { id: `local:${uid}`, retentionExpiresAt: null }

  const id = conversationDocId(uid, category)
  const ref = doc(conversations(), id)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    if (snap.data().guest_uid !== uid) {
      throw new Error('That conversation belongs to somebody else.')
    }
    const expires = parseDate(snap.data().messages_expires_at)
    return { id, retentionExpiresAt: expires }
  }
  await setDoc(ref, {
    guest_uid: uid,
    category,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    last_message: '',
    unread_admin: 0,
    unread_guest: 0,
  })
  return { id, retentionExpiresAt: null }
}

export type BookingConversationInput = {
  uid: string
  bookingId: string
  guestName: string
  bookingReference: string | null
  accommodationId: string | null
}

/**
 * Find or create the single unified conversation for a guest booking atomically.
 *
 * Uses both an in-memory promise lock and a Firestore transaction on the
 * deterministic `booking-${bookingId}` document id so concurrent requests can
 * never create duplicate threads for the same booking.
 */
export async function ensureBookingConversation(input: BookingConversationInput): Promise<Conversation> {
  if (offline()) {
    return {
      id: `local:booking-${input.bookingId}`,
      retentionExpiresAt: null,
    }
  }

  const id = bookingConversationId(input.bookingId)
  const existingInflight = inflightEnsure.get(id)
  if (existingInflight) return existingInflight

  const task = (async (): Promise<Conversation> => {
    const ref = doc(conversations(), id)
    const propertyName = propertyNameFromAccommodation(input.accommodationId)
    const safeRef = sanitizeBookingReference(input.bookingReference)

    if (typeof runTransaction === 'function') {
      return runTransaction(db as never, async (tx) => {
        const snap = await tx.get(ref)
        if (snap.exists()) {
          const data = snap.data()
          if (data.guest_uid && data.guest_uid !== input.uid) {
            throw new Error('That conversation belongs to somebody else.')
          }
          return {
            id,
            retentionExpiresAt: parseDate(data.messages_expires_at),
          }
        }
        tx.set(ref, {
          booking_id: input.bookingId,
          guest_uid: input.uid,
          guest_name: input.guestName.trim() || 'Guest',
          booking_reference: safeRef,
          property_name: propertyName,
          category: 'booking',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          last_message: '',
          unread_admin: 0,
          unread_guest: 0,
        })
        return { id, retentionExpiresAt: null }
      })
    }

    const snap = await getDoc(ref)
    if (snap.exists()) {
      const data = snap.data()
      if (data.guest_uid && data.guest_uid !== input.uid) {
        throw new Error('That conversation belongs to somebody else.')
      }
      return { id, retentionExpiresAt: parseDate(data.messages_expires_at) }
    }
    await setDoc(ref, {
      booking_id: input.bookingId,
      guest_uid: input.uid,
      guest_name: input.guestName.trim() || 'Guest',
      booking_reference: safeRef,
      property_name: propertyName,
      category: 'booking',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      last_message: '',
      unread_admin: 0,
      unread_guest: 0,
    })
    return { id, retentionExpiresAt: null }
  })().finally(() => {
    inflightEnsure.delete(id)
  })

  inflightEnsure.set(id, task)
  return task
}

export type FetchSummariesOptions = {
  email?: string | null
  guestName?: string | null
}

/**
 * Resolve all conversation summaries for a signed-in Guest, sorted newest-first:
 * 1. One unified conversation per booking (`booking-${booking.id}` in cloud,
 *    `local:booking-${booking.id}` in demo mode), carrying full Booking details.
 * 2. Non-destructive access to any pre-existing legacy `inquiry-${uid}-*` threads
 *    that already carry messages in Firestore or local storage.
 */
export async function fetchConversationSummaries(
  uid: string,
  options?: FetchSummariesOptions,
): Promise<ConversationSummary[]> {
  const defaultGuestName = (options?.guestName ?? '').trim() || 'Guest'

  if (offline()) {
    const normalizedEmail = options?.email?.trim().toLowerCase() ?? ''
    const myBookings = bookingsDB
      .list()
      .filter(
        (b: Booking) =>
          b.uid === uid ||
          (Boolean(normalizedEmail) && b.email?.trim().toLowerCase() === normalizedEmail),
      )
    const summaries: ConversationSummary[] = myBookings.map((booking: Booking) => {
      const convoId = `local:booking-${booking.id}`
      const msgs = localMessagesFor(convoId, uid)
      const latest = msgs.length ? msgs[msgs.length - 1] : null
      const bookingCreatedMs = Date.parse(booking.created_at)
      const latestAt = latest
        ? Date.parse(latest.at)
        : Number.isNaN(bookingCreatedMs)
          ? null
          : bookingCreatedMs

      return {
        conversationId: convoId,
        guestId: uid,
        bookingId: booking.id,
        guestName: booking.guest_name?.trim() || defaultGuestName,
        bookingReference: sanitizeBookingReference(booking.ref_id),
        propertyName: propertyNameFromAccommodation(booking.accommodation),
        latestMessageText: latest
          ? latest.text || (latest.attachment ? 'Sent a photo' : null)
          : null,
        latestMessageAt: latestAt,
        unreadCount: 0,
        unreadAdminCount: 0,
        adminLastReadAt: null,
        retentionExpiresAt: null,
        isLegacy: false,
        booking,
      }
    })

    // Preserve any legacy local messages written to `local:${category}` or `local:${uid}`.
    const legacyOfflineCandidates: Array<{ id: string; label: string }> = [
      { id: `local:${uid}`, label: 'Earlier inquiry' },
      ...activeCategories('inquiry').map((cat) => ({
        id: `local:${cat.id}`,
        label: `Earlier · ${cat.name}`,
      })),
    ]
    for (const candidate of legacyOfflineCandidates) {
      const legacyMsgs = localMessagesFor(candidate.id, uid)
      if (legacyMsgs.length === 0) continue
      const latest = legacyMsgs[legacyMsgs.length - 1]
      summaries.push({
        conversationId: candidate.id,
        guestId: uid,
        bookingId: null,
        guestName: defaultGuestName,
        bookingReference: null,
        propertyName: candidate.label,
        latestMessageText: latest.text || (latest.attachment ? 'Sent a photo' : null),
        latestMessageAt: Date.parse(latest.at) || null,
        unreadCount: 0,
        unreadAdminCount: 0,
        adminLastReadAt: null,
        retentionExpiresAt: null,
        isLegacy: true,
        legacyLabel: candidate.label,
        booking: null,
      })
    }

    summaries.sort((a, b) => (b.latestMessageAt ?? 0) - (a.latestMessageAt ?? 0))
    return summaries
  }

  const { cloudBookingsDB } = await import('./firestoreBookings')
  const bookings = await cloudBookingsDB.listMine(uid)

  const bookingSummaries = await Promise.all(
    bookings.map(async (booking): Promise<ConversationSummary> => {
      const convoId = bookingConversationId(booking.id)
      const snap = await getDoc(doc(conversations(), convoId))
      const bookingCreatedMs = Date.parse(booking.created_at)
      const fallbackMs = Number.isNaN(bookingCreatedMs) ? null : bookingCreatedMs

      if (!snap.exists()) {
        return {
          conversationId: convoId,
          guestId: uid,
          bookingId: booking.id,
          guestName: booking.guest_name?.trim() || defaultGuestName,
          bookingReference: sanitizeBookingReference(booking.ref_id),
          propertyName: propertyNameFromAccommodation(booking.accommodation),
          latestMessageText: null,
          latestMessageAt: fallbackMs,
          unreadCount: 0,
          unreadAdminCount: 0,
          adminLastReadAt: null,
          retentionExpiresAt: null,
          isLegacy: false,
          booking,
        }
      }

      const data = snap.data()
      const createdAt = parseDate(data.created_at)
      const updatedAt = parseDate(data.updated_at)
      const latestAt = updatedAt ?? createdAt
      const adminReadDate = parseDate(data.admin_last_read_at)

      return {
        conversationId: convoId,
        guestId: uid,
        bookingId: booking.id,
        guestName: String(data.guest_name || booking.guest_name || defaultGuestName),
        bookingReference: sanitizeBookingReference(data.booking_reference || booking.ref_id),
        propertyName:
          propertyNameFromAccommodation(booking.accommodation) ||
          (typeof data.property_name === 'string' && data.property_name.trim()
            ? data.property_name.trim()
            : null),
        latestMessageText:
          typeof data.last_message === 'string' && data.last_message.trim()
            ? data.last_message.trim()
            : null,
        latestMessageAt: latestAt ? latestAt.getTime() : fallbackMs,
        unreadCount: typeof data.unread_guest === 'number' && data.unread_guest > 0 ? data.unread_guest : 0,
        unreadAdminCount: typeof data.unread_admin === 'number' && data.unread_admin > 0 ? data.unread_admin : 0,
        adminLastReadAt: adminReadDate ? adminReadDate.toISOString() : null,
        retentionExpiresAt: parseDate(data.messages_expires_at),
        isLegacy: false,
        booking,
      }
    }),
  )

  // Non-destructive backward compatibility: surface any existing legacy
  // `inquiry-${uid}-${category}` threads that already exist in Firestore.
  const legacyCategories = activeCategories('inquiry')
  const legacyChecks = await Promise.all(
    legacyCategories.map((cat) =>
      legacyConversationSummary(conversationDocId(uid, cat.id), uid, cat.name).catch(() => null),
    ),
  )

  const summaries: ConversationSummary[] = [
    ...bookingSummaries,
    ...legacyChecks.filter((item): item is ConversationSummary => item !== null),
  ]

  // Sort most recent activity first (descending).
  summaries.sort((a, b) => (b.latestMessageAt ?? 0) - (a.latestMessageAt ?? 0))
  return summaries
}

/**
 * Read a pre-existing legacy topic conversation (`inquiry-${uid}-${topic}`) by id
 * without modifying or deleting it.
 */
export async function legacyConversationSummary(
  convoId: string,
  uid: string,
  topicLabel?: string,
): Promise<ConversationSummary | null> {
  if (!isLegacyConversationId(convoId) || offline()) return null
  const snap = await getDoc(doc(conversations(), convoId))
  if (!snap.exists()) return null
  const data = snap.data()
  if (data.guest_uid !== uid) return null

  const updatedAt = parseDate(data.updated_at)
  const createdAt = parseDate(data.created_at)
  const latestAt = updatedAt ?? createdAt
  const adminReadDate = parseDate(data.admin_last_read_at)

  return {
    conversationId: convoId,
    guestId: uid,
    bookingId: null,
    guestName: typeof data.guest_name === 'string' && data.guest_name.trim() ? data.guest_name.trim() : 'Guest',
    bookingReference: null,
    propertyName: topicLabel ? `Earlier · ${topicLabel}` : 'Earlier inquiry',
    latestMessageText:
      typeof data.last_message === 'string' && data.last_message.trim() ? data.last_message.trim() : null,
    latestMessageAt: latestAt ? latestAt.getTime() : null,
    unreadCount: typeof data.unread_guest === 'number' && data.unread_guest > 0 ? data.unread_guest : 0,
    unreadAdminCount: typeof data.unread_admin === 'number' && data.unread_admin > 0 ? data.unread_admin : 0,
    adminLastReadAt: adminReadDate ? adminReadDate.toISOString() : null,
    retentionExpiresAt: parseDate(data.messages_expires_at),
    isLegacy: true,
    legacyLabel: topicLabel ? `Earlier · ${topicLabel}` : 'Earlier inquiry',
    booking: null,
  }
}

export type ConversationLiveMeta = {
  unreadGuest: number
  unreadAdmin: number
  adminLastReadAt: string | null
  retentionExpiresAt: Date | null
  lastMessage: string | null
  updatedAtMs: number | null
}

/**
 * Subscribe to the open conversation document's metadata (unread counters,
 * Admin read watermark, retention stamp).
 */
export function subscribeConversationMeta(
  convoId: string,
  onMeta: (meta: ConversationLiveMeta) => void,
): () => void {
  if (offline() || isLocal(convoId)) {
    return () => {}
  }
  return onSnapshot(
    doc(conversations(), convoId),
    (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      const updated = parseDate(data.updated_at) ?? parseDate(data.created_at)
      const adminRead = parseDate(data.admin_last_read_at)
      onMeta({
        unreadGuest: typeof data.unread_guest === 'number' && data.unread_guest > 0 ? data.unread_guest : 0,
        unreadAdmin: typeof data.unread_admin === 'number' && data.unread_admin > 0 ? data.unread_admin : 0,
        adminLastReadAt: adminRead ? adminRead.toISOString() : null,
        retentionExpiresAt: parseDate(data.messages_expires_at),
        lastMessage: typeof data.last_message === 'string' ? data.last_message : null,
        updatedAtMs: updated ? updated.getTime() : null,
      })
    },
    () => {
      // Ignore transient doc metadata listener errors; message listener reports thread errors.
    },
  )
}

/**
 * Reset `unread_guest` to 0 when the Guest reads an open conversation.
 * Permitted by `firestore.rules` (`affectedKeys().hasOnly(['updated_at', 'last_message', 'unread_admin', 'unread_guest'])`).
 */
export async function markConversationReadByGuest(convoId: string): Promise<void> {
  if (offline() || isLocal(convoId)) return
  try {
    await updateDoc(doc(db as never, 'conversations', convoId), {
      unread_guest: 0,
    })
  } catch {
    // Best-effort read receipt clear.
  }
}

// ---------------------------------------------------------------------------
// Reading — one page at a time
// ---------------------------------------------------------------------------

export async function loadMessagePage(input: {
  convoId: string
  uid: string
  before?: MessageCursor | null
  pageSize?: number
}): Promise<MessagePage> {
  const pageSize = Math.min(CHAT_MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? CHAT_PAGE_SIZE)))
  if (offline() || isLocal(input.convoId)) {
    return localPage(input.convoId, input.uid, input.before ?? null, pageSize)
  }

  const constraints = [
    orderBy('created_at', 'desc'),
    limit(pageSize + 1),
    ...(input.before ? [startAfter(Timestamp.fromMillis(Date.parse(input.before.at)))] : []),
  ]
  const snap = await getDocs(query(messagesOf(input.convoId), ...constraints))
  const docs = snap.docs.slice(0, pageSize)
  const oldest = docs.length ? docs[docs.length - 1] : null
  return {
    messages: docs.map((d) => toMessage(d, input.uid)).reverse(),
    cursor: oldest ? { at: toMessage(oldest, input.uid).at, id: oldest.id } : null,
    hasMore: snap.docs.length > pageSize,
  }
}

export function subscribeMessages(
  convoId: string,
  uid: string,
  onPage: (page: MessagePage) => void,
  pageSize: number = CHAT_PAGE_SIZE,
  onError?: (error: unknown) => void,
): () => void {
  const size = Math.min(CHAT_MAX_PAGE_SIZE, pageSize)
  if (offline() || isLocal(convoId)) {
    const emit = () => onPage(localPage(convoId, uid, null, size))
    emit()
    localSubscribers.add(emit)
    return () => {
      localSubscribers.delete(emit)
    }
  }
  const q = query(messagesOf(convoId), orderBy('created_at', 'desc'), limit(size + 1))
  return onSnapshot(
    q,
    (snap) => {
      const docs = snap.docs.slice(0, size)
      const messages = docs.map((d) => toMessage(d, uid)).reverse()
      const oldest = docs.length ? docs[docs.length - 1] : null
      onPage({
        messages,
        cursor: oldest ? { at: toMessage(oldest, uid).at, id: oldest.id } : null,
        hasMore: snap.docs.length > size,
      })
    },
    (error) => {
      console.error('[Chat] messages listener failed', error)
      onError?.(error)
    },
  )
}

export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const m of [...existing, ...incoming]) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function sendChatMessage(input: {
  convoId: string
  uid: string
  text: string
  attachment?: ChatAttachment
  /** Required for a retryable image draft; it is also the Storage object id. */
  messageId?: string
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const caption = input.text.trim()
  const v = input.attachment
    ? caption.length <= 1000
      ? { ok: true as const, value: caption }
      : { ok: false as const, message: 'Message must be at most 1000 characters' }
    : validateMessage(input.text)
  if (!v.ok) return { ok: false, message: v.message }

  const id = input.messageId ?? crypto.randomUUID()
  if (input.attachment) {
    const valid = parseChatAttachment(attachmentDocument(input.attachment))
    if (!valid || input.attachment.path !== messageAttachmentPath(input.convoId, id)) {
      return { ok: false, message: 'The image attachment is not bound to this message. Select it again.' }
    }
  }

  if (offline() || isLocal(input.convoId)) {
    const current = localLoad()
    const existing = current.find((message) => message.id === id)
    if (existing) {
      if (
        existing.sender_uid !== input.uid ||
        existing.text !== v.value ||
        existing.attachment?.path !== input.attachment?.path
      ) {
        return { ok: false, message: 'This message could not be safely retried. Start a new draft.' }
      }
      return { ok: true, id }
    }
    const isLegacyUserThread = input.convoId === `local:${input.uid}`
    localStore([
      ...current,
      {
        id,
        text: v.value,
        at: new Date().toISOString(),
        mine: true,
        sender_uid: input.uid,
        ...(input.attachment ? { attachment: input.attachment } : {}),
        ...(isLegacyUserThread ? {} : { convo_id: input.convoId }),
      },
    ])
    return { ok: true, id }
  }

  if (input.attachment) {
    const reference = doc(messagesOf(input.convoId), id)
    const existing = await getDoc(reference)
    if (existing.exists()) {
      const data = existing.data()
      if (
        data.sender_uid !== input.uid ||
        data.sender_role !== 'guest' ||
        data.text !== v.value ||
        data.attachment?.path !== input.attachment.path
      ) {
        return { ok: false, message: 'This message id is already in use. Start a new draft.' }
      }
    } else {
      await setDoc(reference, {
        sender_uid: input.uid,
        sender_role: 'guest',
        text: v.value,
        created_at: serverTimestamp(),
        attachment: attachmentDocument(input.attachment),
      })
    }
  } else {
    await addDoc(messagesOf(input.convoId), {
      sender_uid: input.uid,
      sender_role: 'guest',
      text: v.value,
      created_at: serverTimestamp(),
    })
  }
  await updateDoc(doc(db as never, 'conversations', input.convoId), {
    updated_at: serverTimestamp(),
    last_message: (v.value || (input.attachment ? 'Sent a photo' : '')).slice(0, CHAT_PREVIEW_CHARS),
    unread_admin: 1,
  })
  return { ok: true, id }
}
