// ----------------------------------------------------------------------------
// The guest-history migration, held to the promises it makes:
//
//   - an audit and a dry run write nothing at all;
//   - a copy keeps its sender, role, text, timestamp and booking context;
//   - NOTHING is deleted, ever — sources are annotated, not removed;
//   - a retry duplicates no message and re-notifies nobody;
//   - a crash leaves the work resumable, not half-done and reported finished;
//   - history does not wake the Admin up.
// ----------------------------------------------------------------------------
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  DEFAULT_LEASE_MS,
  LIVE_LOCATION_CLEARANCE_MS,
  auditGuestConversations,
  isLiveSession,
  isLiveSessionDoc,
  pathsForConversation,
  runGuestHistoryMigration,
  verifyGuestConversation,
  type ConversationsStore,
  type DocSnapshot,
  type LiveLocationSession,
  type LiveLocationStore,
  type MessageDoc,
  type MigrationRunStore,
  type MigrationStores,
  type StorageStore,
} from '../src/guestConversationMigration'
import { evaluateGuestMessageCreated } from '../src/notifications'

// ---------------------------------------------------------------------------
// An in-memory double of the three ports. It records every write so a test can
// assert on "nothing was written" rather than infer it.
// ---------------------------------------------------------------------------

type Audit = { writes: string[] }

function createStores(seed: {
  conversations?: Array<{ id: string; data: Record<string, unknown> }>
  messages?: Record<string, Array<{ id: string; data: Record<string, unknown> }>>
  objects?: Record<string, { contentType: string; size: number }>
  /**
   * Substrings that throw once, to model a crash mid-run. Substrings because a
   * destination id is a hash: a test wants "the first attachment copy" without
   * having to know which one that is.
   */
  failOnce?: string[]
  /**
   * Live-location sessions the double should report. `unobservable` models a
   * Realtime Database the job cannot reach — the case that must fail loudly
   * rather than read as an empty coast.
   */
  liveLocation?: Array<Partial<LiveLocationSession> & { conversationId: string; active?: boolean }>
  liveLocationUnobservable?: boolean
  /** Appended to the session list on the second and later reads. */
  liveLocationAfter?: Array<Partial<LiveLocationSession> & { conversationId: string }>
  /**
   * Model a Guest pressing "share my location" WHILE the run is copying: the
   * session document appears after this many writes, which is exactly the race
   * the annotate-time guard exists for.
   */
  startSessionAtWrite?: { after: number; conversationId: string; expiresAtMs: number }
  /**
   * Model the final instant: the session lands after the pre-annotate read has
   * already reported clear, but before the thread is retired. Only the
   * per-thread transaction can catch this one.
   */
  startSessionOnAnnotate?: { conversationId: string; expiresAtMs: number }
}): { stores: MigrationStores; audit: Audit; clock: { now: number }; liveLocationReads: () => number } {
  const conversations = new Map<string, Record<string, unknown>>(
    (seed.conversations ?? []).map((entry) => [entry.id, { ...entry.data }]),
  )
  const messages = new Map<string, Map<string, Record<string, unknown>>>()
  for (const [convoId, list] of Object.entries(seed.messages ?? {})) {
    messages.set(convoId, new Map(list.map((entry) => [entry.id, { ...entry.data }])))
  }
  const objects = new Map<string, { contentType: string; size: number }>(
    Object.entries(seed.objects ?? {}),
  )
  const runs = new Map<string, Record<string, unknown>>()
  const writes: string[] = []
  const pending = new Set<string>(seed.failOnce ?? [])
  const clock = { now: 1_800_000_000_000 }
  const seeded: LiveLocationSession[] = (seed.liveLocation ?? []).map((session) => ({
    guestUid: null,
    foundIn: ['firestore' as const],
    expiresAtMs: null,
    startedAtMs: null,
    ...session,
  }) as LiveLocationSession)
  const arriving: LiveLocationSession[] = (seed.liveLocationAfter ?? []).map((session) => ({
    guestUid: null,
    foundIn: ['rtdb' as const],
    expiresAtMs: null,
    startedAtMs: null,
    ...session,
  }) as LiveLocationSession)
  let liveLocationReads = 0
  // The raw `location_sessions/{convoId}` documents, as the annotate-time
  // transaction would read them. Separate from `seeded` because the race is
  // precisely a session that `findSessions` has not reported yet.
  const liveSessions = new Map<string, Record<string, unknown>>(
    (seed.liveLocation ?? []).map((entry) => [
      entry.conversationId,
      {
        conversation_id: entry.conversationId,
        guest_uid: entry.guestUid ?? GUEST,
        // `active` is what says a session is over. The document stays put — the
        // rules refuse to reopen it and nothing sweeps it — so a Guest who once
        // shared carries the document for good, and the run must still be able
        // to migrate them.
        active: entry.active !== false,
        expires_at: entry.expiresAtMs ?? null,
      },
    ]),
  )
  let startedMidRun = false
  const startSession = (conversationId: string, expiresAtMs: number) => {
    liveSessions.set(conversationId, {
      conversation_id: conversationId,
      guest_uid: GUEST,
      active: true,
      expires_at: expiresAtMs,
    })
    seeded.push({
      conversationId,
      guestUid: GUEST,
      foundIn: ['firestore'],
      expiresAtMs,
      startedAtMs: null,
    })
  }
  const maybeStartSession = () => {
    const trigger = seed.startSessionAtWrite
    if (!trigger || startedMidRun || writes.length < trigger.after) return
    startedMidRun = true
    startSession(trigger.conversationId, trigger.expiresAtMs)
  }
  let startedOnAnnotate = false

  const maybeFail = (key: string) => {
    const match = [...pending].find((pattern) => key.includes(pattern))
    if (!match) return
    pending.delete(match)
    throw new Error(`injected failure: ${key}`)
  }

  const conversationsStore: ConversationsStore = {
    async listConversations(options) {
      const all = [...conversations.entries()].map(([id, data]) => ({ id, exists: true, data }))
      if (!options?.guestUid) return all
      return all.filter((entry) => entry.data?.guest_uid === options.guestUid)
    },
    async listMessages(convoId) {
      const list = messages.get(convoId)
      if (!list) return []
      return [...list.entries()].map(([id, data]): MessageDoc => ({ id, data: { ...data } }))
    },
    async getMessage(convoId, messageId) {
      const data = messages.get(convoId)?.get(messageId)
      return { id: messageId, exists: data !== undefined, data: data ? { ...data } : undefined }
    },
    async createMessageIfAbsent(convoId, messageId, data) {
      maybeFail(`message:${messageId}`)
      let list = messages.get(convoId)
      if (!list) {
        list = new Map()
        messages.set(convoId, list)
      }
      const existing = list.get(messageId)
      if (existing) {
        const stored = existing.migration as { source_message_id?: string } | undefined
        const claimed = data.migration as { source_message_id?: string } | undefined
        if (stored?.source_message_id && stored.source_message_id === claimed?.source_message_id) {
          return 'already-present'
        }
        throw new Error(`Destination message ${messageId} is already in use by another message`)
      }
      list.set(messageId, { ...data })
      writes.push(`message:${convoId}/${messageId}`)
      maybeStartSession()
      return 'created'
    },
    async markSuperseded(convoId, supersededBy, at, guard) {
      if (seed.startSessionOnAnnotate && !startedOnAnnotate) {
        startedOnAnnotate = true
        startSession(seed.startSessionOnAnnotate.conversationId, seed.startSessionOnAnnotate.expiresAtMs)
      }
      const data = conversations.get(convoId)
      if (!data) throw new Error(`Conversation ${convoId} is missing`)
      // Mirrors the real adapter: with a guard, the session check and the write
      // are one indivisible step, so no test can slip a session in between.
      if (guard) {
        const session = liveSessions.get(convoId)
        if (session && session.active !== false && isLiveSessionDoc(session, guard.nowMs)) {
          return 'blocked'
        }
      }
      conversations.set(convoId, { ...data, superseded_by: supersededBy, superseded_at: at, archived: true })
      writes.push(`supersede:${convoId}`)
      return 'marked'
    },
    async ensureCanonicalConversation(convoId, data) {
      if (conversations.has(convoId)) return 'already-present'
      conversations.set(convoId, { ...data })
      writes.push(`conversation:${convoId}`)
      return 'created'
    },
    async touchConversation(convoId, patch) {
      const data = conversations.get(convoId)
      if (!data) throw new Error(`Conversation ${convoId} is missing`)
      const current = data.updated_at
      const incoming = patch.updated_at
      if (typeof current === 'number' && typeof incoming === 'number' && current >= incoming) return
      conversations.set(convoId, { ...data, last_message: patch.last_message, updated_at: patch.updated_at })
      writes.push(`touch:${convoId}`)
    },
  }

  const storageStore: StorageStore = {
    async copyAndVerify({ sourcePath, destinationPath, contentType, size }) {
      maybeFail(`attachment:${destinationPath}`)
      if (objects.has(destinationPath)) {
        const there = objects.get(destinationPath)!
        if (there.size !== size) throw new Error(`Attachment ${destinationPath} exists with the wrong size`)
        return 'already-present'
      }
      const source = objects.get(sourcePath)
      if (!source) throw new Error(`Attachment ${sourcePath} is missing`)
      objects.set(destinationPath, { contentType, size })
      writes.push(`attachment:${destinationPath}`)
      return 'copied'
    },
  }

  const runsStore: MigrationRunStore = {
    async get(uid): Promise<DocSnapshot> {
      const data = runs.get(uid)
      return { id: uid, exists: data !== undefined, data }
    },
    async acquire(input) {
      const existing = runs.get(input.uid)
      if (
        existing &&
        existing.status === 'running' &&
        existing.owner !== input.owner &&
        !input.takeover &&
        typeof existing.lease_expires_at === 'number' &&
        existing.lease_expires_at > clock.now
      ) {
        return false
      }
      runs.set(input.uid, {
        ...(existing ?? {}),
        uid: input.uid,
        status: 'running',
        owner: input.owner,
        plan_hash: input.planHash,
        planned: input.planned,
        lease_expires_at: clock.now + input.leaseMs,
        attempt: typeof existing?.attempt === 'number' ? (existing.attempt as number) + 1 : 1,
      })
      writes.push(`lease:${input.uid}`)
      return true
    },
    async heartbeat(uid, owner, now, progress) {
      const data = runs.get(uid)
      if (!data || data.owner !== owner) return
      runs.set(uid, { ...data, ...progress, updated_at: now })
    },
    async complete(uid, owner, now, summary) {
      const data = runs.get(uid)
      if (!data || data.owner !== owner) return
      runs.set(uid, { ...data, ...summary, status: 'complete', completed_at: now })
      writes.push(`complete:${uid}`)
    },
    async fail(uid, owner, now, error) {
      const data = runs.get(uid)
      if (!data || data.owner !== owner) return
      runs.set(uid, { ...data, status: 'running', error, updated_at: now })
      writes.push(`fail:${uid}`)
    },
    async release(uid, owner, now, reason) {
      const data = runs.get(uid)
      if (!data || data.owner !== owner) return
      // The lease is set to `now`, so the very next attempt may begin.
      runs.set(uid, { ...data, status: 'aborted', error: reason, updated_at: now, lease_expires_at: now })
      writes.push(`release:${uid}`)
    },
  }

  const liveLocationStore: LiveLocationStore = {
    async findSessions(conversationIds) {
      liveLocationReads += 1
      if (seed.liveLocationUnobservable) {
        throw new Error('Realtime Database is not configured')
      }
      const active = liveLocationReads === 1 ? seeded : [...seeded, ...arriving]
      return active
        .filter((session) => conversationIds.includes(session.conversationId))
        .filter((session) => liveSessions.get(session.conversationId)?.active !== false)
        .map((session) => ({ ...session }))
    },
  }

  return {
    stores: {
      conversations: conversationsStore,
      storage: storageStore,
      runs: runsStore,
      liveLocation: liveLocationStore,
    },
    audit: { writes },
    clock,
    liveLocationReads: () => liveLocationReads,
  }
}

const GUEST = 'guest-uid-1'

/** Five bookings, five threads: the shape this whole refactor exists to end. */
function fiveBookingThreads(uid = GUEST) {
  const conversations: Array<{ id: string; data: Record<string, unknown> }> = []
  const messages: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {}
  const objects: Record<string, { contentType: string; size: number }> = {}
  for (let index = 1; index <= 5; index += 1) {
    const bookingId = `bk_${index}`
    const convoId = `booking-${bookingId}`
    conversations.push({
      id: convoId,
      data: {
        booking_id: bookingId,
        guest_uid: uid,
        guest_name: 'Maria Clara Santos',
        booking_reference: `HDL-700${index}`,
        category: 'booking',
        created_at: 1_700_000_000_000 + index,
        updated_at: 1_700_000_000_000 + index,
        last_message: `message ${index}`,
      },
    })
    messages[convoId] = [
      {
        id: `m${index}`,
        data: {
          sender_uid: uid,
          sender_role: 'guest',
          text: `Question about stay ${index}`,
          created_at: 1_700_000_050_000 + index,
        },
      },
      {
        id: `a${index}`,
        data: {
          sender_uid: 'admin-uid-1',
          sender_role: 'admin',
          text: `Reply about stay ${index}`,
          created_at: 1_700_000_060_000 + index,
        },
      },
    ]
  }
  // One thread carries a private image.
  messages['booking-bk_3']!.push({
    id: 'img1',
    data: {
      sender_uid: GUEST,
      sender_role: 'guest',
      text: '',
      created_at: 1_700_000_070_000,
      attachment: {
        path: 'messageAttachments/booking-bk_3/img1',
        content_type: 'image/png',
        size: 4096,
      },
    },
  })
  objects['messageAttachments/booking-bk_3/img1'] = { contentType: 'image/png', size: 4096 }
  return { conversations, messages, objects }
}

// ---------------------------------------------------------------------------

test('the audit reads every structure, writes nothing, and never guesses at an orphan', async () => {
  const seeded = fiveBookingThreads()
  seeded.conversations.push({ id: 'booking-orphan', data: { category: 'booking' } })
  const { stores, audit } = createStores(seeded)

  const report = await auditGuestConversations(stores)

  assert.equal(report.guests.length, 1)
  const [guest] = report.guests!
  assert.equal(guest?.uid, GUEST)
  assert.equal(guest?.canonicalExists, false)
  // Five bookings, five threads — and exactly one conversation when it is done.
  assert.equal(guest?.sources.length, 5)
  assert.equal(guest?.plannedCopies, 11)
  assert.equal(guest?.plannedAttachments, 1)
  // An unattributable thread is reported, never folded into somebody's account.
  assert.deepEqual(report.orphans, [{ id: 'booking-orphan', reason: 'no guest_uid' }])
  assert.deepEqual(audit.writes, [])
})

test('a dry run plans the whole fold and writes nothing at all', async () => {
  const { stores, audit } = createStores(fiveBookingThreads())

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: true })

  assert.equal(result.status, 'dry-run')
  assert.equal(result.planned, 11)
  assert.equal(result.attachments, 1)
  assert.equal(result.copied, 0)
  assert.deepEqual(result.superseded, [])
  // Not even the lock. A dry run is a promise, not a rehearsal.
  assert.deepEqual(audit.writes, [])

  const after = await auditGuestConversations(stores)
  assert.equal(after.guests[0]?.sources.length, 5)
  assert.equal(after.guests[0]?.canonicalExists, false)
})

test('applying copies every message with its sender, role, text, timestamp and booking context', async () => {
  const { stores } = createStores(fiveBookingThreads())

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })

  assert.equal(result.status, 'applied')
  assert.equal(result.copied, 11)
  assert.equal(result.attachments, 1)
  assert.equal(result.superseded.length, 5)

  const copied = await stores.conversations.listMessages(`guest-${GUEST}`)
  assert.equal(copied.length, 11)

  const guestMessage = copied.find((entry) => entry.data.text === 'Question about stay 2')
  assert.ok(guestMessage)
  assert.equal(guestMessage.data.sender_uid, GUEST)
  assert.equal(guestMessage.data.sender_role, 'guest')
  // The original timestamp, not the moment of copying.
  assert.equal(guestMessage.data.created_at, 1_700_000_050_000 + 2)
  // Each message keeps the Booking it was about…
  assert.equal(guestMessage.data.booking_id, 'bk_2')

  const adminMessage = copied.find((entry) => entry.data.text === 'Reply about stay 4')
  assert.ok(adminMessage)
  assert.equal(adminMessage.data.sender_role, 'admin')
  assert.equal(adminMessage.data.sender_uid, 'admin-uid-1')
  assert.equal(adminMessage.data.booking_id, 'bk_4')

  // …and the thread holds all five at once, which is the whole point.
  const bookingIds = new Set(copied.map((entry) => entry.data.booking_id))
  assert.deepEqual([...bookingIds].sort(), ['bk_1', 'bk_2', 'bk_3', 'bk_4', 'bk_5'])

  const image = copied.find((entry) => entry.data.attachment != null)
  assert.ok(image)
  assert.equal(
    (image.data.attachment as { path: string }).path,
    `messageAttachments/guest-${GUEST}/${image.id}`,
  )
})

test('nothing is deleted: every source thread, message and attachment survives the fold', async () => {
  const { stores } = createStores(fiveBookingThreads())

  await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })

  const docs = await stores.conversations.listConversations({ guestUid: GUEST })
  const sources = docs.filter((doc) => doc.id.startsWith('booking-'))
  assert.equal(sources.length, 5)
  for (const source of sources) {
    assert.equal(source.data?.superseded_by, `guest-${GUEST}`)
    // The messages are still in there. The migration annotates; it never erases.
    const originals = await stores.conversations.listMessages(source.id)
    assert.ok(originals.length >= 2, `${source.id} lost its history`)
  }
  const stillThere = await stores.conversations.getMessage('booking-bk_1', 'm1')
  assert.equal(stillThere.exists, true)
  assert.equal(stillThere.data?.text, 'Question about stay 1')
})

test('retrying duplicates no message, copies no attachment twice and notifies nobody again', async () => {
  const { stores, audit } = createStores(fiveBookingThreads())

  const first = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })
  assert.equal(first.copied, 11)
  const writesAfterFirst = audit.writes.filter((entry) => entry.startsWith('message:')).length
  assert.equal(writesAfterFirst, 11)

  const second = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })

  assert.equal(second.status, 'already-complete')
  assert.equal(second.copied, 11)
  const copied = await stores.conversations.listMessages(`guest-${GUEST}`)
  assert.equal(copied.length, 11)
  assert.equal(
    audit.writes.filter((entry) => entry.startsWith('message:')).length,
    11,
    'a retry must not write a single extra message',
  )
  assert.equal(
    audit.writes.filter((entry) => entry.startsWith('attachment:')).length,
    1,
    'a retry must not transfer the image again',
  )
})

test('a crash mid-run resumes where it stopped instead of starting over', async () => {
  const seeded = fiveBookingThreads()
  const { stores, audit, clock } = createStores({
    ...seeded,
    // The very first attachment copy throws, as a dead connection would.
    failOnce: ['attachment:'],
  })

  const failed = await runGuestHistoryMigration(stores, {
    uid: GUEST,
    dryRun: false,
    now: () => clock.now,
  })
  assert.equal(failed.status, 'failed')
  // Partway through: some messages are in, the attachment that broke is not.
  assert.ok(failed.copied > 0 && failed.copied < 11, `expected partial progress, got ${failed.copied}`)
  // The lock is left holding: a half-done run must not look finished.
  const lock = await stores.runs.get(GUEST)
  assert.equal(lock.data?.status, 'running')
  assert.ok(lock.data?.error)

  // Nothing was marked superseded, so the sources are still exactly as they were.
  const docsAfterFailure = await stores.conversations.listConversations({ guestUid: GUEST })
  assert.equal(docsAfterFailure.filter((doc) => doc.data?.superseded_by).length, 0)

  // The crashed worker's lease is left to expire, which is what makes the work
  // recoverable without an operator having to force anything.
  clock.now += DEFAULT_LEASE_MS + 1

  const retried = await runGuestHistoryMigration(stores, {
    uid: GUEST,
    dryRun: false,
    now: () => clock.now,
  })
  assert.equal(retried.status, 'applied')
  // It copies exactly the ones the crashed run never reached — no more.
  assert.equal(failed.copied + retried.copied, 11)
  const copied = await stores.conversations.listMessages(`guest-${GUEST}`)
  assert.equal(copied.length, 11)
  assert.equal(
    copied.filter((entry) => entry.data.migrated === true).length,
    11,
    'every copy is marked as a copy, so history never notifies',
  )
  assert.equal(audit.writes.filter((entry) => entry === `complete:${GUEST}`).length, 1)
})

test('a second worker cannot fold the same history while the first one is running', async () => {
  const { stores } = createStores(fiveBookingThreads())

  const holder = await runGuestHistoryMigration(stores, {
    uid: GUEST,
    dryRun: false,
    owner: 'worker-a',
    leaseMs: 60_000,
  })
  assert.equal(holder.status, 'applied')

  // A locked run is only locked while the lease is live; simulate a live one by
  // re-running with a lease that has not expired and a different worker.
  const { stores: fresh, clock } = createStores(fiveBookingThreads())
  clock.now = 1_000_000
  await fresh.runs.acquire({
    uid: GUEST,
    owner: 'worker-a',
    conversationId: `guest-${GUEST}`,
    leaseMs: 60_000,
    now: 1_000_000,
    planHash: 'whatever',
    planned: 1,
  })
  const blocked = await runGuestHistoryMigration(fresh, {
    uid: GUEST,
    dryRun: false,
    owner: 'worker-b',
    leaseMs: 60_000,
    now: () => 1_000_500,
  })
  assert.equal(blocked.status, 'locked')
  assert.equal(blocked.copied, 0)
  assert.equal((await fresh.conversations.listMessages(`guest-${GUEST}`)).length, 0)

  // …and `--resume` takes it back deliberately, which is the recovery path.
  const resumed = await runGuestHistoryMigration(fresh, {
    uid: GUEST,
    dryRun: false,
    owner: 'worker-b',
    resume: true,
    leaseMs: 60_000,
    now: () => 1_000_500,
  })
  assert.equal(resumed.status, 'applied')
})

test('a message that cannot be reproduced faithfully stops the run rather than being mangled', async () => {
  const seeded = fiveBookingThreads()
  seeded.messages['booking-bk_1'] = [
    { id: 'broken', data: { sender_uid: GUEST, text: 'no role on this one', created_at: 1 } },
  ]
  const { stores } = createStores(seeded)

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })

  assert.equal(result.status, 'failed')
  assert.match(result.error ?? '', /sender_role/)
  assert.equal((await stores.conversations.listMessages(`guest-${GUEST}`)).length, 0)
})

test('a migration over an already-merged thread is a no-op, not a copy of a copy', async () => {
  const seeded = fiveBookingThreads()
  const { stores } = createStores(seeded)
  await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })
  const merged = await stores.conversations.listMessages(`guest-${GUEST}`)
  assert.equal(merged.length, 11)

  // Re-audit: the canonical thread is neither a source nor something to fold.
  const report = await auditGuestConversations(stores, { uid: GUEST })
  assert.equal(report.guests[0]?.sources.length, 0)
  assert.equal(report.guests[0]?.alreadySuperseded.length, 5)
  assert.equal(report.totals.plannedCopies, 0)
})

// ---------------------------------------------------------------------------
// Notifications: history is not news.
// ---------------------------------------------------------------------------

const newGuestMessage = (overrides: Record<string, unknown> = {}) => ({
  sender_uid: GUEST,
  sender_role: 'guest',
  text: 'Are we allowed an early check-in?',
  created_at: 1_700_000_100_000,
  ...overrides,
})

test('a copied message never notifies the Admin, and a real one still does', () => {
  const copiedId = 'migrated-' + 'a'.repeat(64)
  const copiedData = {
    ...newGuestMessage(),
    migrated: true,
    migration: { source_conversation_id: 'booking-bk_1', source_message_id: 'm1' },
  }

  assert.equal(
    evaluateGuestMessageCreated(`guest-${GUEST}`, copiedId, copiedData, { guest_uid: GUEST }),
    null,
  )
  // …including when only the provenance map is present, with an ordinary id.
  assert.equal(
    evaluateGuestMessageCreated(
      `guest-${GUEST}`,
      'ordinary-id',
      { ...newGuestMessage(), migration: { source_message_id: 'm1' } },
      { guest_uid: GUEST },
    ),
    null,
  )

  const real = evaluateGuestMessageCreated(`guest-${GUEST}`, 'brand-new', newGuestMessage(), {
    guest_uid: GUEST,
  })
  assert.ok(real)
  assert.equal(real.type, 'guest_message')
})

test('the push names the Booking the message is about, not the thread it lives in', () => {
  const event = evaluateGuestMessageCreated(
    `guest-${GUEST}`,
    'brand-new',
    newGuestMessage({ booking_id: 'bk_3' }),
    { guest_uid: GUEST },
  )
  assert.ok(event)
  assert.equal(event.bookingId, 'bk_3')

  // A general inquiry carries no booking at all, and that is not an error.
  const general = evaluateGuestMessageCreated(`guest-${GUEST}`, 'general-1', newGuestMessage(), {
    guest_uid: GUEST,
  })
  assert.ok(general)
  assert.equal(general.bookingId, undefined)
})

// ---------------------------------------------------------------------------
// Live location — the one thing that must be quiet before anything moves.
//
// A session is filed under `location_sessions/{conversationId}` and
// `live_location/{conversationId}/{guestUid}`. Consolidating a thread retires
// the id that session hangs on, so migrating under a running session would cut
// a Guest off with no error anywhere: the Admin's panel would simply stop
// showing them. Everything below is about refusing to do that.
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000

test('a session is live until it expires, and for a moment after', () => {
  const session = (expiresAtMs: number | null): LiveLocationSession => ({
    conversationId: 'booking-bk_1',
    guestUid: GUEST,
    foundIn: ['firestore'],
    expiresAtMs,
    startedAtMs: NOW - 60_000,
  })

  // Still running, and still running one second before it stops.
  assert.equal(isLiveSession(session(NOW + 60_000), NOW), true)
  // Expired — but the client has not swept the node yet, so the run waits.
  assert.equal(isLiveSession(session(NOW - 1), NOW), true)
  assert.equal(isLiveSession(session(NOW - LIVE_LOCATION_CLEARANCE_MS + 1), NOW), true)
  // Clear, once the clearance window has passed.
  assert.equal(isLiveSession(session(NOW - LIVE_LOCATION_CLEARANCE_MS - 1), NOW), false)
  // A session with no readable expiry is treated as live: an unreadable clock
  // is not evidence that the session stopped.
  assert.equal(isLiveSession(session(null), NOW), true)
})

test('a running live-location session blocks the run, and nothing is written', async () => {
  const { stores, audit, clock } = createStores({
    ...fiveBookingThreads(),
    liveLocation: [
      { conversationId: 'booking-bk_2', guestUid: GUEST, foundIn: ['firestore', 'rtdb'], expiresAtMs: NOW + 600_000 },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'blocked-live-location')
  assert.equal(result.planned, 11)
  assert.equal(result.copied, 0)
  assert.deepEqual(result.superseded, [])
  // The block is specific: which thread, and where the session was seen.
  assert.deepEqual(
    result.liveLocation?.blocking.map((session) => session.conversationId),
    ['booking-bk_2'],
  )
  // Not one byte: no lease, no conversation, no copy, no annotation.
  assert.deepEqual(audit.writes, [])
})

test('a session already on the account conversation is reported, not treated as a block', async () => {
  const { stores, clock } = createStores({
    ...fiveBookingThreads(),
    liveLocation: [
      { conversationId: `guest-${GUEST}`, guestUid: GUEST, foundIn: ['rtdb'], expiresAtMs: NOW + 600_000 },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  // That path is the destination, not one of the threads being folded away, so
  // it keeps working. The run says so rather than staying quiet about a Guest
  // who is on the property and sharing right now.
  assert.equal(result.status, 'applied')
  assert.deepEqual(
    result.liveLocation?.watching.map((session) => session.conversationId),
    [`guest-${GUEST}`],
  )
  assert.deepEqual(result.liveLocation?.blocking, [])
})

test('a session that ended on its own no longer blocks', async () => {
  const { stores, clock } = createStores({
    ...fiveBookingThreads(),
    // Expired well outside the clearance window: the Guest stopped, or the
    // 15/30/60-minute window closed, and the node has been swept.
    liveLocation: [
      {
        conversationId: 'booking-bk_1',
        guestUid: GUEST,
        foundIn: ['firestore', 'rtdb'],
        expiresAtMs: NOW - LIVE_LOCATION_CLEARANCE_MS - 1,
      },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.liveLocation?.blocking, [])
  assert.equal(result.copied, 11)
})

test('waiting lets a session end on its own, and the run then goes ahead', async () => {
  const { stores, clock, liveLocationReads } = createStores({
    ...fiveBookingThreads(),
    liveLocation: [
      { conversationId: 'booking-bk_4', guestUid: GUEST, expiresAtMs: NOW + 600_000 },
    ],
  })
  clock.now = NOW

  // The sessions the double reports are fixed, so "ending on its own" is
  // modelled by the clock overtaking the expiry while the run waits.
  const sleeps: number[] = []
  const result = await runGuestHistoryMigration(stores, {
    uid: GUEST,
    dryRun: false,
    now: () => clock.now,
    liveLocation: {
      timeoutMs: 60 * 60_000,
      pollMs: 60_000,
      sleep: async (ms) => {
        sleeps.push(ms)
        // Ten minutes pass between checks, as they would in the real wait.
        clock.now += 600_000
      },
    },
  })

  assert.equal(result.status, 'applied')
  assert.ok(result.liveLocation)
  assert.ok(result.liveLocation.waitedMs > 0, 'the report says how long it waited')
  assert.ok(liveLocationReads() > 1, 'both databases were read again')
  assert.ok(sleeps.length > 0)
  assert.ok(result.verification?.ok)
})

test('a session that outlasts the wait aborts the Guest and writes nothing', async () => {
  const { stores, audit, clock } = createStores({
    ...fiveBookingThreads(),
    // A 60-minute share that will still be running when the patience runs out.
    liveLocation: [
      { conversationId: 'booking-bk_5', guestUid: GUEST, expiresAtMs: NOW + 60 * 60_000 },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, {
    uid: GUEST,
    dryRun: false,
    now: () => clock.now,
    liveLocation: { timeoutMs: 10 * 60_000, pollMs: 60_000, sleep: async (ms) => { clock.now += ms } },
  })

  assert.equal(result.status, 'blocked-live-location')
  assert.equal(result.copied, 0)
  assert.deepEqual(
    result.liveLocation?.blocking.map((session) => session.conversationId),
    ['booking-bk_5'],
  )
  // The wait is bounded, and it did not quietly give up early.
  assert.ok(result.liveLocation!.waitedMs >= 10 * 60_000 - 1)
  assert.deepEqual(audit.writes, [])
})

test('a session that starts DURING the run is caught by the recheck, and the lease goes back', async () => {
  const { stores, audit, clock } = createStores({
    ...fiveBookingThreads(),
    liveLocation: [],
    // Nothing live when the run looked the first time. The Guest presses
    // "share my location" while the lease is being taken.
    liveLocationAfter: [
      { conversationId: 'booking-bk_1', guestUid: GUEST, foundIn: ['rtdb'], expiresAtMs: NOW + 600_000 },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'blocked-live-location')
  assert.equal(result.copied, 0)
  // The lease was taken and then handed back with the reason on it, so the next
  // attempt can start now instead of waiting out the 15 minutes.
  assert.ok(audit.writes.includes('lease:guest-uid-1'))
  assert.ok(audit.writes.includes('release:guest-uid-1'))
  // .and not a single message was copied or thread annotated.
  assert.equal(audit.writes.filter((write) => write.startsWith('message:')).length, 0)
  assert.equal(audit.writes.filter((write) => write.startsWith('supersede:')).length, 0)
})

test('an unreachable Realtime Database refuses to run rather than read as clear', async () => {
  const { stores, audit } = createStores({ ...fiveBookingThreads(), liveLocationUnobservable: true })

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false })

  // Half a picture is not a picture. The Firestore side is visible and empty;
  // the RTDB side is not, so "no sessions" would be a guess about a Guest's
  // safety, and the run refuses to make it.
  assert.equal(result.status, 'failed')
  assert.match(result.error ?? '', /Live-location check unavailable/)
  assert.match(result.error ?? '', /Realtime Database/)
  assert.deepEqual(audit.writes, [])
})

// ---------------------------------------------------------------------------
// Verification — do the new paths work for the Guest and the Admin?
// ---------------------------------------------------------------------------

test('verification passes on a consolidated thread and names the paths both apps use', async () => {
  const { stores, clock } = createStores(fiveBookingThreads())
  clock.now = NOW

  const applied = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })
  assert.equal(applied.status, 'applied')
  assert.ok(applied.verification?.ok, `problems: ${applied.verification?.problems.join('; ')}`)
  assert.equal(applied.verification?.checked.messages, 11)
  assert.equal(applied.verification?.checked.attachments, 1)
  assert.equal(applied.verification?.checked.sources, 5)

  // The report is meant to be read by a human, not trusted as a boolean.
  assert.deepEqual(applied.verification?.paths, {
    conversation: `conversations/guest-${GUEST}`,
    messages: `conversations/guest-${GUEST}/messages`,
    attachments: `messageAttachments/guest-${GUEST}/`,
    locationSession: `location_sessions/guest-${GUEST}`,
    liveLocation: `live_location/guest-${GUEST}/{guestUid}`,
  })

  // .and it is re-runnable: the same answer tomorrow.
  const again = await verifyGuestConversation(stores, GUEST, { nowMs: NOW })
  assert.equal(again.ok, true)
})

test('verification catches an image still filed under the retired thread', async () => {
  const { stores, clock } = createStores(fiveBookingThreads())
  clock.now = NOW
  await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  // The one failure mode that would look fine to the run and broken to a Guest:
  // a message pointing at a path the new conversation does not own.
  await stores.conversations.createMessageIfAbsent(`guest-${GUEST}`, 'stray', {
    sender_uid: GUEST,
    sender_role: 'guest',
    text: 'photo',
    created_at: NOW,
    attachment: { path: 'messageAttachments/booking-bk_3/stray', content_type: 'image/png', size: 10 },
  })

  const report = await verifyGuestConversation(stores, GUEST, { nowMs: NOW })
  assert.equal(report.ok, false)
  assert.ok(
    report.problems.some((problem) => problem.includes('messageAttachments/booking-bk_3/stray')),
    report.problems.join('; '),
  )
})

test('verification refuses to call a thread consolidated while a session is still on it', async () => {
  const { stores, clock } = createStores(fiveBookingThreads())
  clock.now = NOW
  await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  const withSession = createStores({
    ...fiveBookingThreads(),
    conversations: [
      ...fiveBookingThreads().conversations.map((entry) => ({
        ...entry,
        data: { ...entry.data, superseded_by: `guest-${GUEST}` },
      })),
      { id: `guest-${GUEST}`, data: { guest_uid: GUEST, category: 'booking' } },
    ],
    liveLocation: [{ conversationId: 'booking-bk_2', guestUid: GUEST, expiresAtMs: NOW + 600_000 }],
  })

  const report = await verifyGuestConversation(withSession.stores, GUEST, { nowMs: NOW })
  assert.equal(report.ok, false)
  assert.ok(
    report.problems.some((problem) => problem.includes('booking-bk_2')),
    report.problems.join('; '),
  )
})

test('verification says plainly when the consolidated thread is not there', async () => {
  const { stores } = createStores({ conversations: [], messages: {} })

  const report = await verifyGuestConversation(stores, GUEST)

  assert.equal(report.ok, false)
  assert.deepEqual(report.problems, [
    `conversations/guest-${GUEST} does not exist: neither app can open it.`,
  ])
})

// ---------------------------------------------------------------------------
// The race: a Guest starts sharing AFTER the last check but BEFORE the thread
// is retired.
//
// The copy loop takes time — one round trip per message, and a Guest with years
// of correspondence takes a while. A Guest can press "share my location" during
// it. The checks before the lease and before the first write have both already
// passed by then, so without a guard at the point of retirement the run would
// mark the thread superseded with a live session filed under it: the Guest
// believes they are being watched, both apps have moved to `guest-<uid>`, and
// nobody is watching anything.
// ---------------------------------------------------------------------------

test('a session started while history is being copied stops the thread being retired', async () => {
  const { stores, audit, clock } = createStores({
    ...fiveBookingThreads(),
    // Nothing live when the run looked. Then, six messages in, the Guest
    // starts sharing on a thread that is about to be folded away.
    startSessionAtWrite: { after: 6, conversationId: 'booking-bk_2', expiresAtMs: NOW + 600_000 },
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'blocked-live-location')
  // The copies are kept: they are correct, they are idempotent, and redoing
  // them later would waste the work rather than improve on it.
  assert.equal(result.copied, 11)
  // .but NOT ONE thread is marked superseded, so nothing is stranded.
  assert.deepEqual(result.superseded, [])
  assert.equal(audit.writes.filter((write) => write.startsWith('supersede:')).length, 0)
  // .and the run says where it stopped.
  assert.equal(result.liveLocation?.blockedAt, 'recheck')
  assert.deepEqual(
    result.liveLocation?.blocking.map((session) => session.conversationId),
    ['booking-bk_2'],
  )
})

test('the guard is atomic: a session cannot land between the check and the retirement', async () => {
  const { stores, audit, clock } = createStores({
    ...fiveBookingThreads(),
    // The session lands after the pre-annotate read has already reported clear.
    // Only the per-thread transaction can catch it, and it must catch it for
    // the thread it lands on.
    startSessionOnAnnotate: { conversationId: 'booking-bk_5', expiresAtMs: NOW + 600_000 },
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'blocked-live-location')
  assert.equal(result.liveLocation?.blockedAt, 'annotate')
  assert.equal(result.copied, 11)
  // Sources are retired in id order, so bk_5 is last: the four before it are
  // marked, and the one with the live session under it is not.
  assert.deepEqual(result.superseded, ['booking-bk_1', 'booking-bk_2', 'booking-bk_3', 'booking-bk_4'])
  assert.equal(
    audit.writes.filter((write) => write === 'supersede:booking-bk_5').length,
    0,
    'the thread with a live session under it must not be retired',
  )
  // The run is left resumable, not reported finished.
  assert.equal(audit.writes.filter((write) => write === `complete:${GUEST}`).length, 0)
  assert.ok(audit.writes.includes(`fail:${GUEST}`))
})

test('a session the Guest has already ended is not a block, and never strands them', async () => {
  const { stores, clock } = createStores({
    ...fiveBookingThreads(),
    // A session document outlives the share: the rules refuse to reopen it and
    // nothing sweeps it, so a Guest who ever shared carries one for good. That
    // must not make them unmigratable — `active: false` is what says it is over,
    // not the clock.
    liveLocation: [
      { conversationId: 'booking-bk_1', expiresAtMs: NOW + 600_000, active: false },
      { conversationId: 'booking-bk_4', expiresAtMs: NOW + 600_000, active: false },
    ],
  })
  clock.now = NOW

  const result = await runGuestHistoryMigration(stores, { uid: GUEST, dryRun: false, now: () => clock.now })

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.liveLocation?.blocking, [])
  assert.deepEqual(result.liveLocation?.watching, [])
  assert.equal(result.superseded.length, 5)
  assert.ok(result.verification?.ok, result.verification?.problems.join('; '))
})
