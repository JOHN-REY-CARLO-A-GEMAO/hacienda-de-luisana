import { createHash } from 'node:crypto'

/** A read-only plan. Producing it does not copy or remove any data. */
export type HistorySource = {
  id: string
  guestUid: string
  messages: ReadonlyArray<{
    id: string
    attachment?: { path: string; content_type: string; size: number } | null
  }>
}

export type HistoryCopy = {
  sourceConversationId: string
  sourceMessageId: string
  destinationMessageId: string
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

/**
 * Build stable, collision-resistant copy identities while failing closed on
 * ownership or attachment metadata. An executor must separately coordinate
 * live writers, verify object bytes and metadata, handle concurrent retries,
 * preserve timestamps and sender data, and verify the result before cutover.
 */
export function planGuestHistoryCopies(uid: string, sources: readonly HistorySource[]): HistoryCopy[] {
  if (!validId(uid)) throw new Error('Invalid guest identity')
  const destination = `guest-${uid}`
  const seenSources = new Set<string>()
  const seenMessages = new Set<string>()
  const plan: HistoryCopy[] = []
  for (const source of sources) {
    if (!validId(source.id) || source.guestUid !== uid) throw new Error('Invalid source or guest ownership')
    if (seenSources.has(source.id)) throw new Error('Duplicate source')
    seenSources.add(source.id)
    if (source.id === destination) continue
    for (const message of source.messages) {
      if (!validId(message.id)) throw new Error('Invalid message identity')
      const identity = JSON.stringify([source.id, message.id])
      if (seenMessages.has(identity)) throw new Error('Duplicate source message')
      seenMessages.add(identity)
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
      plan.push({ sourceConversationId: source.id, sourceMessageId: message.id, destinationMessageId, attachment })
    }
  }
  return plan.sort((a, b) => a.sourceConversationId.localeCompare(b.sourceConversationId) || a.sourceMessageId.localeCompare(b.sourceMessageId))
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
