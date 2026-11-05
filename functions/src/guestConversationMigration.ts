// ----------------------------------------------------------------------------
// The guest-history migration, as a real Firestore/Storage adapter.
//
// One conversation per Guest account (`guest-<uid>`). Elsewhere in this
// repository, threads were filed per Booking or per topic, so a Guest with five
// bookings has six documents and nobody can see the whole correspondence. This
// module copies that history into the one thread.
//
// WHAT IT DOES NOT DO
//   - It deletes nothing. A superseded thread is annotated (`superseded_by`)
//     and left in place with its messages and private attachments intact, so
//     the migration is recoverable by construction and reversible by hand.
//   - It notifies nobody. Copies carry `migrated` / `migration` provenance, and
//     `evaluateGuestMessageCreated` refuses to push for anything carrying it.
//
// SAFETY, IN THE ORDER IT MATTERS
//   1. Dry-run is the default. Producing a plan writes nothing at all.
//   2. Applying takes a leased lock per Guest (`migration_runs/guest-<uid>`),
//      so two operators cannot fold the same history twice at once, and a
//      crashed worker's lock expires instead of blocking the work forever.
//   3. Every copy is idempotent on a destination id derived from the source
//      (`migrated-<sha256>`), so a retry lands on the same document.
//   4. A copy is never guessed: sender, role, text, original timestamp and
//      attachment metadata are all carried across, or the run fails.
// ----------------------------------------------------------------------------

import { createHash } from 'node:crypto'

import {
  guestConversationId,
  planGuestHistoryCopies,
  type HistoryCopy,
  type HistoryMessage,
  type HistorySource,
} from './chatHistoryPlan'

export type { HistoryCopy, HistoryMessage, HistorySource }

/** The collection the migration keeps its leases and audit trail in. */
export const MIGRATION_RUNS = 'migration_runs'
/** How long a worker may hold a Guest's lock without renewing it. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000

export type Logger = {
  info?(message: string, data?: Record<string, unknown>): void
  warn?(message: string, data?: Record<string, unknown>): void
  error?(message: string, data?: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// The shape of the stores this adapter talks to. Narrow on purpose: the
// migration needs a handful of operations, and naming them is what makes the
// whole thing testable without an emulator.
// ---------------------------------------------------------------------------

export type DocSnapshot = {
  id: string
  exists: boolean
  data: Record<string, unknown> | undefined
}

export type MessageDoc = {
  id: string
  data: Record<string, unknown>
}

export type ConversationsStore = {
  /** Every conversation document, or just one Guest's, for the audit. */
  listConversations(options?: { guestUid?: string }): Promise<readonly DocSnapshot[]>
  listMessages(convoId: string): Promise<readonly MessageDoc[]>
  getMessage(convoId: string, messageId: string): Promise<DocSnapshot>
  /**
   * Create the message, or verify the identical one is already there.
   * Returns `'created'` the first time and `'already-present'` on every retry.
   */
  createMessageIfAbsent(
    convoId: string,
    messageId: string,
    data: Record<string, unknown>,
  ): Promise<'created' | 'already-present'>
  /** Non-destructive annotation. Never deletes, never touches messages. */
  markSuperseded(convoId: string, supersededBy: string, at: unknown): Promise<void>
  /** Creates the canonical thread when it is missing, otherwise leaves it be. */
  ensureCanonicalConversation(
    convoId: string,
    data: Record<string, unknown>,
  ): Promise<'created' | 'already-present'>
  /**
   * Move the inbox preview to a copied message — but only when that message is
   * genuinely the newest thing in the thread, so a run over three-year-old
   * history cannot bury this morning's conversation at the top of the inbox.
   */
  touchConversation(
    convoId: string,
    patch: { last_message: string; updated_at: unknown },
  ): Promise<void>
}

export type StorageStore = {
  /** Copies the object unless the destination is already there, then verifies it. */
  copyAndVerify(input: {
    sourcePath: string
    destinationPath: string
    contentType: string
    size: number
  }): Promise<'copied' | 'already-present'>
}

export type MigrationRunStore = {
  get(uid: string): Promise<DocSnapshot>
  /**
   * Atomically take or renew the lease. False when somebody else still holds it.
   * `takeover` is the operator's `--resume`: it takes the lease even before it
   * has expired, which is the recovery path when a worker died holding it.
   */
  acquire(input: {
    uid: string
    owner: string
    conversationId: string
    leaseMs: number
    now: unknown
    planHash: string
    planned: number
    takeover?: boolean
  }): Promise<boolean>
  heartbeat(uid: string, owner: string, now: unknown, progress: Record<string, unknown>): Promise<void>
  complete(uid: string, owner: string, now: unknown, summary: Record<string, unknown>): Promise<void>
  fail(uid: string, owner: string, now: unknown, error: string): Promise<void>
}

export type MigrationStores = {
  conversations: ConversationsStore
  storage: StorageStore
  runs: MigrationRunStore
}

/**
 * The adapter's message rows arrive as `{ id, data }`. The planner works on the
 * document body itself, so the two are joined here — and only here — instead of
 * by a cast that would quietly hand the planner the wrong shape.
 */
function asHistoryMessages(rows: readonly MessageDoc[]): HistoryMessage[] {
  return rows.map((row) => ({ id: row.id, ...row.data }) as HistoryMessage)
}

// ---------------------------------------------------------------------------
// Audit — read every conversation structure and say what a run would do.
// ---------------------------------------------------------------------------

export type SourceAudit = {
  id: string
  bookingId: string | null
  messageCount: number
  attachmentCount: number
  supersededBy: string | null
}

export type HistoryAudit = {
  uid: string
  canonicalConversationId: string
  canonicalExists: boolean
  /** Threads a run would fold in. */
  sources: SourceAudit[]
  /** Threads a previous run already folded in; skipped. */
  alreadySuperseded: SourceAudit[]
  plannedCopies: number
  plannedAttachments: number
  /** Messages already inside the canonical thread. Left exactly as they are. */
  canonicalMessageCount: number
}

export type AuditReport = {
  guests: HistoryAudit[]
  /**
   * Documents that name no owner. Never touched and never guessed at: an
   * unattributable thread is reported, not merged into somebody's conversation.
   */
  orphans: Array<{ id: string; reason: string }>
  totals: {
    guests: number
    sourceThreads: number
    plannedCopies: number
    plannedAttachments: number
  }
}

function sourceAuditOf(source: HistorySource): SourceAudit {
  return {
    id: source.id,
    bookingId: source.bookingId ?? null,
    messageCount: source.messages.length,
    attachmentCount: source.messages.filter((message) => message.attachment != null).length,
    supersededBy: source.supersededBy ?? null,
  }
}

/**
 * Read the whole `conversations` collection and say what is there.
 *
 * Writes nothing. This is the first thing an operator runs, and the answer to
 * "how bad is it?" long before anything is changed.
 */
export async function auditGuestConversations(
  stores: Pick<MigrationStores, 'conversations'>,
  options: { uid?: string; logger?: Logger } = {},
): Promise<AuditReport> {
  const docs = await stores.conversations.listConversations(
    options.uid ? { guestUid: options.uid } : undefined,
  )

  const byOwner = new Map<string, HistorySource[]>()
  const canonicalExists = new Map<string, boolean>()
  const canonicalMessages = new Map<string, number>()
  const orphans: AuditReport['orphans'] = []

  for (const doc of docs) {
    if (!doc.exists) continue
    const data = doc.data ?? {}
    const owner = typeof data.guest_uid === 'string' ? data.guest_uid.trim() : ''

    if (!owner) {
      orphans.push({ id: doc.id, reason: 'no guest_uid' })
      continue
    }
    if (options.uid && owner !== options.uid) continue

    const canonicalId = guestConversationId(owner)
    let messages: readonly MessageDoc[] = []
    try {
      messages = await stores.conversations.listMessages(doc.id)
    } catch {
      messages = []
    }

    if (doc.id === canonicalId) {
      canonicalExists.set(owner, true)
      canonicalMessages.set(owner, messages.length)
      continue
    }

    byOwner.set(owner, [
      ...(byOwner.get(owner) ?? []),
      {
        id: doc.id,
        guestUid: owner,
        bookingId: typeof data.booking_id === 'string' ? data.booking_id.trim() || null : null,
        guestName: typeof data.guest_name === 'string' ? data.guest_name.trim() || null : null,
        messages: asHistoryMessages(messages),
        supersededBy: typeof data.superseded_by === 'string' ? data.superseded_by.trim() || null : null,
      },
    ])
  }

  const uids = [...new Set([...byOwner.keys(), ...canonicalExists.keys()])].sort()
  const guests: HistoryAudit[] = []

  for (const uid of uids) {
    const sources = byOwner.get(uid) ?? []
    const pending = sources.filter((source) => !source.supersededBy)
    const plan = planGuestHistoryCopies(uid, pending)
    guests.push({
      uid,
      canonicalConversationId: guestConversationId(uid),
      canonicalExists: canonicalExists.get(uid) === true,
      sources: pending.map(sourceAuditOf),
      alreadySuperseded: sources.filter((source) => Boolean(source.supersededBy)).map(sourceAuditOf),
      plannedCopies: plan.length,
      plannedAttachments: plan.filter((copy) => copy.attachment !== null).length,
      canonicalMessageCount: canonicalMessages.get(uid) ?? 0,
    })
  }

  return {
    guests,
    orphans,
    totals: {
      guests: guests.length,
      sourceThreads: guests.reduce((total, guest) => total + guest.sources.length, 0),
      plannedCopies: guests.reduce((total, guest) => total + guest.plannedCopies, 0),
      plannedAttachments: guests.reduce((total, guest) => total + guest.plannedAttachments, 0),
    },
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type MigrationRequest = {
  uid: string
  /** Produce the plan and the audit. Write nothing. The default, and the safe one. */
  dryRun?: boolean
  /** Take over a lease whose holder stopped renewing it. */
  resume?: boolean
  /** Identifies this worker while it holds the lease. */
  owner?: string
  leaseMs?: number
  logger?: Logger
  now?: () => unknown
}

export type MigrationStatus =
  | 'no-sources'
  | 'already-complete'
  | 'locked'
  | 'dry-run'
  | 'applied'
  | 'failed'

export type MigrationResult = {
  uid: string
  conversationId: string
  dryRun: boolean
  status: MigrationStatus
  planHash: string
  planned: number
  copied: number
  attachments: number
  superseded: string[]
  error?: string
}

function hashPlan(plan: readonly HistoryCopy[]): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 32)
}

function previewOf(text: unknown, hasAttachment: boolean): string {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value) return value.slice(0, 140)
  return hasAttachment ? 'Sent a photo' : ''
}

function newOwner(uid: string): string {
  return `worker-${createHash('sha256').update(`${uid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`
}

/**
 * Fold one Guest's history into their account conversation.
 *
 * Dry-run (the default) writes nothing — not even the lock. Applying takes a
 * lease, copies every message with its original sender, role, text, timestamp
 * and attachment, annotates each source thread as superseded, and marks the run
 * complete. Failing halfway leaves the lock held and the partial work in place;
 * the next run picks up exactly where it stopped, because every copy answers to
 * an id derived from its source.
 */
export async function runGuestHistoryMigration(
  stores: MigrationStores,
  request: MigrationRequest,
): Promise<MigrationResult> {
  const logger = request.logger ?? {}
  const now = request.now ?? (() => new Date())
  const dryRun = request.dryRun !== false
  const leaseMs = request.leaseMs ?? DEFAULT_LEASE_MS
  const uid = request.uid
  const conversationId = guestConversationId(uid)
  const owner = request.owner ?? newOwner(uid)

  // 1. Inventory. Reads only; the plan and the audit are both built from it.
  const sources = await listSourcesFor(stores, uid)

  if (sources.length === 0) {
    return emptyResult(uid, conversationId, dryRun, 'no-sources', hashPlan([]))
  }

  const plan = planGuestHistoryCopies(uid, sources)
  const planHash = hashPlan(plan)
  const plannedAttachments = plan.filter((copy) => copy.attachment !== null).length

  // 2. A dry run stops here — before the lock, before any write of any kind.
  if (dryRun) {
    return {
      uid,
      conversationId,
      dryRun: true,
      status: 'dry-run',
      planHash,
      planned: plan.length,
      copied: 0,
      attachments: plannedAttachments,
      superseded: [],
    }
  }

  // 3. The lease. A finished run with the same plan is simply not redone.
  const existing = await stores.runs.get(uid)
  if (existing.exists) {
    const data = existing.data ?? {}
    if (data.status === 'complete' && data.plan_hash === planHash) {
      return {
        uid,
        conversationId,
        dryRun: false,
        status: 'already-complete',
        planHash,
        planned: plan.length,
        copied: typeof data.copied === 'number' ? data.copied : plan.length,
        attachments: typeof data.attachments === 'number' ? data.attachments : 0,
        superseded: Array.isArray(data.superseded) ? (data.superseded as string[]) : [],
      }
    }
    if (data.status === 'running' && data.owner !== owner) {
      const expired = leaseExpired(data.lease_expires_at, now())
      if (!request.resume && !expired) {
        return {
          ...emptyResult(uid, conversationId, false, 'locked', planHash),
          planned: plan.length,
        }
      }
      logger.warn?.('[migration] taking over a lease', {
        uid,
        previousOwner: String(data.owner ?? 'unknown'),
        expired,
        resumed: request.resume === true,
      })
    }
  }

  const acquired = await stores.runs.acquire({
    uid,
    owner,
    conversationId,
    leaseMs,
    now: now(),
    planHash,
    planned: plan.length,
    takeover: request.resume === true,
  })
  if (!acquired) {
    return { ...emptyResult(uid, conversationId, false, 'locked', planHash), planned: plan.length }
  }

  // 4. Copy. Every step is idempotent, so a retry does the missing ones only.
  let copied = 0
  let attachments = 0
  try {
    await ensureCanonicalConversation(stores, uid, conversationId, sources, now())

    for (const [index, copy] of plan.entries()) {
      if (copy.attachment) {
        const outcome = await stores.storage.copyAndVerify(copy.attachment)
        if (outcome === 'copied') attachments += 1
      }
      const outcome = await copyMessage(stores, conversationId, copy, now(), owner)
      if (outcome === 'created') copied += 1
      if ((index + 1) % 25 === 0) {
        await stores.runs.heartbeat(uid, owner, now(), {
          copied,
          attachments,
          planned: plan.length,
        })
      }
    }

    // 5. Annotate the sources. The messages stay; only the thread is marked.
    const superseded: string[] = []
    const at = now()
    for (const id of [...new Set(plan.map((copy) => copy.sourceConversationId))].sort()) {
      await stores.conversations.markSuperseded(id, conversationId, at)
      superseded.push(id)
    }

    await stores.runs.complete(uid, owner, now(), {
      copied,
      attachments,
      planned: plan.length,
      superseded,
      planHash,
    })

    logger.info?.('[migration] complete', {
      uid,
      copied,
      attachments,
      superseded: superseded.length,
    })

    return {
      uid,
      conversationId,
      dryRun: false,
      status: 'applied',
      planHash,
      planned: plan.length,
      copied,
      attachments,
      superseded,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The lock is deliberately left in place: a half-finished run must not look
    // finished, and the next attempt resumes rather than starting over.
    await stores.runs.fail(uid, owner, now(), message).catch(() => undefined)
    logger.error?.('[migration] failed', { uid, owner, message })
    return {
      uid,
      conversationId,
      dryRun: false,
      status: 'failed',
      planHash,
      planned: plan.length,
      copied,
      attachments,
      superseded: [],
      error: message,
    }
  }
}

function emptyResult(
  uid: string,
  conversationId: string,
  dryRun: boolean,
  status: MigrationStatus,
  planHash: string,
): MigrationResult {
  return {
    uid,
    conversationId,
    dryRun,
    status,
    planHash,
    planned: 0,
    copied: 0,
    attachments: 0,
    superseded: [],
  }
}

function leaseExpired(leaseExpiresAt: unknown, now: unknown): boolean {
  const expires = timestampMs(leaseExpiresAt)
  const current = timestampMs(now)
  if (expires === null || current === null) return true
  return expires <= current
}

function timestampMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const record = value as { toMillis?: () => number; seconds?: number }
    if (typeof record.toMillis === 'function') return record.toMillis()
    if (typeof record.seconds === 'number') return record.seconds * 1000
  }
  return null
}

/**
 * Every thread this Guest has that is not the canonical one.
 *
 * Superseded threads are included on purpose. The plan has to be identical on a
 * retry to what it was on the first attempt — that is what makes `planHash` a
 * meaningful "you have already done this, here is the count" — and a superseded
 * thread can still receive a message from an app version that predates the
 * unification, which a resumed run then picks up. Copying one again costs
 * nothing: every copy answers to an id derived from its source, so a re-run
 * verifies instead of duplicating.
 */
async function listSourcesFor(stores: MigrationStores, uid: string): Promise<HistorySource[]> {
  const docs = await stores.conversations.listConversations({ guestUid: uid })
  const canonicalId = guestConversationId(uid)
  const sources: HistorySource[] = []
  for (const doc of docs) {
    if (!doc.exists || doc.id === canonicalId) continue
    const data = doc.data ?? {}
    const owner = typeof data.guest_uid === 'string' ? data.guest_uid.trim() : ''
    if (owner !== uid) continue
    const messages = await stores.conversations.listMessages(doc.id)
    sources.push({
      id: doc.id,
      guestUid: owner,
      bookingId: typeof data.booking_id === 'string' ? data.booking_id.trim() || null : null,
      guestName: typeof data.guest_name === 'string' ? data.guest_name.trim() || null : null,
      messages: asHistoryMessages(messages),
      supersededBy: null,
    })
  }
  return sources.sort((a, b) => a.id.localeCompare(b.id))
}

async function ensureCanonicalConversation(
  stores: MigrationStores,
  uid: string,
  conversationId: string,
  sources: readonly HistorySource[],
  at: unknown,
): Promise<void> {
  const names = sources
    .map((source) => source.guestName)
    .filter((name): name is string => Boolean(name) && name !== 'Guest')
  const guestName = names[0] ?? sources.find((source) => source.guestName)?.guestName ?? 'Guest'
  await stores.conversations.ensureCanonicalConversation(conversationId, {
    guest_uid: uid,
    guest_name: guestName,
    category: 'booking',
    created_at: at,
    updated_at: at,
    last_message: '',
    unread_admin: 0,
    unread_guest: 0,
  })
}

/**
 * Copy one message, preserving everything it is.
 *
 * Refuses rather than guesses: a message with no sender, no role, no text or no
 * timestamp cannot be reproduced faithfully, and a mangled copy of a Guest's
 * own words is worse than a failed run that can be retried.
 */
async function copyMessage(
  stores: MigrationStores,
  conversationId: string,
  copy: HistoryCopy,
  at: unknown,
  owner: string,
): Promise<'created' | 'already-present'> {
  const source = await stores.conversations.getMessage(copy.sourceConversationId, copy.sourceMessageId)
  if (!source.exists || !source.data) {
    throw new Error(`Source message disappeared: ${copy.sourceConversationId}/${copy.sourceMessageId}`)
  }
  const data = source.data
  const senderUid = typeof data.sender_uid === 'string' ? data.sender_uid.trim() : ''
  const senderRole = data.sender_role === 'admin' ? 'admin' : data.sender_role === 'guest' ? 'guest' : ''
  const text = typeof data.text === 'string' ? data.text : ''
  const createdAt = data.created_at

  if (!senderUid) throw new Error(`Source message has no sender_uid: ${copy.sourceMessageId}`)
  if (!senderRole) throw new Error(`Source message has an unknown sender_role: ${copy.sourceMessageId}`)
  if (text.length > 1000) {
    throw new Error(`Source message exceeds the 1,000-character limit: ${copy.sourceMessageId}`)
  }
  if (createdAt == null) throw new Error(`Source message has no created_at: ${copy.sourceMessageId}`)

  const payload: Record<string, unknown> = {
    sender_uid: senderUid,
    sender_role: senderRole,
    text,
    // The original timestamp, not the moment of copying: history keeps the
    // order it was written in, and the Admin sees when a thing was really said.
    created_at: createdAt,
    ...(copy.bookingId ? { booking_id: copy.bookingId } : {}),
    ...(copy.attachment
      ? {
          attachment: {
            path: copy.attachment.destinationPath,
            content_type: copy.attachment.contentType,
            size: copy.attachment.size,
          },
        }
      : {}),
    // Provenance. This is what stops the notification trigger waking the Admin
    // up once for every message of the last three years.
    migrated: true,
    migration: {
      source_conversation_id: copy.sourceConversationId,
      source_message_id: copy.sourceMessageId,
      migrated_at: at,
      run_id: owner,
    },
  }

  const outcome = await stores.conversations.createMessageIfAbsent(
    conversationId,
    copy.destinationMessageId,
    payload,
  )

  // The inbox preview and its ordering are the ONLY conversation fields the run
  // touches. Never the unread counters: a copy is not something unread.
  if (outcome === 'created') {
    await stores.conversations.touchConversation(conversationId, {
      last_message: previewOf(text, copy.attachment !== null),
      updated_at: createdAt,
    })
  }
  return outcome
}
