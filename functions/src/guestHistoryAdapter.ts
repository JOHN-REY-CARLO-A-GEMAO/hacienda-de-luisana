// ----------------------------------------------------------------------------
// The Firestore / Cloud Storage adapter behind the guest-history migration.
//
// Everything here is an implementation of the narrow ports in
// `guestConversationMigration.ts`. That separation is the point: the safety
// properties (idempotent copies, no deletions, no notifications) are asserted
// against test doubles that share this interface, and this file is the only
// place that knows what a real Firestore transaction looks like.
// ----------------------------------------------------------------------------

import type { Bucket } from '@google-cloud/storage'
import type { Database } from 'firebase-admin/database'
import type { Firestore, Timestamp } from 'firebase-admin/firestore'

import {
  MIGRATION_RUNS,
  isLiveSessionDoc,
  type ConversationsStore,
  type DocSnapshot,
  type LiveLocationSession,
  type LiveLocationStore,
  type MessageDoc,
  type MigrationRunStore,
  type MigrationStores,
  type StorageStore,
} from './guestConversationMigration'

const CONVERSATIONS = 'conversations'
const MESSAGES = 'messages'
const LOCATION_SESSIONS = 'location_sessions'
const LIVE_LOCATION = 'live_location'
const ATTACHMENT_CHUNK = 500

type FirestoreLike = Pick<Firestore, 'collection' | 'doc' | 'runTransaction' | 'batch'>

/**
 * A Realtime Database handle, narrowed to the one read the guard performs.
 *
 * `snapshot.val()` is `unknown` in the Admin SDK's own types, which is honest:
 * the shape is whatever a browser wrote. It is parsed, never trusted.
 */
type RealtimeLike = {
  ref(path: string): {
    once(event: 'value'): Promise<{ val(): unknown }>
  }
}

/**
 * A Firestore-shaped handle, narrowed so the migration can be driven by the
 * Admin SDK, by a transactional double in a test, or by nothing at all.
 *
 * `database` is the Realtime Database, and it is not optional in spirit. The
 * live-location guard has to look in *both* databases, and an adapter that
 * could only see one would report "clear" on half the evidence.
 */
export function firestoreMigrationStores(
  db: FirestoreLike,
  bucket: Bucket | null,
  database: RealtimeLike | null = null,
): MigrationStores {
  return {
    conversations: firestoreConversations(db),
    storage: bucket ? cloudStorageStore(bucket) : readOnlyStorage(),
    runs: firestoreRuns(db),
    liveLocation: database
      ? liveLocationStore(db as FirestoreLike & { collection(name: string): FirestoreCollection }, database)
      : unobservableLiveLocation(),
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

function firestoreConversations(db: FirestoreLike): ConversationsStore {
  const convoRef = (convoId: string) => db.collection(CONVERSATIONS).doc(convoId)

  return {
    async listConversations(options) {
      // The Admin SDK bypasses security rules, so this scan is available here
      // in a way it never is to a client — which is precisely why the migration
      // has to be a backend job.
      let query = db.collection(CONVERSATIONS) as {
        where(field: string, op: string, value: unknown): typeof query
        get(): Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> | undefined }> }>
      }
      if (options?.guestUid) query = query.where('guest_uid', '==', options.guestUid)
      const snap = await query.get()
      return snap.docs.map((doc) => ({ id: doc.id, exists: true, data: doc.data() }))
    },

    async listMessages(convoId) {
      // Unbounded on purpose: a copy that stopped at 500 messages would leave
      // the thread half-folded and the source unmarked.
      const snap = await convoRef(convoId).collection(MESSAGES).get()
      return snap.docs.map((doc): MessageDoc => ({ id: doc.id, data: doc.data() ?? {} }))
    },

    async getMessage(convoId, messageId) {
      const snap = await convoRef(convoId).collection(MESSAGES).doc(messageId).get()
      return { id: messageId, exists: snap.exists === true, data: snap.data() }
    },

    async createMessageIfAbsent(convoId, messageId, data) {
      const ref = convoRef(convoId).collection(MESSAGES).doc(messageId)
      return db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        if (existing.exists) {
          const stored = existing.data()
          const provenance = (stored?.migration ?? null) as { source_message_id?: unknown } | null
          // Landing on a document this migration already wrote is the retry
          // path, and it is a success. Landing on somebody else's document under
          // the same id is not, and must stop the run rather than overwrite it.
          const claimed = (data.migration ?? null) as { source_message_id?: unknown } | null
          if (
            provenance &&
            claimed &&
            provenance.source_message_id === claimed.source_message_id
          ) {
            return 'already-present' as const
          }
          throw new Error(`Destination message ${messageId} is already in use by another message`)
        }
        tx.set(ref, data)
        return 'created' as const
      })
    },

    async markSuperseded(convoId, supersededBy, at, guard) {
      // An annotation, never a delete: the thread and every message and
      // attachment inside it stay exactly where they are.
      const convo = convoRef(convoId)
      return db.runTransaction(async (tx: TransactionLike) => {
        if (guard) {
          // THE RACE, CLOSED. The check and the write are one transaction, so
          // there is no instant in which this thread is retired and a live
          // session is still filed under it. `findSessions` cannot offer this:
          // a Firestore transaction cannot read the Realtime Database, so the
          // position half is always a step behind. The consent half is not, and
          // it is the half that gates everything — `startSharing` writes the
          // consent before it publishes any position, so a consent this
          // transaction cannot see has not put a Guest on the map yet.
          const session = await tx.get(db.collection(LOCATION_SESSIONS).doc(convoId))
          if (isLiveSessionDoc(session.exists ? session.data() : undefined, guard.nowMs)) {
            return 'blocked' as const
          }
        }
        tx.set(convo, { superseded_by: supersededBy, superseded_at: at, archived: true }, { merge: true })
        return 'marked' as const
      })
    },

    async ensureCanonicalConversation(convoId, data) {
      const ref = convoRef(convoId)
      return db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        if (existing.exists) return 'already-present' as const
        tx.set(ref, data)
        return 'created' as const
      })
    },

    async touchConversation(convoId, patch) {
      const ref = convoRef(convoId)
      await db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const stored = existing.exists ? existing.data() : undefined
        const current = stored?.updated_at as Timestamp | undefined
        const incoming = patch.updated_at as Timestamp | undefined
        // Only move the preview when the copied message really is the newest
        // thing in the thread. Otherwise a run over old history would drag a
        // three-year-old question to the top of the Admin's inbox.
        if (current && incoming && isAfterOrEqual(current, incoming)) return
        tx.set(
          ref,
          { last_message: patch.last_message, updated_at: patch.updated_at },
          { merge: true },
        )
      })
    },
  }
}

type SnapshotLike = {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

type TransactionLike = {
  get(ref: unknown): Promise<SnapshotLike>
  set(ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }): unknown
}

function isAfterOrEqual(current: { toMillis?: () => number }, incoming: { toMillis?: () => number }): boolean {
  const a = typeof current.toMillis === 'function' ? current.toMillis() : null
  const b = typeof incoming.toMillis === 'function' ? incoming.toMillis() : null
  if (a === null || b === null) return false
  return a >= b
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function cloudStorageStore(bucket: Bucket): StorageStore {
  return {
    async copyAndVerify({ sourcePath, destinationPath, contentType, size }) {
      const destination = bucket.file(destinationPath)
      const [alreadyThere] = await destination.exists()
      if (alreadyThere) {
        const [metadata] = await destination.getMetadata()
        if (Number(metadata.size) !== size) {
          throw new Error(`Attachment ${destinationPath} exists with the wrong size`)
        }
        return 'already-present'
      }
      const source = bucket.file(sourcePath)
      const [sourceExists] = await source.exists()
      // The message says an image is there and the object is not. Copy nothing
      // rather than pretend: the message still carries its metadata, and the
      // operator sees the mismatch in the run report.
      if (!sourceExists) throw new Error(`Attachment ${sourcePath} is missing`)

      await source.copy(destination)
      await destination.setMetadata({ contentType })
      const [metadata] = await destination.getMetadata()
      if (Number(metadata.size) !== size) {
        throw new Error(`Attachment ${destinationPath} copied with the wrong size`)
      }
      return 'copied'
    },
  }
}

function readOnlyStorage(): StorageStore {
  return {
    async copyAndVerify() {
      throw new Error('No Storage bucket configured: attachments cannot be copied')
    },
  }
}

// ---------------------------------------------------------------------------
// Live location — the guard that keeps a Guest from being cut off mid-share
// ----------------------------------------------------------------------------

type FirestoreCollection = {
  doc(id: string): {
    get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  }
}

/**
 * Read the live-location state of a set of conversations, from both databases.
 *
 *   Firestore `location_sessions/{conversationId}` — the consent: who, since
 *   when, until when, active or stopped.
 *   RTDB      `live_location/{conversationId}/{guestUid}` — the position.
 *
 * They are written together and swept apart, so each is read independently and
 * merged on the conversation id. A session that is live in either blocks the
 * run: an expired consent with a lingering node is not live, and neither is an
 * active consent whose node has already been removed by `onDisconnect` — but
 * the run does not try to be clever about which to believe. It reports both and
 * lets the caller wait.
 */
function liveLocationStore(collections: { collection(name: string): FirestoreCollection }, database: RealtimeLike): LiveLocationStore {
  return {
    async findSessions(conversationIds) {
      const byConvo = new Map<string, LiveLocationSession>()

      const merge = (
        conversationId: string,
        foundIn: 'firestore' | 'rtdb',
        guestUid: string | null,
        expiresAtMs: number | null,
        startedAtMs: number | null,
      ): void => {
        const existing = byConvo.get(conversationId)
        if (existing) {
          if (!existing.foundIn.includes(foundIn)) existing.foundIn.push(foundIn)
          // The later expiry wins: the two databases can disagree by a moment,
          // and the conservative reading is that the session runs until the last
          // of them says it has stopped.
          if (expiresAtMs !== null && (existing.expiresAtMs === null || expiresAtMs > existing.expiresAtMs)) {
            existing.expiresAtMs = expiresAtMs
          }
          if (existing.guestUid === null) existing.guestUid = guestUid
          if (existing.startedAtMs === null) existing.startedAtMs = startedAtMs
          return
        }
        byConvo.set(conversationId, {
          conversationId,
          guestUid,
          foundIn: [foundIn],
          expiresAtMs,
          startedAtMs,
        })
      }

      for (const conversationId of conversationIds) {
        // Firestore: the consent. One document, keyed by the conversation id.
        const snap = await collections.collection(LOCATION_SESSIONS).doc(conversationId).get()
        if (snap.exists) {
          const data = snap.data() ?? {}
          const active = data.active !== false
          const expiresAtMs = toMillis(data.expires_at)
          // A session the Guest has stopped is not live, whatever its clock says.
          if (active) {
            merge(
              conversationId,
              'firestore',
              typeof data.guest_uid === 'string' ? data.guest_uid.trim() || null : null,
              expiresAtMs,
              toMillis(data.started_at),
            )
          }
        }
      }

      for (const conversationId of conversationIds) {
        // RTDB: the position. One read of the conversation's node, whose
        // children are keyed by guest uid.
        const snapshot = await database.ref(`${LIVE_LOCATION}/${conversationId}`).once('value')
        const children = snapshot.val()
        if (!children || typeof children !== 'object') continue
        for (const [guestUid, raw] of Object.entries(children as Record<string, unknown>)) {
          if (!raw || typeof raw !== 'object') continue
          const node = raw as Record<string, unknown>
          // The rules refuse to serve a fix past its expiry, so a node sitting
          // there with a closed window is debris, not a session.
          const expiresAtMs = typeof node.expires_at_ms === 'number' ? node.expires_at_ms : null
          if (expiresAtMs !== null && expiresAtMs <= Date.now()) continue
          merge(
            conversationId,
            'rtdb',
            typeof node.guest_uid === 'string' ? node.guest_uid.trim() || null : guestUid,
            expiresAtMs,
            typeof node.at_ms === 'number' ? node.at_ms : null,
          )
        }
      }

      return [...byConvo.values()]
    },
  }
}

/**
 * Half a view is not a view.
 *
 * Without the Realtime Database the guard can see the consent but not the
 * position, and "I could not see a session" is not "there is no session". So it
 * throws, the run refuses to start, and the operator learns the configuration
 * is incomplete — instead of a Guest quietly losing their live location.
 */
function unobservableLiveLocation(): LiveLocationStore {
  return {
    async findSessions() {
      throw new Error(
        'Realtime Database is not configured: live-location positions cannot be checked. ' +
          'Point this job at the RTDB for the project (FIREBASE_DATABASE_EMULATOR_HOST, or the default instance) before applying.',
      )
    },
  }
}

/** The largest page of messages a single delete batch would sweep, for the runbook. */
export const MESSAGE_SWEEP_CHUNK = ATTACHMENT_CHUNK

// ---------------------------------------------------------------------------
// The lease
// ---------------------------------------------------------------------------

function firestoreRuns(db: FirestoreLike): MigrationRunStore {
  const runRef = (uid: string) => db.collection(MIGRATION_RUNS).doc(`guest-${uid}`)
  const leaseFor = (now: unknown, leaseMs: number) => addMillis(now, leaseMs)

  return {
    async get(uid): Promise<DocSnapshot> {
      const snap = await runRef(uid).get()
      return { id: `guest-${uid}`, exists: snap.exists === true, data: snap.data() }
    },

    async acquire(input) {
      const ref = runRef(input.uid)
      return db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const data = existing.exists ? existing.data() ?? {} : {}
        const heldByOther =
          existing.exists &&
          data.status === 'running' &&
          data.owner !== input.owner &&
          !input.takeover &&
          !isExpired(data.lease_expires_at, input.now)
        if (heldByOther) return false
        tx.set(
          ref,
          {
            uid: input.uid,
            conversation_id: input.conversationId,
            status: 'running',
            owner: input.owner,
            attempt: typeof data.attempt === 'number' ? data.attempt + 1 : 1,
            plan_hash: input.planHash,
            planned: input.planned,
            started_at: input.now,
            updated_at: input.now,
            lease_expires_at: leaseFor(input.now, input.leaseMs),
            completed_at: null,
            error: null,
          },
          { merge: true },
        )
        return true
      })
    },

    async heartbeat(uid, owner, now, progress) {
      const ref = runRef(uid)
      await db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const data = existing.exists ? existing.data() ?? {} : {}
        // Renew only while this worker still owns the lease: a worker that lost
        // it to a resumed run must not quietly take it back mid-copy.
        if (existing.exists && data.owner !== owner) return
        tx.set(ref, { ...progress, updated_at: now }, { merge: true })
      })
    },

    async complete(uid, owner, now, summary) {
      const ref = runRef(uid)
      await db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const data = existing.exists ? existing.data() ?? {} : {}
        if (existing.exists && data.owner !== owner) return
        tx.set(
          ref,
          { ...summary, status: 'complete', completed_at: now, updated_at: now, error: null },
          { merge: true },
        )
      })
    },

    async release(uid, owner, now, reason) {
      const ref = runRef(uid)
      await db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const data = existing.exists ? existing.data() ?? {} : {}
        if (existing.exists && data.owner !== owner) return
        // `aborted`, and the lease set to `now` so it is already expired: the
        // next attempt may begin immediately, and the aborted attempt is on the
        // record with its reason.
        tx.set(
          ref,
          {
            status: 'aborted',
            error: reason,
            updated_at: now,
            completed_at: null,
            lease_expires_at: now,
          },
          { merge: true },
        )
      })
    },

    async fail(uid, owner, now, error) {
      const ref = runRef(uid)
      await db.runTransaction(async (tx: TransactionLike) => {
        const existing = await tx.get(ref)
        const data = existing.exists ? existing.data() ?? {} : {}
        if (existing.exists && data.owner !== owner) return
        // `running`, not `failed`: the lease is left to expire so the next run
        // resumes, and the error is recorded for whoever has to read it.
        tx.set(ref, { status: 'running', error, updated_at: now }, { merge: true })
      })
    },
  }
}

function isExpired(leaseExpiresAt: unknown, now: unknown): boolean {
  const expires = toMillis(leaseExpiresAt)
  const current = toMillis(now)
  if (expires === null || current === null) return true
  return expires <= current
}

function toMillis(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const record = value as { toMillis?: () => number }
    if (typeof record.toMillis === 'function') return record.toMillis()
  }
  return null
}

function addMillis(value: unknown, delta: number): unknown {
  if (value == null) return value
  if (typeof value === 'number') return value + delta
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : new Date(parsed + delta).toISOString()
  }
  if (typeof value === 'object') {
    const record = value as { toMillis?: () => number }
    if (typeof record.toMillis === 'function') return new Date(record.toMillis() + delta)
  }
  return value
}
