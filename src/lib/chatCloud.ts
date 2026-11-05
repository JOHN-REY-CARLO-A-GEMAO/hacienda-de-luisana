// ----------------------------------------------------------------------------
// Conversations — the Guest ↔ Admin chat, page by page.
//
// ONE conversation per Guest account: `guest-${uid}`. A Booking is optional
// *context* a single message may carry (`booking_id`), not the identity of the
// thread — so five bookings, a general inquiry and a follow-up question all
// live in one place, on both the website and the Admin app. Superseded
// `booking-${bookingId}` and `inquiry-${uid}-${topic}` threads are still read
// (history is never dropped) but no client opens a new one; the migration in
// `functions/src/guestConversationMigration.ts` folds them into the account
// thread non-destructively. See `src/lib/conversationIdentity.ts`.
//
// Four cost and security invariants hold everywhere here:
//   1. A thread is read a page at a time (`CHAT_PAGE_SIZE`, max 50).
//   2. Only one live listener runs for the open conversation's newest page,
//      and it is torn down on thread switch or unmount.
//   3. Messages are capped at 1,000 characters (`MESSAGE_MAX`), matching
//      `firestore.rules`.
//   4. A conversation id is derived from the account, never chosen by the
//      caller, so two tabs and two devices cannot disagree about where a
//      Guest's thread lives.
//
// With no Firebase project configured, the same pagination and per-account
// conversation lookup run locally against `hdl:chat` and `bookingsDB`.
// ----------------------------------------------------------------------------

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
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
import {
  bookingContextOf,
  bookingIdOfLegacyConversationId,
  classifyConversationId,
  guestConversationId,
  isGuestConversationId,
  isLocalConversationId,
  legacyBookingConversationId,
  legacyInquiryConversationId,
  localConversationId,
} from './conversationIdentity'
import { db, isFirebaseConfigured } from './firebase'
import { dateToISOString, parseDate } from './formatDate'
import { bookingsDB, type Booking } from './storage'
import { validateMessage } from './validation'

export type { ChatAttachment } from './chatAttachments'
export {
  bookingContextOf,
  classifyConversationId,
  guestConversationId,
  isGuestConversationId,
  isLocalConversationId,
  legacyBookingConversationId,
  legacyInquiryConversationId,
  localConversationId,
  uidOfGuestConversationId,
} from './conversationIdentity'

// ----------------------------------------------------------------------------
// Unified conversation types — one continuous thread per Guest ACCOUNT.
// ----------------------------------------------------------------------------

export type ConversationSummary = {
  /** Internal document id (`guest-${uid}`, `local:guest-${uid}`, or a legacy thread being read). Never shown in UI. */
  conversationId: string
  /** Internal guest Firebase uid. Never shown in UI. */
  guestId: string
  /**
   * The Booking this thread is *about*, or null.
   *
   * Context, not identity: the canonical account thread is never about one
   * Booking, so this is null there, and a message inside it may still name a
   * Booking of its own (`ChatMessage.booking_id`).
   */
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
  /** True when this is a superseded thread (`booking-*` / `inquiry-*`) read for history. */
  isLegacy: boolean
  /** True when this is the account-wide conversation the account always has. */
  isCanonical: boolean
  /** Human-readable label for a legacy thread (never raw IDs). */
  legacyLabel?: string | null
  /** Every Booking id this account holds, so a message may be filed against any of them. */
  linkedBookingIds: string[]
  /** The same bookings, with their human-readable references, for the details drawer. */
  linkedBookings: Booking[]
  /** Linked booking record when available, used by the Booking Details drawer. */
  booking?: Booking | null
  /** Set on a superseded thread once its history has been folded into the account thread. */
  supersededBy?: string | null
  /** True when the conversation document does not exist yet in Firestore. */
  missing?: boolean
}

/**
 * The superseded one-thread-per-Booking id.
 *
 * Read-only history. `firestore.rules` refuses to *create* a conversation with
 * this id, so the duplicate threads this refactor removes cannot come back.
 */
export function bookingConversationId(bookingId: string): string {
  return legacyBookingConversationId(bookingId)
}

/** Is a conversation id the superseded booking-scoped form? */
export function isBookingConversationId(convoId: string): boolean {
  return bookingIdOfLegacyConversationId(convoId) !== null
}

/** Is a conversation id a legacy topic-based form (`inquiry-*-*`)? */
export function isLegacyConversationId(convoId: string): boolean {
  return classifyConversationId(convoId) === 'inquiry'
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
  /** Optional local-storage conversation tag for demo multi-conversation isolation. */
  convo_id?: string
  /**
   * The Booking this one message refers to, or null for a general inquiry.
   *
   * Context, not identity: several bookings may be discussed in one thread, and
   * a message with no booking at all is a first-class case.
   */
  booking_id?: string | null
  /** Who wrote it, when the row came from a superseded thread. */
  sender_role?: 'guest' | 'admin'
  /** Provenance stamped by the history migration. Absent on ordinary messages. */
  migration?: {
    source_conversation_id: string
    source_message_id: string
    migrated_at?: string | null
  } | null
}

export type MessageCursor = {
  at: string
  id: string
  /** The original Firestore snapshot retains nanosecond precision for pagination. */
  snapshot?: QueryDocumentSnapshot<DocumentData>
}

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
  const role = data.sender_role === 'admin' ? 'admin' : data.sender_role === 'guest' ? 'guest' : undefined
  const migration = data.migration as ChatMessage['migration']
  return {
    id: snap.id,
    text: String(data.text ?? ''),
    at,
    sender_uid: String(data.sender_uid ?? ''),
    mine: data.sender_uid === uid,
    attachment: parseChatAttachment(data.attachment),
    booking_id: bookingContextOf(data.booking_id as string | null | undefined),
    ...(role ? { sender_role: role } : {}),
    ...(migration && typeof migration === 'object' ? { migration } : {}),
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

/**
 * The demo-mode ids that mean "this account's one conversation".
 *
 * `local:${uid}` is what earlier demo builds and their seeded fixtures used;
 * `local:guest-${uid}` is the cloud identity with the demo prefix. Both are the
 * account thread, so a message stored before either name existed is still
 * readable from either — history in this browser is never orphaned by a rename.
 */
function localAccountThreadIds(uid: string): string[] {
  return [`local:${uid}`, localConversationId(guestConversationId(uid))]
}

function localMessagesFor(rawConvoId: string, uid: string): ChatMessage[] {
  const convoId = demoConvoId(rawConvoId)
  const all = localLoad()
  const isAccountThread = localAccountThreadIds(uid).includes(convoId)
  return all.filter((m) => {
    if (m.convo_id) return m.convo_id === convoId
    // Messages seeded without `convo_id` (earlier demo chat, or a seeded test
    // fixture) belong to the account's own conversation, and to nothing else.
    return isAccountThread
  })
}

function localPage(convoId: string, uid: string, before: MessageCursor | null, pageSize: number): MessagePage {
  const all = localMessagesFor(convoId, uid)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)))
  const older = before ? all.filter((m) => m.at < before.at || (m.at === before.at && m.id < before.id)) : all
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

/**
 * Demo mode keeps every conversation under one prefix, whatever shape of id the
 * caller derived. Normalising on the way in is what lets a caller name the
 * thread the way the cloud does (`guest-<uid>`) and still land in the same
 * local conversation the page reads.
 */
function demoConvoId(convoId: string): string {
  return isLocal(convoId) ? convoId : localConversationId(convoId)
}

// ---------------------------------------------------------------------------
// Opening / ensuring a conversation (concurrency-safe)
// ---------------------------------------------------------------------------

export type Conversation = {
  id: string
  /** Firestore TTL stamp: when this thread is scheduled to be swept. Null = kept. */
  retentionExpiresAt: Date | null
}

const inflightEnsure = new Map<string, Promise<Conversation>>()

/**
 * THE conversation this Guest account has with the Hacienda — find it, or open
 * it, exactly once.
 *
 * Two guarantees make this safe to call from several tabs at once:
 *   - The id is derived from the uid, so every caller names the same document.
 *     There is no second thread to race against.
 *   - The create runs inside a Firestore transaction (and behind an in-process
 *     promise lock), so two simultaneous opens produce one document, not two.
 *
 * Existing `booking-*` and `inquiry-*` threads are left exactly as they are,
 * attachments included: this never moves or deletes history. That is the
 * migration's job (`functions/src/guestConversationMigration.ts`).
 */
export async function ensureGuestConversation(uid: string, guestName: string): Promise<Conversation> {
  if (!uid.trim()) throw new Error('Sign in to message the Hacienda.')
  const id = guestConversationId(uid)
  if (offline()) return { id: localConversationId(id), retentionExpiresAt: null }
  const existing = inflightEnsure.get(id)
  if (existing) return existing
  const task = runTransaction(db as never, async (tx) => {
    const ref = doc(conversations(), id)
    const snap = await tx.get(ref)
    if (snap.exists()) {
      const data = snap.data()
      if (data.guest_uid !== uid) throw new Error('That conversation belongs to somebody else.')
      return { id, retentionExpiresAt: parseDate(data.messages_expires_at) }
    }
    tx.set(ref, {
      guest_uid: uid,
      guest_name: guestName.trim() || 'Guest',
      category: 'booking',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      last_message: '',
      unread_admin: 0,
      unread_guest: 0,
    })
    return { id, retentionExpiresAt: null }
  }).finally(() => inflightEnsure.delete(id))
  inflightEnsure.set(id, task)
  return task
}

/**
 * @deprecated A topic was never a thread. Resolves to the account conversation.
 *
 * Kept so the last callers that speak in categories keep working. The category
 * argument is ignored on purpose: what a message is *about* is carried by the
 * message now (`booking_id`), and the thread is the account's one thread.
 */
export async function ensureConversation(
  uid: string,
  _category?: string,
  guestName?: string,
): Promise<Conversation> {
  return ensureGuestConversation(uid, guestName ?? 'Guest')
}

export type BookingConversationInput = {
  uid: string
  bookingId: string
  guestName: string
  bookingReference: string | null
  accommodationId: string | null
}

/**
 * Resolve the conversation a message about a Booking belongs to.
 *
 * The answer is always the account thread: a Booking is context a message
 * carries, not a thread of its own. This function exists so the last callers
 * that think in bookings keep working, and so the code says the change out loud
 * at the point where the old behaviour used to be.
 *
 * It never creates a second thread, so the duplicate-per-booking bug this
 * refactor removes cannot be reintroduced by an un-migrated caller.
 */
export async function ensureBookingConversation(input: BookingConversationInput): Promise<Conversation> {
  const conversation = await ensureGuestConversation(input.uid, input.guestName)
  return conversation
}

export type FetchSummariesOptions = {
  email?: string | null
  guestName?: string | null
}

/**
 * Resolve the conversations a signed-in Guest can open.
 *
 * There is exactly one: `guest-${uid}`. Five bookings, one thread — because a
 * Booking is context a message carries, not a thread of its own.
 *
 * Behind it, superseded `booking-${bookingId}` and `inquiry-${uid}-${topic}`
 * threads are still listed while they still hold history the migration has not
 * folded in yet. They are never written to and never deleted here; once the
 * migration has copied their messages it stamps `superseded_by` on the source
 * and the row drops out of this list, because the history is then in the one
 * thread where both apps will look for it.
 */
export async function fetchConversationSummaries(
  uid: string,
  options?: FetchSummariesOptions,
): Promise<ConversationSummary[]> {
  const defaultGuestName = (options?.guestName ?? '').trim() || 'Guest'
  const canonicalId = offline()
    ? localConversationId(guestConversationId(uid))
    : guestConversationId(uid)

  if (offline()) {
    const normalizedEmail = options?.email?.trim().toLowerCase() ?? ''
    const myBookings = bookingsDB
      .list()
      .filter(
        (b: Booking) =>
          b.uid === uid ||
          (Boolean(normalizedEmail) && b.email?.trim().toLowerCase() === normalizedEmail),
      )

    const msgs = localMessagesFor(canonicalId, uid)
    const latest = msgs.length ? msgs[msgs.length - 1] : null

    const unified: ConversationSummary = {
      conversationId: canonicalId,
      guestId: uid,
      bookingId: null,
      guestName: defaultGuestName,
      bookingReference: null,
      propertyName: null,
      latestMessageText: latest
        ? latest.text || (latest.attachment ? 'Sent a photo' : null)
        : null,
      latestMessageAt: latest ? Date.parse(latest.at) || null : null,
      unreadCount: 0,
      unreadAdminCount: 0,
      adminLastReadAt: null,
      retentionExpiresAt: null,
      isLegacy: false,
      isCanonical: true,
      linkedBookingIds: myBookings.map((booking) => booking.id),
      linkedBookings: myBookings,
      booking: null,
    }

    // Superseded demo threads, kept readable until their history is merged.
    const legacyOfflineCandidates: Array<{ id: string; label: string }> = [
      ...myBookings.map((booking: Booking) => ({
        id: localConversationId(legacyBookingConversationId(booking.id)),
        label: `Earlier · ${
          sanitizeBookingReference(booking.ref_id) ??
          propertyNameFromAccommodation(booking.accommodation) ??
          'reservation'
        }`,
      })),
      // Two historical shapes: `inquiry-<uid>-<topic>` is what the cloud used,
      // and `local:<topic>` is what the earliest demo builds wrote. Both are
      // read; neither is written again.
      ...activeCategories('inquiry').flatMap((cat) => [
        {
          id: localConversationId(legacyInquiryConversationId(uid, cat.id)),
          label: `Earlier · ${cat.name}`,
        },
        { id: localConversationId(cat.id), label: `Earlier · ${cat.name}` },
      ]),
      { id: `local:${uid}`, label: 'Earlier inquiry' },
    ]

    const summaries: ConversationSummary[] = [unified]
    for (const candidate of legacyOfflineCandidates) {
      if (candidate.id === canonicalId) continue
      const legacyMsgs = localMessagesFor(candidate.id, uid)
      if (legacyMsgs.length === 0) continue
      const legacyLatest = legacyMsgs[legacyMsgs.length - 1]
      summaries.push({
        conversationId: candidate.id,
        guestId: uid,
        bookingId: bookingIdOfLegacyConversationId(candidate.id),
        guestName: defaultGuestName,
        bookingReference: null,
        propertyName: candidate.label,
        latestMessageText: legacyLatest.text || (legacyLatest.attachment ? 'Sent a photo' : null),
        latestMessageAt: Date.parse(legacyLatest.at) || null,
        unreadCount: 0,
        unreadAdminCount: 0,
        adminLastReadAt: null,
        retentionExpiresAt: null,
        isLegacy: true,
        isCanonical: false,
        legacyLabel: candidate.label,
        linkedBookingIds: myBookings.map((booking) => booking.id),
        linkedBookings: myBookings,
        booking: null,
      })
    }

    return sortSummaries(summaries)
  }

  const { cloudBookingsDB } = await import('./firestoreBookings')
  const bookings = await cloudBookingsDB.listMine(uid)

  const unified = await canonicalConversationSummary(canonicalId, uid, {
    guestName: defaultGuestName,
    linkedBookingIds: bookings.map((booking) => booking.id),
    linkedBookings: bookings,
  })

  // Non-destructive backward compatibility: surface any superseded threads that
  // still exist, so history is reachable before the migration runs. A thread the
  // migration has already folded in is hidden rather than shown twice.
  const legacyCandidates: Array<{ id: string; label: string; bookingId: string | null }> = [
    ...bookings.map((booking) => ({
      id: legacyBookingConversationId(booking.id),
      label: `Earlier · ${
        sanitizeBookingReference(booking.ref_id) ??
        propertyNameFromAccommodation(booking.accommodation) ??
        'reservation'
      }`,
      bookingId: booking.id,
    })),
    ...activeCategories('inquiry').map((cat) => ({
      id: conversationDocId(uid, cat.id),
      label: `Earlier · ${cat.name}`,
      bookingId: null,
    })),
  ]

  const legacyChecks = await Promise.all(
    legacyCandidates.map((candidate) =>
      legacyConversationSummary(candidate.id, uid, candidate.label).catch(() => null),
    ),
  )

  const summaries: ConversationSummary[] = [
    unified,
    ...legacyChecks.filter(
      (item): item is ConversationSummary => item !== null && !item.supersededBy,
    ),
  ]

  return sortSummaries(summaries)
}

/** The canonical thread first, then the others newest-first. */
function sortSummaries(summaries: ConversationSummary[]): ConversationSummary[] {
  return summaries
    .slice()
    .sort((a, b) => {
      if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1
      return (b.latestMessageAt ?? 0) - (a.latestMessageAt ?? 0)
    })
}

/**
 * Read the account-wide conversation. Missing is not an error: the thread is
 * created on first message, and the caller needs to be able to open an empty
 * one rather than be told it does not exist.
 */
export async function canonicalConversationSummary(
  convoId: string,
  uid: string,
  options?: { guestName?: string; linkedBookingIds?: string[]; linkedBookings?: Booking[] },
): Promise<ConversationSummary> {
  const fallbackName = (options?.guestName ?? '').trim() || 'Guest'
  const base = {
    conversationId: convoId,
    guestId: uid,
    bookingId: null,
    guestName: fallbackName,
    bookingReference: null,
    propertyName: null,
    latestMessageText: null,
    latestMessageAt: null,
    unreadCount: 0,
    unreadAdminCount: 0,
    adminLastReadAt: null,
    retentionExpiresAt: null,
    isLegacy: false,
    isCanonical: true,
    linkedBookingIds: options?.linkedBookingIds ?? [],
    linkedBookings: options?.linkedBookings ?? [],
    booking: null,
  } as ConversationSummary

  if (offline() || isLocal(convoId)) return base

  const snap = await getDoc(doc(conversations(), convoId)).catch(() => null)
  if (!snap || !snap.exists()) return { ...base, missing: true }

  const data = snap.data()
  if (data.guest_uid !== uid) return { ...base, missing: true }

  const latestAt = parseDate(data.updated_at) ?? parseDate(data.created_at)

  return {
    ...base,
    guestName:
      typeof data.guest_name === 'string' && data.guest_name.trim()
        ? data.guest_name.trim()
        : fallbackName,
    latestMessageText:
      typeof data.last_message === 'string' && data.last_message.trim()
        ? data.last_message.trim()
        : null,
    latestMessageAt: latestAt ? latestAt.getTime() : null,
    unreadCount: typeof data.unread_guest === 'number' && data.unread_guest > 0 ? data.unread_guest : 0,
    unreadAdminCount: typeof data.unread_admin === 'number' && data.unread_admin > 0 ? data.unread_admin : 0,
    adminLastReadAt: parseDate(data.admin_last_read_at)?.toISOString() ?? null,
    retentionExpiresAt: parseDate(data.messages_expires_at),
    supersededBy: typeof data.superseded_by === 'string' ? data.superseded_by : null,
  }
}

/**
 * Read a superseded thread (`booking-${bookingId}` or `inquiry-${uid}-${topic}`)
 * by id without modifying or deleting it.
 */
export async function legacyConversationSummary(
  convoId: string,
  uid: string,
  topicLabel?: string,
): Promise<ConversationSummary | null> {
  if (isGuestConversationId(convoId) || offline()) return null
  const snap = await getDoc(doc(conversations(), convoId))
  if (!snap.exists()) return null
  const data = snap.data()
  if (data.guest_uid !== uid) return null

  const updatedAt = parseDate(data.updated_at)
  const createdAt = parseDate(data.created_at)
  const latestAt = updatedAt ?? createdAt
  const adminReadDate = parseDate(data.admin_last_read_at)
  const label = topicLabel ? `Earlier · ${topicLabel}` : 'Earlier inquiry'

  return {
    conversationId: convoId,
    guestId: uid,
    bookingId: bookingIdOfLegacyConversationId(convoId),
    guestName: typeof data.guest_name === 'string' && data.guest_name.trim() ? data.guest_name.trim() : 'Guest',
    bookingReference: sanitizeBookingReference(data.booking_reference),
    propertyName: label,
    latestMessageText:
      typeof data.last_message === 'string' && data.last_message.trim()
        ? data.last_message.trim()
        : null,
    latestMessageAt: latestAt ? latestAt.getTime() : null,
    unreadCount: typeof data.unread_guest === 'number' && data.unread_guest > 0 ? data.unread_guest : 0,
    unreadAdminCount: typeof data.unread_admin === 'number' && data.unread_admin > 0 ? data.unread_admin : 0,
    adminLastReadAt: adminReadDate ? adminReadDate.toISOString() : null,
    retentionExpiresAt: parseDate(data.messages_expires_at),
    isLegacy: true,
    isCanonical: false,
    legacyLabel: label,
    linkedBookingIds: [],
    linkedBookings: [],
    booking: null,
    supersededBy: typeof data.superseded_by === 'string' ? data.superseded_by : null,
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
    const emit = () => {
      const messages = localLoad().filter((message) => message.convo_id === convoId)
      const latest = messages.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).at(-1)
      if (!latest) return
      onMeta({ unreadGuest: 0, unreadAdmin: 0, adminLastReadAt: null, retentionExpiresAt: null,
        lastMessage: latest.text || (latest.attachment ? 'Sent a photo' : null),
        updatedAtMs: Date.parse(latest.at) || null })
    }
    emit()
    localSubscribers.add(emit)
    return () => { localSubscribers.delete(emit) }
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
    orderBy(documentId(), 'desc'),
    limit(pageSize + 1),
    ...(input.before ? [input.before.snapshot ? startAfter(input.before.snapshot) : startAfter(Timestamp.fromMillis(Date.parse(input.before.at)), input.before.id)] : []),
  ]
  const snap = await getDocs(query(messagesOf(input.convoId), ...constraints))
  const docs = snap.docs.slice(0, pageSize)
  const oldest = docs.length ? docs[docs.length - 1] : null
  return {
    messages: docs.map((d) => toMessage(d, input.uid)).reverse(),
    cursor: oldest ? { at: toMessage(oldest, input.uid).at, id: oldest.id, snapshot: oldest } : null,
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
  const q = query(messagesOf(convoId), orderBy('created_at', 'desc'), orderBy(documentId(), 'desc'), limit(size + 1))
  return onSnapshot(
    q,
    (snap) => {
      const docs = snap.docs.slice(0, size)
      const messages = docs.map((d) => toMessage(d, uid)).reverse()
      const oldest = docs.length ? docs[docs.length - 1] : null
      onPage({
        messages,
        cursor: oldest ? { at: toMessage(oldest, uid).at, id: oldest.id, snapshot: oldest } : null,
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
  /**
   * The Booking this message is about — context, not identity.
   *
   * Omitted (or null) for a general inquiry, which is a first-class case: a
   * Guest can ask a question before they have ever booked, and several bookings
   * can be discussed inside the same thread.
   */
  bookingId?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const caption = input.text.trim()
  const v = input.attachment
    ? caption.length <= 1000
      ? { ok: true as const, value: caption }
      : { ok: false as const, message: 'Message must be at most 1000 characters' }
    : validateMessage(input.text)
  if (!v.ok) return { ok: false, message: v.message }

  // An unusable booking reference is dropped rather than stored: a corrupt
  // query parameter must not be able to poison an otherwise good message.
  const bookingContext = bookingContextOf(input.bookingId ?? null)

  const id = input.messageId ?? crypto.randomUUID()
  // Resolve the demo identity once, so the attachment path and the stored
  // conversation tag can never disagree about where this message lives.
  const convoId = offline() ? demoConvoId(input.convoId) : input.convoId
  if (input.attachment) {
    const valid = parseChatAttachment(attachmentDocument(input.attachment))
    if (!valid || input.attachment.path !== messageAttachmentPath(convoId, id)) {
      return { ok: false, message: 'The image attachment is not bound to this message. Select it again.' }
    }
  }

  if (offline() || isLocal(convoId)) {
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
    localStore([
      ...current,
      {
        id,
        text: v.value,
        at: new Date().toISOString(),
        mine: true,
        sender_uid: input.uid,
        sender_role: 'guest' as const,
        convo_id: convoId,
        booking_id: bookingContext,
        ...(input.attachment ? { attachment: input.attachment } : {}),
      },
    ])
    return { ok: true, id }
  }

  // One immutable message id per draft, and an atomic message + preview update.
  // If the response is lost, retrying the same id observes the committed record
  // instead of creating a duplicate or reporting a partially completed write.
  //
  // The conversation update is an *increment*, not an assignment: two messages
  // sent at the same moment must both be counted, and neither may reset the
  // counter the other just moved.
  const reference = doc(messagesOf(convoId), id)
  const conversation = doc(db as never, 'conversations', convoId)
  const outcome = await runTransaction(db as never, async (tx) => {
    const existing = await tx.get(reference)
    if (existing.exists()) {
      const data = existing.data()
      if (data.sender_uid !== input.uid || data.sender_role !== 'guest' || data.text !== v.value
          || (data.attachment?.path ?? null) !== (input.attachment?.path ?? null)
          || (data.booking_id ?? null) !== bookingContext) {
        return false
      }
      return true
    }
    tx.set(reference, {
      sender_uid: input.uid,
      sender_role: 'guest',
      text: v.value,
      created_at: serverTimestamp(),
      ...(bookingContext ? { booking_id: bookingContext } : {}),
      ...(input.attachment ? { attachment: attachmentDocument(input.attachment) } : {}),
    })
    tx.update(conversation, {
      updated_at: serverTimestamp(),
      last_message: (v.value || (input.attachment ? 'Sent a photo' : '')).slice(0, CHAT_PREVIEW_CHARS),
      unread_admin: increment(1),
    })
    return true
  })
  if (!outcome) return { ok: false, message: 'This message id is already in use. Start a new draft.' }

  return { ok: true, id }
}
