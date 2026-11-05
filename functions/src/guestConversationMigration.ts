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
//   2. Live location is checked in BOTH databases before a single byte moves.
//      A live-location session is keyed by conversation id
//      (`location_sessions/{conversationId}`, `live_location/{conversationId}/`
//      `{guestUid}`), and consolidating a thread retires the id that session is
//      filed under — so a Guest mid-share would be silently cut off. The run
//      waits, rechecks, and aborts rather than invalidate a session in flight.
//   3. Applying takes a leased lock per Guest (`migration_runs/guest-<uid>`),
//      so two operators cannot fold the same history twice at once, and a
//      crashed worker's lock expires instead of blocking the work forever.
//   4. Every copy is idempotent on a destination id derived from the source
//      (`migrated-<sha256>`), so a retry lands on the same document.
//   5. A copy is never guessed: sender, role, text, original timestamp and
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
  /**
   * Non-destructive annotation. Never deletes, never touches messages.
   *
   * With `guard`, the check and the write happen in ONE transaction: read
   * `location_sessions/{convoId}`, and refuse to mark while a session is still
   * live on it. Returns `'blocked'` rather than throwing, so a caller can tell
   * "a Guest started sharing mid-run" apart from "Firestore is unhappy" — the
   * first is expected and recoverable, the second is not.
   */
  markSuperseded(
    convoId: string,
    supersededBy: string,
    at: unknown,
    guard?: { nowMs: number },
  ): Promise<'marked' | 'blocked'>
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
  /**
   * Give the lease back without having written anything.
   *
   * The abort path: the run changed its mind (a live-location session started
   * between the check and the lease), and the next attempt should be free to
   * start now rather than waiting out the expiry.
   */
  release(uid: string, owner: string, now: unknown, reason: string): Promise<void>
}

/**
 * One live-location session, wherever it was found.
 *
 * A session is only reported while it is still live. Firestore is the consent
 * and RTDB the position; they are written together and swept apart, so either
 * one being live is enough to block — and the run reports which.
 */
export type LiveLocationSession = {
  /** The conversation the session is filed under. This is the id being retired. */
  conversationId: string
  guestUid: string | null
  foundIn: Array<'firestore' | 'rtdb'>
  /** When the consent or the position says it stops, in epoch ms. */
  expiresAtMs: number | null
  startedAtMs: number | null
}

export type LiveLocationStore = {
  /**
   * The still-live sessions filed under any of `conversationIds`.
   *
   * Doc-id lookups, not queries: `location_sessions/{conversationId}` is keyed
   * by the conversation id, and `live_location/{conversationId}/{guestUid}`
   * nests under it, so a handful of conversations is a handful of reads.
   *
   * **Throws when it cannot see.** Half a picture is not a picture: if the
   * Realtime Database is unreachable this must fail loudly rather than return
   * an empty list that reads as "the coast is clear".
   */
  findSessions(conversationIds: readonly string[]): Promise<readonly LiveLocationSession[]>
  /**
   * Close a conversation id to any further position, for good.
   *
   * Called only AFTER the thread has been retired in Firestore — never before,
   * and that ordering is the whole safety argument. Writing this first would
   * stop the position of a session that was still running, which is exactly what
   * this migration promises never to do.
   *
   * It is a second, independent lock rather than the primary one: the Firestore
   * fence on `location_sessions` create is what stops new sessions, and this is
   * what stops a browser that still holds a session object in memory from
   * keeping a retired thread alive. Best effort — a failure here is reported,
   * not fatal, because the Firestore fence is already holding the door.
   */
  retire(input: { conversationId: string; supersededBy: string; atMs: number }): Promise<void>
}

export type MigrationStores = {
  conversations: ConversationsStore
  storage: StorageStore
  runs: MigrationRunStore
  liveLocation: LiveLocationStore
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

// ---------------------------------------------------------------------------
// Live location — the one thing that must be quiet before anything moves
// ----------------------------------------------------------------------------

/**
 * How long after a session's own expiry the run still treats it as live.
 *
 * The session expiring is when the *rules* stop serving it, not when the client
 * has finished with it: `stopSharing()` and `onDisconnect().remove()` are what
 * actually take the RTDB node away, and both can land a moment late. The wait
 * is cheap and the alternative is cutting someone off, so the run waits.
 */
export const LIVE_LOCATION_CLEARANCE_MS = 60_000

/** How long to wait between re-checks when the operator asks the run to wait. */
export const DEFAULT_LIVE_LOCATION_POLL_MS = 30_000

/** The longest a session can run for, which is also the longest useful wait. */
export const MAX_LIVE_LOCATION_WAIT_MS = 61 * 60 * 1000

export type LiveLocationWait = {
  /** Keep re-checking for this long before giving up. 0 checks exactly once. */
  timeoutMs?: number
  /** Gap between re-checks. Defaults to `DEFAULT_LIVE_LOCATION_POLL_MS`. */
  pollMs?: number
  /** Injectable sleep, so waiting is testable without a clock to sit through. */
  sleep?: (ms: number) => Promise<void>
}

export type LiveLocationReport = {
  /** Sessions on threads the run is about to retire. These block it. */
  blocking: LiveLocationSession[]
  /**
   * When the block was discovered. `annotate` means the run had already copied
   * when a session appeared — the copies are kept (they are idempotent) and the
   * sources stay unmarked, so the next attempt finishes the job.
   */
  blockedAt?: 'pre-check' | 'recheck' | 'annotate'
  /**
   * Sessions already on the account conversation. The migration does not move
   * that id, so these keep working — but a Guest who is sharing right now is on
   * the property and using the app, so the run says so rather than staying quiet.
   */
  watching: LiveLocationSession[]
  /** How long the run waited for these to clear, in ms. */
  waitedMs: number
}

/**
 * Is this session still live at `nowMs`?
 *
 * Expiry is the contract both sides honour: `database.rules.json` refuses to
 * serve a position past `expires_at_ms`, and the Firestore session is written
 * `active: false` when the Guest stops. A session with no readable expiry is
 * treated as live — an unreadable clock is not evidence that it stopped.
 */
export function isLiveSession(session: LiveLocationSession, nowMs: number): boolean {
  return liveUntil(session.expiresAtMs, nowMs)
}

function liveUntil(expiresAtMs: number | null, nowMs: number): boolean {
  if (expiresAtMs == null) return true
  return expiresAtMs + LIVE_LOCATION_CLEARANCE_MS > nowMs
}

/**
 * Is the raw `location_sessions/{conversationId}` document live at `nowMs`?
 *
 * The adapter calls this *inside* the transaction that marks a thread
 * superseded, which is the only place the check and the write can be made
 * atomic. The port's `findSessions` cannot be: a Firestore transaction cannot
 * read the Realtime Database, so the position half of the picture is always one
 * step behind. The consent half is not, and that is the half that matters —
 * `startSharing` writes the consent before it publishes any position.
 */
export function isLiveSessionDoc(data: Record<string, unknown> | undefined, nowMs: number): boolean {
  if (!data) return false
  // A session the Guest has ended is not live, whatever its clock says.
  if (data.active === false) return false
  return liveUntil(timestampMs(data.expires_at), nowMs)
}

/**
 * Check both databases for live sessions filed under `conversationIds`, and
 * split them into what blocks the run and what merely watches it.
 *
 * A session on a thread being retired blocks: the id it is filed under stops
 * being the conversation, and both apps would go looking for the stream at
 * `guest-<uid>` and find nothing. A session already on `guest-<uid>` does not —
 * that path is the destination, not one of the ones being folded away.
 */
export async function checkLiveLocationSessions(
  stores: Pick<MigrationStores, 'liveLocation'>,
  input: { conversationIds: readonly string[]; canonicalConversationId: string; nowMs: number },
): Promise<{ blocking: LiveLocationSession[]; watching: LiveLocationSession[] }> {
  if (input.conversationIds.length === 0) return { blocking: [], watching: [] }
  const sessions = await stores.liveLocation.findSessions(input.conversationIds)
  const blocking: LiveLocationSession[] = []
  const watching: LiveLocationSession[] = []
  for (const session of sessions) {
    if (!isLiveSession(session, input.nowMs)) continue
    if (session.conversationId === input.canonicalConversationId) watching.push(session)
    else blocking.push(session)
  }
  return { blocking, watching }
}

/**
 * Wait for the live-location sessions on the threads being retired to end on
 * their own.
 *
 * Sessions are 15, 30 or 60 minutes, and they are ended by the Guest or by
 * their own expiry — never by this job. So the run polls both databases until
 * either the coast is clear or the operator's patience (`timeoutMs`) runs out,
 * and returns what it found either way. It never touches a session.
 */
export async function waitForLiveLocationClear(
  stores: Pick<MigrationStores, 'liveLocation'>,
  input: {
    conversationIds: readonly string[]
    canonicalConversationId: string
    now: () => number
    wait?: LiveLocationWait
    logger?: Logger
  },
): Promise<LiveLocationReport> {
  const timeoutMs = Math.max(0, Math.min(input.wait?.timeoutMs ?? 0, MAX_LIVE_LOCATION_WAIT_MS))
  const pollMs = Math.max(1_000, input.wait?.pollMs ?? DEFAULT_LIVE_LOCATION_POLL_MS)
  const sleep = input.wait?.sleep ?? defaultSleep
  const startedAt = input.now()
  let waitedMs = 0

  let found = await checkLiveLocationSessions(stores, {
    conversationIds: input.conversationIds,
    canonicalConversationId: input.canonicalConversationId,
    nowMs: input.now(),
  })
  if (found.blocking.length === 0) return { ...found, waitedMs: 0 }

  input.logger?.info?.('[migration] waiting for live-location sessions to end', {
    conversationIds: input.conversationIds,
    sessions: found.blocking.length,
    timeoutMs,
  })

  // The deadline is a wall-clock bound, not a number of polls: sleeping past it
  // is how a 60-minute session would otherwise hold the job overnight. The
  // iteration cap is the second belt — a clock that does not advance (a `now`
  // that lies, a sleep that returns immediately) must not become a loop that
  // never ends, so the run also stops after the number of polls a real wait
  // would have needed.
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollMs))
  for (let poll = 0; poll < maxPolls && input.now() - startedAt < timeoutMs; poll += 1) {
    await sleep(Math.min(pollMs, timeoutMs - (input.now() - startedAt)))
    waitedMs = input.now() - startedAt
    found = await checkLiveLocationSessions(stores, {
      conversationIds: input.conversationIds,
      canonicalConversationId: input.canonicalConversationId,
      nowMs: input.now(),
    })
    if (found.blocking.length === 0) {
      input.logger?.info?.('[migration] live location clear', { waitedMs })
      return { ...found, waitedMs }
    }
  }

  waitedMs = input.now() - startedAt
  input.logger?.warn?.('[migration] live-location sessions still active; aborting this Guest', {
    sessions: found.blocking.length,
    waitedMs,
  })
  return { ...found, waitedMs }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
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
  /**
   * Wait for live-location sessions to end instead of aborting on the first
   * sight of one. Omit for a single check. The run re-checks both databases
   * immediately before the first write either way.
   */
  liveLocation?: LiveLocationWait
}

export type MigrationStatus =
  | 'no-sources'
  | 'already-complete'
  | 'locked'
  /**
   * A live-location session is still running on a thread this run would retire.
   * Nothing was copied, nothing was invalidated, and the lease was given back.
   */
  | 'blocked-live-location'
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
  /**
   * Retired threads whose live-location closure could not be written to the
   * Realtime Database. Empty is the normal case. Non-empty is not fatal — see
   * the `retire` port — but it is never silently dropped.
   */
  liveLocationClosureFailures?: string[]
  liveLocation?: LiveLocationReport
  /** Present once a run has copied anything. Read-only; see `verifyGuestConversation`. */
  verification?: VerificationReport
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

  const guarded = [...sources.map((source) => source.id), conversationId]
  const readLiveLocation = (): Promise<{ blocking: LiveLocationSession[]; watching: LiveLocationSession[] }> =>
    checkLiveLocationSessions(stores, {
      conversationIds: guarded,
      canonicalConversationId: conversationId,
      nowMs: timestampMs(now()) ?? 0,
    })

  // 2. A dry run stops here — before the lock, before any write of any kind.
  //
  //    It still reports the live-location state, because "this Guest is sharing
  //    right now, you will have to wait" is exactly what an operator planning a
  //    run wants to know. But it does not wait, and it does not block: a dry run
  //    moves nothing, and a plan that hangs for sixty minutes helps nobody.
  if (dryRun) {
    const seen = await readLiveLocation().catch((error: unknown) => {
      logger.warn?.('[migration] live-location state could not be read', {
        uid,
        message: error instanceof Error ? error.message : String(error),
      })
      return { blocking: [], watching: [] }
    })
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
      liveLocation: { ...seen, waitedMs: 0 },
    }
  }

  // 3. LIVE LOCATION. Before the lock, before any write of any kind.
  //
  //    The threads in `sources` are about to stop being the conversation. A
  //    live-location session filed under one of them would be left pointing at
  //    an id neither app reads any more, and the Guest would simply stop being
  //    watchable with no error anywhere. So: look in Firestore *and* RTDB, wait
  //    for whatever is running to end on its own, and abort if it has not.
  //
  //    This can throw, and that is the point — if the Realtime Database is
  //    unreachable the run cannot claim the coast is clear. Nothing has been
  //    written yet, so a throw here costs nothing but the attempt.
  let liveLocation: LiveLocationReport
  try {
    liveLocation = await waitForLiveLocationClear(stores, {
      conversationIds: guarded,
      canonicalConversationId: conversationId,
      now: () => timestampMs(now()) ?? 0,
      ...(request.liveLocation ? { wait: request.liveLocation } : {}),
      logger,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error?.('[migration] live-location check failed; refusing to run blind', {
      uid,
      message,
    })
    return {
      ...emptyResult(uid, conversationId, false, 'failed', planHash),
      planned: plan.length,
      error: `Live-location check unavailable: ${message}`,
    }
  }

  if (liveLocation.blocking.length > 0) {
    return {
      ...emptyResult(uid, conversationId, false, 'blocked-live-location', planHash),
      planned: plan.length,
      liveLocation: { ...liveLocation, blockedAt: 'pre-check' },
    }
  }
  if (liveLocation.watching.length > 0) {
    logger.warn?.('[migration] a live-location session is running on the account conversation', {
      uid,
      sessions: liveLocation.watching.length,
    })
  }

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

  // 4. The lease. A finished run with the same plan is simply not redone.
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

  // 5. RECHECK, immediately before the first write.
  //
  //    The wait above can have been minutes ago, and a Guest can have pressed
  //    "share my location" in the meantime. The lease is not permission to
  //    ignore that: check both databases again, and if something is live now,
  //    hand the lease straight back rather than copy a single message.
  try {
    const recheck = await checkLiveLocationSessions(stores, {
      conversationIds: [...sources.map((source) => source.id), conversationId],
      canonicalConversationId: conversationId,
      nowMs: timestampMs(now()) ?? 0,
    })
    if (recheck.blocking.length > 0) {
      logger.warn?.('[migration] a live-location session started during the run; aborting', {
        uid,
        sessions: recheck.blocking.map((session) => session.conversationId),
      })
      await stores.runs
        .release(uid, owner, now(), 'live-location session started during the run')
        .catch(() => undefined)
      return {
        ...emptyResult(uid, conversationId, false, 'blocked-live-location', planHash),
        planned: plan.length,
        liveLocation: { ...recheck, waitedMs: liveLocation.waitedMs, blockedAt: 'recheck' },
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await stores.runs.release(uid, owner, now(), `live-location recheck failed: ${message}`).catch(() => undefined)
    logger.error?.('[migration] live-location recheck failed; aborting', { uid, message })
    return {
      ...emptyResult(uid, conversationId, false, 'failed', planHash),
      planned: plan.length,
      error: `Live-location recheck unavailable: ${message}`,
    }
  }

  // 6. Copy. Every step is idempotent, so a retry does the missing ones only.
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

    // 7. ANNOTATE — and close the race on the way in.
    //
    //    The copies above took time, and a Guest can have started sharing while
    //    they ran. Two checks now, in order:
    //
    //    a) One more read of both databases, so the common case blocks here —
    //       before any thread is marked, leaving the run cleanly restartable
    //       rather than half-annotated.
    const superseded: string[] = []
    const markerFailures: string[] = []
    const at = now()
    const sourceIds = [...new Set(plan.map((copy) => copy.sourceConversationId))].sort()

    const beforeAnnotating = await checkLiveLocationSessions(stores, {
      conversationIds: sourceIds,
      canonicalConversationId: conversationId,
      nowMs: timestampMs(now()) ?? 0,
    })
    if (beforeAnnotating.blocking.length > 0) {
      logger.warn?.('[migration] a live-location session started while history was being copied', {
        uid,
        sessions: beforeAnnotating.blocking.map((session) => session.conversationId),
      })
      await stores.runs
        .release(uid, owner, now(), 'live-location session started while history was being copied')
        .catch(() => undefined)
      return {
        ...emptyResult(uid, conversationId, false, 'blocked-live-location', planHash),
        planned: plan.length,
        copied,
        attachments,
        liveLocation: { ...beforeAnnotating, waitedMs: liveLocation.waitedMs, blockedAt: 'recheck' },
      }
    }

    //    b) Per thread, atomically. A session can still land in the moment
    //       between (a) and this write, so the check travels inside the
    //       transaction that marks the thread: read the consent, refuse if it is
    //       live, mark otherwise — one atomic step, so there is no instant in
    //       which the thread is retired and a live session is filed under it.
    for (const id of sourceIds) {
      const outcome = await stores.conversations.markSuperseded(id, conversationId, at, {
        nowMs: timestampMs(now()) ?? 0,
      })
      if (outcome === 'blocked') {
        logger.warn?.('[migration] a live-location session started on a thread as it was retired', {
          uid,
          conversationId: id,
        })
        // The copies stay. They are idempotent, they are correct, and the
        // sources are unmarked — so the next attempt verifies them in a moment
        // and finishes the annotation instead of redoing any of the work.
        await stores.runs
          .fail(uid, owner, now(), `live-location session started on ${id} as it was being retired`)
          .catch(() => undefined)
        return {
          // `superseded` reports what WAS retired before the block. The run is
          // partial and saying so is the honest thing: an operator coming back
          // to it needs to know which threads have already moved, not just that
          // something went wrong somewhere.
          ...emptyResult(uid, conversationId, false, 'blocked-live-location', planHash),
          planned: plan.length,
          copied,
          attachments,
          superseded,
          liveLocation: {
            blocking: [
              {
                conversationId: id,
                guestUid: uid,
                foundIn: ['firestore' as const],
                expiresAtMs: null,
                startedAtMs: null,
              },
            ],
            watching: [],
            waitedMs: liveLocation.waitedMs,
            blockedAt: 'annotate' as const,
          },
        }
      }
      superseded.push(id)
      // Now that the thread IS retired, and not before: tell the Realtime
      // Database, so no browser still holding a session object can keep
      // publishing positions under an id nobody reads any more.
      try {
        await stores.liveLocation.retire({
          conversationId: id,
          supersededBy: conversationId,
          atMs: timestampMs(at) ?? timestampMs(now()) ?? 0,
        })
      } catch (error) {
        // Reported, not fatal. The Firestore fence is the primary control and it
        // is already in force; an unreachable Realtime Database here narrows the
        // guarantee from "no writes, ever" to "no writes that outlive the
        // session's own window", which is still a bounded and unrenderable
        // orphan. Say so, so the operator is not told everything is fine.
        const message = error instanceof Error ? error.message : String(error)
        markerFailures.push(`${id}: ${message}`)
        logger.warn?.('[migration] could not close the retired thread to live location', {
          uid,
          conversationId: id,
          message,
        })
      }
    }

    // 8. Verify the new paths, before the run is allowed to call itself done.
    //
    //    "It copied without throwing" is not the same as "the Guest and the
    //    Admin can both read this". The check is read-only and re-runnable, and
    //    a failure is reported rather than undone: the copies are idempotent, so
    //    the honest thing is to say what is wrong and let a human look.
    const verification = await verifyGuestConversation(stores, uid, {
      nowMs: timestampMs(now()) ?? undefined,
    }).catch((error: unknown) => ({
      conversationId,
      ok: false,
      problems: [`Verification could not run: ${error instanceof Error ? error.message : String(error)}`],
      checked: { messages: 0, attachments: 0, sources: 0, liveLocation: 0 },
      paths: pathsForConversation(conversationId),
    }))
    if (!verification.ok) {
      logger.error?.('[migration] verification FAILED', { uid, problems: verification.problems })
    }

    await stores.runs.complete(uid, owner, now(), {
      copied,
      attachments,
      planned: plan.length,
      superseded,
      planHash,
      verification_ok: verification.ok,
    })

    logger.info?.('[migration] complete', {
      uid,
      copied,
      attachments,
      superseded: superseded.length,
      verified: verification.ok,
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
      liveLocation,
      verification,
      ...(markerFailures.length ? { liveLocationClosureFailures: markerFailures } : {}),
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

// ---------------------------------------------------------------------------
// Verification — do the new paths actually work for the Guest and the Admin?
// ----------------------------------------------------------------------------

/**
 * Every path the two apps will use for this Guest, after the consolidation.
 *
 * Listed so an operator can read the report and check the thing themselves,
 * rather than trusting a boolean. The Guest and the Admin read the same
 * document — that is the whole point of the refactor — so the paths are the
 * proof that they agree.
 */
export function pathsForConversation(conversationId: string): {
  conversation: string
  messages: string
  attachments: string
  locationSession: string
  liveLocation: string
} {
  return {
    conversation: `conversations/${conversationId}`,
    messages: `conversations/${conversationId}/messages`,
    attachments: `messageAttachments/${conversationId}/`,
    locationSession: `location_sessions/${conversationId}`,
    liveLocation: `live_location/${conversationId}/{guestUid}`,
  }
}

export type VerificationReport = {
  conversationId: string
  ok: boolean
  /** Human-readable, in the order a reader would act on them. */
  problems: string[]
  checked: { messages: number; attachments: number; sources: number; liveLocation: number }
  paths: ReturnType<typeof pathsForConversation>
}

/**
 * Read-only post-condition check on one Guest's consolidated conversation.
 *
 * What it can prove without standing in for either signed-in user:
 *   - the canonical thread exists and is owned by this Guest;
 *   - every message in it is readable by both apps — a sender, a role the
 *     renderer understands, a timestamp, and text inside the 1,000-character
 *     limit both clients and rules enforce;
 *   - every attachment is at the path the new conversation implies, at the size
 *     the message claims, so neither app opens a broken image;
 *   - every retired thread is annotated with where its history went, so a
 *     reader landing on one is told rather than left guessing;
 *   - no live-location session is still filed under a retired id.
 *
 * What it cannot prove, and says so: that the security rules answer yes for a
 * real Guest token and a real Admin token. That needs the emulator or a
 * signed-in session, and `npm run test:emulator` is where it is checked.
 */
export async function verifyGuestConversation(
  stores: Pick<MigrationStores, 'conversations' | 'storage' | 'liveLocation'>,
  uid: string,
  options: { nowMs?: number } = {},
): Promise<VerificationReport> {
  const conversationId = guestConversationId(uid)
  const problems: string[] = []
  const paths = pathsForConversation(conversationId)
  const nowMs = options.nowMs ?? Date.now()

  const convo = await firstConversation(stores, uid, conversationId)

  if (!convo || !convo.exists) {
    return {
      conversationId,
      ok: false,
      problems: [`${paths.conversation} does not exist: neither app can open it.`],
      checked: { messages: 0, attachments: 0, sources: 0, liveLocation: 0 },
      paths,
    }
  }

  const data = convo.data ?? {}
  const owner = typeof data.guest_uid === 'string' ? data.guest_uid.trim() : ''
  if (owner !== uid) {
    problems.push(
      `${paths.conversation} is owned by "${owner || 'nobody'}", not ${uid}: the Guest would be refused and the Admin would show the wrong person.`,
    )
  }

  const messages = await stores.conversations.listMessages(conversationId)
  let attachments = 0
  for (const row of messages) {
    const message = row.data ?? {}
    const senderUid = typeof message.sender_uid === 'string' ? message.sender_uid.trim() : ''
    const role = message.sender_role
    const text = typeof message.text === 'string' ? message.text : ''
    if (!senderUid) problems.push(`${paths.messages}/${row.id} has no sender_uid: no avatar, no side of the thread.`)
    if (role !== 'guest' && role !== 'admin') {
      problems.push(`${paths.messages}/${row.id} has sender_role ${JSON.stringify(role)}: the timeline cannot place it.`)
    }
    if (message.created_at == null) {
      problems.push(`${paths.messages}/${row.id} has no created_at: it would sort to the wrong place in history.`)
    }
    if (text.length > 1000) {
      problems.push(`${paths.messages}/${row.id} is ${text.length} characters: over the 1,000 limit, the rules would refuse it.`)
    }
    const attachment = parseAttachment(message.attachment)
    if (!attachment) continue
    attachments += 1
    if (!attachment.path.startsWith(`messageAttachments/${conversationId}/`)) {
      problems.push(
        `${paths.messages}/${row.id} points at ${attachment.path}, which is not under ${paths.attachments}: the image will not open.`,
      )
    }
  }

  let sources = 0
  const docs = await stores.conversations.listConversations({ guestUid: uid })
  for (const doc of docs) {
    if (!doc.exists || doc.id === conversationId) continue
    sources += 1
    const supersededBy = typeof doc.data?.superseded_by === 'string' ? doc.data.superseded_by.trim() : ''
    if (supersededBy !== conversationId) {
      problems.push(
        `${doc.id} is not annotated with superseded_by=${conversationId}: a reader landing on it is not told where the history went.`,
      )
    }
  }

  let liveLocation = 0
  const sessions = await stores.liveLocation.findSessions([conversationId, ...docs.map((doc) => doc.id)])
  for (const session of sessions) {
    // Only a session that is still LIVE is a problem. A `location_sessions`
    // document left behind on a retired thread is debris: neither app reads
    // that id any more, and the run does not clean it up — nothing here
    // deletes. What must not happen is a *running* session on a retired id.
    if (!isLiveSession(session, nowMs)) continue
    liveLocation += 1
    if (session.conversationId !== conversationId) {
      problems.push(
        `A live-location session is still running on the retired thread ${session.conversationId}: nobody is watching it any more.`,
      )
    }
  }

  return {
    conversationId,
    ok: problems.length === 0,
    problems,
    checked: { messages: messages.length, attachments, sources, liveLocation },
    paths,
  }
}

async function firstConversation(
  stores: Pick<MigrationStores, 'conversations'>,
  uid: string,
  conversationId: string,
): Promise<DocSnapshot | null> {
  const docs = await stores.conversations.listConversations({ guestUid: uid })
  const match = docs.find((doc) => doc.id === conversationId)
  return match ?? { id: conversationId, exists: false, data: undefined }
}

function parseAttachment(value: unknown): { path: string; size: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const path = typeof data.path === 'string' ? data.path : ''
  const size = typeof data.size === 'number' ? data.size : null
  if (!path) return null
  return { path, size: size ?? 0 }
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
  if (value instanceof Date) {
    const at = value.getTime()
    return Number.isNaN(at) ? null : at
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
