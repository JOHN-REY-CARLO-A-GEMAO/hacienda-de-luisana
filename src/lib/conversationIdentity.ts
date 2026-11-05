// ----------------------------------------------------------------------------
// Conversation identity — one conversation per Guest account.
//
// A Conversation is the thread between a Guest and the Admin. It is identified
// by the **Guest account**, never by a Booking: `guest-${uid}`. A Booking is
// *context* a single message may carry (`booking_id`), the way a subject line
// belongs to one email and not to the mailbox.
//
// Older shapes are still in Firestore and are read, never written, by clients:
//
//   guest-${uid}              CANONICAL — the one thread a Guest account has.
//   booking-${bookingId}      LEGACY — one thread per Booking, superseded.
//   inquiry-${uid}-${topic}   LEGACY — topic threads, superseded.
//   local:*                   DEMO — the same identities, in this browser.
//
// Everything in this module is pure. Nothing here imports Firebase, so the
// identity rules can be asserted without a project, and the same formula can be
// mirrored line-for-line by the Admin app (`lib/core/constants/app_constants.dart`).
// ----------------------------------------------------------------------------

/** The prefix that marks the canonical, account-wide conversation. */
export const GUEST_CONVERSATION_PREFIX = 'guest-'
/** The prefix of the superseded one-thread-per-Booking shape. */
export const LEGACY_BOOKING_PREFIX = 'booking-'
/** The prefix of the superseded topic threads. */
export const LEGACY_INQUIRY_PREFIX = 'inquiry-'
/** Demo-mode prefix: the same identities, held in this browser only. */
export const LOCAL_CONVERSATION_PREFIX = 'local:'

export type ConversationKind = 'guest' | 'booking' | 'inquiry' | 'local' | 'unknown'

/**
 * The id a Guest's one conversation has.
 *
 * Derived, not looked up. `firestore.rules` reads membership with
 * `isConversationMember(convoId)`, which resolves a conversation *by id*; on a
 * `where('guest_uid','==',uid)` query the id is unbound, so Firestore cannot
 * prove the query safe and refuses it. A formula both apps write down is what
 * keeps the website and the Admin app opening the same document.
 */
export function guestConversationId(uid: string): string {
  return `${GUEST_CONVERSATION_PREFIX}${uid}`
}

/** The demo-mode counterpart of {@link guestConversationId}. */
export function localConversationId(convoId: string): string {
  return `${LOCAL_CONVERSATION_PREFIX}${convoId}`
}

/** Strip a `local:` prefix, if there is one. */
export function withoutLocalPrefix(convoId: string): string {
  return convoId.startsWith(LOCAL_CONVERSATION_PREFIX)
    ? convoId.slice(LOCAL_CONVERSATION_PREFIX.length)
    : convoId
}

/** Is this the demo-mode form of a conversation id? */
export function isLocalConversationId(convoId: string): boolean {
  return convoId.startsWith(LOCAL_CONVERSATION_PREFIX)
}

/** Which shape is this conversation id? */
export function classifyConversationId(convoId: string): ConversationKind {
  if (isLocalConversationId(convoId)) return 'local'
  const id = withoutLocalPrefix(convoId)
  if (id.startsWith(GUEST_CONVERSATION_PREFIX)) return 'guest'
  if (id.startsWith(LEGACY_BOOKING_PREFIX)) return 'booking'
  if (id.startsWith(LEGACY_INQUIRY_PREFIX)) return 'inquiry'
  return 'unknown'
}

/** Is this the canonical, account-wide conversation for `uid`? */
export function isGuestConversationId(convoId: string, uid?: string): boolean {
  const id = withoutLocalPrefix(convoId)
  if (!id.startsWith(GUEST_CONVERSATION_PREFIX)) return false
  if (uid === undefined) return true
  return uidOfGuestConversationId(convoId) === uid
}

/** The owner uid a `guest-${uid}` id names. Null for any other shape. */
export function uidOfGuestConversationId(convoId: string): string | null {
  const id = withoutLocalPrefix(convoId)
  if (!id.startsWith(GUEST_CONVERSATION_PREFIX)) return null
  const uid = id.slice(GUEST_CONVERSATION_PREFIX.length)
  return uid.trim() ? uid : null
}

/**
 * The Booking id a legacy `booking-${bookingId}` id names.
 *
 * Used to read the superseded threads and to stamp their messages with the
 * booking context they were originally filed under. Null for any other shape.
 */
export function bookingIdOfLegacyConversationId(convoId: string): string | null {
  const id = withoutLocalPrefix(convoId)
  if (!id.startsWith(LEGACY_BOOKING_PREFIX)) return null
  const bookingId = id.slice(LEGACY_BOOKING_PREFIX.length)
  return bookingId.trim() ? bookingId : null
}

/**
 * Build the superseded one-thread-per-Booking id.
 *
 * Kept for reading history and for the migration audit. **No client creates a
 * conversation with this id any more** — `firestore.rules` refuses it, because a
 * second thread for a Guest who already has `guest-${uid}` is exactly the
 * duplicate this refactor removes.
 */
export function legacyBookingConversationId(bookingId: string): string {
  return `${LEGACY_BOOKING_PREFIX}${bookingId}`
}

/** Build the superseded topic-thread id. Read-only, as above. */
export function legacyInquiryConversationId(uid: string, topic: string): string {
  return `${LEGACY_INQUIRY_PREFIX}${uid}-${topic}`
}

/**
 * A Booking id is safe to store as message context when it is short, printable
 * and contains no path separator — the same discipline a document id answers to,
 * because that is what it is.
 */
export function isValidBookingContext(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return false
  if (trimmed !== value) return false
  if (trimmed.includes('/') || trimmed === '.' || trimmed === '..') return false
  return !/[\x00-\x1f\x7f]/.test(trimmed)
}

/**
 * Normalize an optional Booking reference into message context.
 *
 * `null` means *this message is a general inquiry* — which is a first-class
 * case, not a missing field. An unusable value is dropped rather than stored,
 * so a corrupt query parameter cannot poison the conversation.
 */
export function bookingContextOf(raw: string | null | undefined): string | null {
  return isValidBookingContext(raw) ? raw : null
}

/**
 * Resolve the conversation a message belongs to: always the account-wide one.
 *
 * Any other id that reaches this function is a legacy thread being read, and is
 * returned unchanged — history is never re-pointed by a reader.
 */
export function canonicalConversationIdFor(uid: string): string {
  return guestConversationId(uid)
}
