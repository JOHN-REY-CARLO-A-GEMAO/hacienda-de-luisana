import { createHash } from 'node:crypto'

// ----------------------------------------------------------------------------
// Folding a Guest's scattered threads into the one conversation their account
// has.
//
// The planning half is pure: it reads an inventory and returns what *would* be
// copied, without touching anything. The orchestration half runs that plan
// through a port, so the real Firestore/Storage adapter and the test doubles
// are held to exactly the same contract.
//
// Three rules hold the whole thing together:
//   1. NOTHING IS DELETED. A superseded thread is annotated, never removed, and
//      its messages and private attachments stay exactly where they are.
//   2. A copy has a stable identity derived from where it came from, so a retry
//      after a crash lands on the same document instead of creating a second
//      copy of the same message.
//   3. A copy is marked as a copy (`migrated`, `migration`), which is how the
//      notification trigger tells history from a message somebody just wrote.
// ----------------------------------------------------------------------------

/** The one conversation a Guest account has. Mirrors `src/lib/conversationIdentity.ts`. */
export function guestConversationId(uid: string): string {
  return `guest-${uid}`
}

/** The Booking a superseded `booking-<id>` thread was filed under, if any. */
export function bookingIdFromConversationId(convoId: string): string | null {
  if (!convoId.startsWith('booking-')) return null
  const candidate = convoId.slice('booking-'.length)
  return candidate.length > 0 ? candidate : null
}

/**
 * A message as the source thread stores it.
 *
 * Only `id` is required here, because planning has to be able to look at a
 * thread without assuming anything about it. The *executor* is stricter: a
 * message it cannot reproduce exactly — no sender, no role, no text, no
 * timestamp — is refused rather than copied in a mangled form.
 */
export type HistoryMessage = {
  id: string
  sender_uid?: unknown
  sender_role?: unknown
  text?: unknown
  /** The original timestamp — preserved exactly, so history keeps its order. */
  created_at?: unknown
  booking_id?: unknown
  attachment?: { path: string; content_type: string; size: number } | null
  /** Present only on a message that is itself a copy. Never copied again. */
  migration?: { source_conversation_id?: unknown; source_message_id?: unknown } | null
  migrated?: unknown
}

/** A read-only inventory entry: one thread, and the messages it holds. */
export type HistorySource = {
  id: string
  guestUid: string
  /** The Booking this whole thread was about, when the thread was booking-scoped. */
  bookingId?: string | null
  guestName?: string | null
  messages: ReadonlyArray<HistoryMessage>
  /** Set when a previous run already folded this thread in. */
  supersededBy?: string | null
}

export type HistoryCopy = {
  sourceConversationId: string
  sourceMessageId: string
  destinationMessageId: string
  /** The Booking context the copy carries. Null for a general message. */
  bookingId: string | null
  attachment: null | {
    sourcePath: string
    destinationPath: string
    contentType: string
    size: number
  }
}

function validId(id: string): boolean {
  return id.length > 0 && id !== '.' && id !== '..' && !id.includes('/') && !/[\x00-\x1f\x7f]/.test(id)
}

/** A booking id is stored as message context only when it is a usable document id. */
function validBookingContext(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 128 && validId(trimmed) && trimmed === value
}

function isAlreadyACopy(message: HistoryMessage): boolean {
  return message.migrated === true || (message.migration != null && typeof message.migration === 'object')
}

/**
 * Build stable, collision-resistant copy identities while failing closed on
 * ownership or attachment metadata. An executor must separately coordinate
 * live writers, verify object bytes and metadata, handle concurrent retries,
 * preserve timestamps and sender data, and verify the result before cutover.
 */
export function planGuestHistoryCopies(uid: string, sources: readonly HistorySource[]): HistoryCopy[] {
  if (!validId(uid)) throw new Error('Invalid guest identity')
  const destination = guestConversationId(uid)
  const seenSources = new Set<string>()
  const seenMessages = new Set<string>()
  const plan: HistoryCopy[] = []
  for (const source of sources) {
    if (!validId(source.id) || source.guestUid !== uid) throw new Error('Invalid source or guest ownership')
    if (seenSources.has(source.id)) throw new Error('Duplicate source')
    seenSources.add(source.id)
    // Never copy a thread out of itself.
    if (source.id === destination) continue
    const sourceBookingId = validBookingContext(source.bookingId)
      ? source.bookingId
      : bookingIdFromConversationId(source.id)
    for (const message of source.messages) {
      if (!validId(message.id)) throw new Error('Invalid message identity')
      const identity = JSON.stringify([source.id, message.id])
      if (seenMessages.has(identity)) throw new Error('Duplicate source message')
      seenMessages.add(identity)
      // A message that is already a copy of something is not copied again, so
      // re-running the migration over an already-merged thread is a no-op.
      if (isAlreadyACopy(message)) continue
      const destinationMessageId = `migrated-${createHash('sha256').update(identity).digest('hex')}`
      const value = message.attachment
      let attachment: HistoryCopy['attachment'] = null
      if (value != null) {
        const sourcePath = `messageAttachments/${source.id}/${message.id}`
        if (value.path !== sourcePath ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(value.content_type) ||
            !Number.isInteger(value.size) || value.size < 1 || value.size > 5 * 1024 * 1024) {
          throw new Error('Invalid attachment metadata')
        }
        attachment = {
          sourcePath,
          destinationPath: `messageAttachments/${destination}/${destinationMessageId}`,
          contentType: value.content_type,
          size: value.size,
        }
      }
      plan.push({
        sourceConversationId: source.id,
        sourceMessageId: message.id,
        destinationMessageId,
        bookingId: validBookingContext(message.booking_id) ? message.booking_id : sourceBookingId,
        attachment,
      })
    }
  }
  return plan.sort((a, b) => a.sourceConversationId.localeCompare(b.sourceConversationId) || a.sourceMessageId.localeCompare(b.sourceMessageId))
}

/** A destination id is one this module produced, which is how a retry recognises its own work. */
export function isMigratedMessageId(messageId: string): boolean {
  return /^migrated-[a-f0-9]{64}$/.test(messageId)
}

/**
 * True when a message is history rather than something somebody just wrote.
 *
 * The notification trigger asks this before it wakes the Admin up. Without it,
 * folding five years of chat into one thread would send five years of push
 * notifications.
 */
export function isMigratedMessage(messageId: string, data?: Record<string, unknown> | null): boolean {
  if (isMigratedMessageId(messageId)) return true
  if (!data) return false
  if (data.migrated === true) return true
  const provenance = data.migration
  if (provenance && typeof provenance === 'object') {
    const record = provenance as Record<string, unknown>
    if (typeof record.source_message_id === 'string' && record.source_message_id.length > 0) return true
    if (typeof record.source_conversation_id === 'string' && record.source_conversation_id.length > 0) return true
  }
  return false
}

/**
 * Runtime operations required by a migration adapter. `lockAndList` must
 * durably block all writers to the source threads before returning the complete
 * owner-scoped inventory, including after a worker crash. It must be safe to
 * call repeatedly. `copyMessage` must atomically create or verify an identical
 * previously migrated message, retaining sender fields and original timestamp.
 * `complete` must atomically mark the migration complete only while the lock is
 * still held. None of the operations may delete source data.
 */
export type HistoryMergePort = {
  lockAndList(uid: string): Promise<readonly HistorySource[]>
  copyAndVerifyAttachment(copy: NonNullable<HistoryCopy['attachment']>): Promise<void>
  copyMessage(uid: string, copy: HistoryCopy): Promise<void>
  complete(uid: string, plan: readonly HistoryCopy[]): Promise<void>
}

/**
 * Non-destructive, retryable orchestration. A failed copy leaves the lock in
 * place and does not report completion; retries use the same destination IDs.
 * This core is not a deployed migration by itself: the backend adapter must
 * implement the guarantees in HistoryMergePort, and callers must not enable
 * cutover until that adapter and writer-lock rules are in place.
 */
export async function mergeGuestHistory(uid: string, port: HistoryMergePort): Promise<number> {
  if (!validId(uid)) throw new Error('Invalid guest identity')
  const sources = await port.lockAndList(uid)
  const plan = planGuestHistoryCopies(uid, sources)
  for (const copy of plan) {
    if (copy.attachment) await port.copyAndVerifyAttachment(copy.attachment)
    await port.copyMessage(uid, copy)
  }
  await port.complete(uid, plan)
  return plan.length
}
