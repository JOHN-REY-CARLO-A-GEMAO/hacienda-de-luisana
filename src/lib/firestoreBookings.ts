// ----------------------------------------------------------------------------
// Firestore Bookings Service
// Hacienda de LuisAna — Cloud persistence for bookings
// ----------------------------------------------------------------------------
// Falls back to localStorage (bookingsDB) when Firebase is not configured.
// Provides real-time listeners for admin dashboard.
// ----------------------------------------------------------------------------

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { activityLogStorage, bookingsDB, type Booking } from './storage'
import { ACCOMMODATIONS } from '../config/site'
import {
  applyAction,
  approvalCouplingSet,
  effectiveStatus,
  findDateConflicts,
  formatHoldCountdown,
  holdMsRemaining,
  instantOf,
  normalizeStatus,
  unitsForAccommodation,
  DATE_HOLD_MS,
  type ActionAccepted,
  type ActionRefused,
  type ActivityLogEntry,
  type Actor,
  type BookingAction,
  type BookingStatus,
  type DateRange,
  type HoldBearingBooking,
} from './booking'

const COLLECTION = 'bookings'
/** Per-Booking Activity log: `bookings/{id}/activity`, append-only. */
const ACTIVITY_COLLECTION = 'activity'

type FirestoreBooking = Omit<Booking, 'created_at' | 'status'> & {
  created_at: any // serverTimestamp
  status: string
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
/**
 * The Date hold a Booking places on its dates when it is submitted: 24 hours out
 * (CONTEXT.md § Date hold). Stored as data, not kept in anybody's UI state.
 */
function initialHoldExpiry(now: string | number | Date = Date.now()): string {
  return new Date(new Date(now).getTime() + DATE_HOLD_MS).toISOString()
}

function mapDocToBooking(id: string, data: DocumentData): Booking {
  return {
    id,
    guest_name: data.guest_name,
    phone: data.phone,
    email: data.email,
    check_in: data.check_in,
    check_out: data.check_out,
    guests: data.guests,
    accommodation: data.accommodation,
    special_requests: data.special_requests || '',
    // Old documents are migrated on read: a stored `Confirmed` reads as
    // `Reserved`, and nothing is rewritten in Firestore (spec #9).
    status: normalizeStatus(data.status),
    created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || new Date().toISOString(),
    // Booking lifecycle v2 (additive — absent on Bookings stored before it)
    hold_expires_at: data.hold_expires_at ?? null,
    rejection_reason: data.rejection_reason ?? null,
    payment_plan: data.payment_plan,
    payment_status: data.payment_status,
    payment_proof_url: data.payment_proof_url ?? null,
    payment_reject_reason: data.payment_reject_reason ?? null,
    amount_claimed: typeof data.amount_claimed === 'number' ? data.amount_claimed : undefined,
    payment_reference: data.payment_reference,
    ocr_reference: data.ocr_reference,
    ocr_amount: data.ocr_amount,
    payment_verified_at: data.payment_verified_at ?? null,
    payment_verified_by: data.payment_verified_by ?? null,
    stay_total: typeof data.stay_total === 'number' ? data.stay_total : undefined,
    amount_due: typeof data.amount_due === 'number' ? data.amount_due : undefined,
    security_deposit: typeof data.security_deposit === 'number' ? data.security_deposit : undefined,
    balance_due: typeof data.balance_due === 'number' ? data.balance_due : undefined,
    amount_verified: typeof data.amount_verified === 'number' ? data.amount_verified : undefined,
    refund_status: data.refund_status,
    refund_total: typeof data.refund_total === 'number' ? data.refund_total : undefined,
    refund_breakdown: data.refund_breakdown ?? null,
    cancellation_reason: data.cancellation_reason ?? null,
    // The policy in force at choice time (additive — absent on Bookings stored
    // before it): nulls on read mean the Admin had published nothing.
    policy_version: data.policy_version ?? null,
    policy_effective_date: data.policy_effective_date ?? null,
    // P3 KYC (additive — absent on web-only bookings)
    ref_id: data.ref_id,
    uid: data.uid,
    source: data.source,
    kyc_status: data.kyc_status,
    kyc_id_url: data.kyc_id_url,
    kyc_receipt_url: data.kyc_receipt_url,
    kyc_reject_reason: data.kyc_reject_reason,
    // Legacy live-location keys on old documents are ignored (ADR-0009).
  }
}

/**
 * The Activity log: every state change to a Booking, with its actor and
 * timestamp, in the order it happened.
 *
 * Append-only. The interface deliberately offers no update and no remove, so no
 * surface can rewrite history (CONTEXT.md § Activity log, ticket #11).
 */
export const activityLogDB = {
  async list(bookingId: string): Promise<ActivityLogEntry[]> {
    if (!isCloud || !db) return activityLogStorage.list(bookingId)
    try {
      const q = query(
        collection(db, COLLECTION, bookingId, ACTIVITY_COLLECTION),
        orderBy('at', 'asc'),
      )
      const snap = await getDocs(q)
      const entries = snap.docs.map((d) => d.data() as ActivityLogEntry)
      // Two entries can share an instant; the sequence says which came first.
      return entries.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    } catch (e) {
      console.warn('[Firestore] activity list() failed, falling back to local', e)
      return activityLogStorage.list(bookingId)
    }
  },

  async append(entries: readonly ActivityLogEntry[]): Promise<void> {
    if (entries.length === 0) return
    if (!isCloud || !db) {
      activityLogStorage.append(entries)
      return
    }
    try {
      // Grouped per Booking, because the sequence continues from that Booking's
      // last entry. The id is the sequence, so two appends that both think they
      // are next collide instead of silently reordering the log.
      const byBooking = new Map<string, ActivityLogEntry[]>()
      for (const entry of entries) {
        byBooking.set(entry.booking_id, [...(byBooking.get(entry.booking_id) ?? []), entry])
      }
      await Promise.all(
        [...byBooking].map(async ([bookingId, batch]) => {
          const log = collection(db!, COLLECTION, bookingId, ACTIVITY_COLLECTION)
          const written = await getDocs(log)
          let seq = written.docs.reduce((max, d) => {
            const value = d.data().seq
            return typeof value === 'number' && value > max ? value : max
          }, -1)
          await runTransaction(db!, async (tx) => {
            for (const entry of batch) {
              seq += 1
              tx.set(doc(log, String(seq)), { ...entry, seq })
            }
          })
        }),
      )
    } catch (e) {
      console.warn('[Firestore] activity append() failed, falling back to local', e)
      activityLogStorage.append(entries)
    }
  },
}

/**
 * The entry a Booking owes the moment it is created. Creation is a state change
 * like any other, so it is logged here rather than left to whichever screen
 * happened to submit the form (spec #9).
 */
function submissionEntry(bookingId: string, actor: Actor, at: string): ActivityLogEntry {
  return {
    booking_id: bookingId,
    action: 'Submit',
    from_status: 'Pending',
    to_status: 'Pending',
    actor: actor.actor,
    actor_id: actor.actor_id,
    ...(actor.actor_name ? { actor_name: actor.actor_name } : {}),
    at,
  }
}

/** Store a patch, in Firestore when it is configured and locally when it is not. */
async function writePatch(id: string, patch: Partial<Booking>): Promise<void> {
  if (!isCloud || !db) {
    bookingsDB.update(id, patch)
    return
  }
  try {
    // Remove id from patch if present
    const { id: _omit, ...rest } = patch as any
    await updateDoc(doc(db, COLLECTION, id), rest)
  } catch (e) {
    console.warn('[Firestore] update() failed, falling back to local', e)
    bookingsDB.update(id, patch)
  }
}

/**
 * Record a status written straight to the store.
 *
 * Nothing is logged when the status did not actually move — a location patch
 * from /track is not a state change and does not belong in the Activity log.
 */
async function logStatusChange(
  id: string,
  before: Booking | undefined,
  patch: Partial<Booking>,
  by?: Actor,
): Promise<void> {
  if (!before || patch.status === undefined) return
  const to = normalizeStatus(patch.status)
  const from = normalizeStatus(before.status)
  if (to === from) return

  await activityLogDB.append([
    {
      booking_id: id,
      action: 'SetStatus',
      from_status: from,
      to_status: to,
      actor: by?.actor ?? 'admin',
      actor_id: by?.actor_id ?? 'admin',
      ...(by?.actor_name ? { actor_name: by.actor_name } : {}),
      at: instantOf(by ?? {}),
      reason: 'Status set directly.',
    },
  ])
}

const isCloud = isFirebaseConfigured && Boolean(db)

// ----------------------------------------------------------------------------
// Public API — mirrors bookingsDB but cloud-aware
// ----------------------------------------------------------------------------
export const cloudBookingsDB = {
  // Check if we should use Firestore
  get isCloud() {
    return isCloud
  },

  async get(id: string): Promise<Booking | undefined> {
    if (!isCloud || !db) return bookingsDB.get(id)
    try {
      const snap = await getDoc(doc(db, COLLECTION, id))
      return snap.exists() ? mapDocToBooking(snap.id, snap.data()) : undefined
    } catch (e) {
      console.warn('[Firestore] get() failed, falling back to local', e)
      return bookingsDB.get(id)
    }
  },

  async list(): Promise<Booking[]> {
    if (!this.isCloud || !db) {
      return bookingsDB.list()
    }
    try {
      const q = query(collection(db, COLLECTION), orderBy('created_at', 'desc'))
      const snap = await getDocs(q)
      return snap.docs.map((d) => mapDocToBooking(d.id, d.data()))
    } catch (e) {
      console.warn('[Firestore] list() failed, falling back to local', e)
      return bookingsDB.list()
    }
  },

  /**
   * The Bookings that hang off one Guest identity.
   *
   * Queried by `uid` rather than fetched and filtered: firestore.rules lets a
   * Guest read a Booking only when it carries their own uid (ADR-0004), so a
   * Guest asking for everybody's Bookings is refused by the database, not by this
   * function. The composite index it needs (`uid`, `created_at`) is already in
   * firestore.indexes.json.
   */
  async listMine(uid: string | null | undefined): Promise<Booking[]> {
    if (!uid) return []
    if (!isCloud || !db) return bookingsDB.list().filter((booking) => booking.uid === uid)
    try {
      const q = query(collection(db, COLLECTION), where('uid', '==', uid), orderBy('created_at', 'desc'))
      const snap = await getDocs(q)
      return snap.docs.map((d) => mapDocToBooking(d.id, d.data()))
    } catch (e) {
      console.warn('[Firestore] listMine() failed, falling back to local', e)
      return bookingsDB.list().filter((booking) => booking.uid === uid)
    }
  },

  /** This Guest's own Bookings, as they change. */
  subscribeMine(
    uid: string | null | undefined,
    callback: (bookings: Booking[]) => void,
    onError?: (e: any) => void,
  ): () => void {
    if (!uid) {
      callback([])
      return () => {}
    }
    if (!this.isCloud || !db) {
      const handler = () => callback(bookingsDB.list().filter((booking) => booking.uid === uid))
      handler()
      window.addEventListener('hdl:bookings-updated', handler)
      return () => window.removeEventListener('hdl:bookings-updated', handler)
    }

    const q = query(collection(db, COLLECTION), where('uid', '==', uid), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        callback(snap.docs.map((d) => mapDocToBooking(d.id, d.data())))
      },
      (err) => {
        console.error('[Firestore] subscribeMine error', err)
        onError?.(err)
        callback(bookingsDB.list().filter((booking) => booking.uid === uid))
      },
    )
    return unsub
  },

  // Real-time subscription for admin page
  subscribe(callback: (bookings: Booking[]) => void, onError?: (e: any) => void): () => void {
    if (!this.isCloud || !db) {
      // Local fallback: poll localStorage via event
      const handler = () => callback(bookingsDB.list())
      handler()
      window.addEventListener('hdl:bookings-updated', handler)
      return () => window.removeEventListener('hdl:bookings-updated', handler)
    }

    const q = query(collection(db, COLLECTION), orderBy('created_at', 'desc'))
    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        const list = snap.docs.map((d) => mapDocToBooking(d.id, d.data()))
        callback(list)
      },
      (err) => {
        console.error('[Firestore] subscribe error', err)
        onError?.(err)
        // Fallback to local on error
        callback(bookingsDB.list())
      }
    )
    return unsub
  },

  /**
   * Submit a Booking.
   *
   * Places the 24-hour Date hold on its dates as stored data, and writes the
   * Booking's first Activity log entry. The `actor` is whoever is submitting —
   * a Guest from /book — and defaults to an unnamed Guest.
   */
  async add(input: Omit<Booking, 'id' | 'status' | 'created_at'>, actor?: Actor): Promise<Booking> {
    const at = instantOf(actor ?? {})
    const holdExpiresAt = initialHoldExpiry(at)
    const withHold = { ...input, hold_expires_at: holdExpiresAt }

    if (!isCloud || !db) {
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      return booking
    }
    try {
      const payload: Omit<FirestoreBooking, 'id'> = {
        ...withHold,
        status: 'Pending',
        created_at: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, COLLECTION), payload)
      await activityLogDB.append([submissionEntry(ref.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      // Return optimistic booking
      return {
        id: ref.id,
        ...withHold,
        status: 'Pending',
        created_at: at,
      }
    } catch (e) {
      console.warn('[Firestore] add() failed, falling back to local', e)
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, actor ?? { actor: 'guest', actor_id: 'guest' }, at)])
      return booking
    }
  },

  /**
   * The status this Booking reads as, right now.
   *
   * The read-time rule from ADR-0002, applied by every surface instead of each
   * one guessing: a Booking whose Date hold ran out reads as Expired whether the
   * Guest is looking or the Admin is, and nothing has to be written for that to be
   * true.
   */
  readStatus(booking: Booking, now: string | number | Date = Date.now()): BookingStatus {
    return effectiveStatus(booking, now)
  },

  /** Milliseconds of Date hold a Guest has left; zero once it has run out. */
  holdRemaining(booking: Booking, now: string | number | Date = Date.now()): number {
    return holdMsRemaining(booking, now)
  },

  /** The Guest-facing wording for the hold they have left. */
  holdCountdown(booking: Booking, now: string | number | Date = Date.now()): string {
    return formatHoldCountdown(holdMsRemaining(booking, now))
  },

  /**
   * Are these dates free for a Guest to ask for?
   *
   * The same rule the Admin's approval re-check applies (G2), with the unit count
   * taken from the published Accommodations, so a Guest is never offered dates
   * that are already held and the Admin is never asked to refuse them by hand.
   */
  async checkAvailability(
    request: DateRange,
    options: { now?: string | number | Date } = {},
  ): Promise<{ available: boolean; conflicts: HoldBearingBooking[] }> {
    const now = options.now ?? Date.now()
    const bookings = await this.list()
    const conflicts = findDateConflicts(request, bookings, {
      unitsAvailable: unitsForAccommodation(request.accommodation, ACCOMMODATIONS),
      now,
    })
    return { available: conflicts.length === 0, conflicts }
  },

  /**
   * Record that a Date hold has run out.
   *
   * Reading a Booking never rewrites it (ADR-0002), so the stored document keeps
   * saying `Pending` while every surface reads `Expired`. This is the one place
   * that writes the fact down, and it refuses to do it twice: the expiry
   * happened once, at the instant the hold ran out, and the Activity log should
   * say so rather than say it every time somebody looked.
   */
  async materialiseExpiry(id: string, now: string | number | Date = Date.now()): Promise<ActionAccepted | ActionRefused> {
    // A hold expiring is never anybody's decision, so the actor is not a
    // parameter: it is the system, every time.
    return this.transition(id, { type: 'Expire' }, { actor: 'system', actor_id: 'system', actor_name: 'System', now })
  },

  /**
   * This Booking's Activity log, in the order it happened.
   *
   * On the bookings interface because reading a Booking and reading its history
   * is one job: the Admin opens a Booking to answer "who changed this and when".
   */
  async history(id: string): Promise<ActivityLogEntry[]> {
    return activityLogDB.list(id)
  },

  /**
   * Take one lifecycle action on a stored Booking.
   *
   * The rule lives in the lifecycle module, not here: this is the adapter that
   * loads the Booking, applies the action, stores the patch and appends the
   * Activity log entries the action owes. A refused action stores nothing and
   * logs nothing, so a Booking can never change state unlogged.
   *
   * Approve takes the transactional path: its availability re-check (G2) must
   * be atomic with the write, or two simultaneous approvals can both read the
   * dates as free and both claim the last unit (ADR-0006).
   */
  async transition(id: string, action: BookingAction, actor: Actor): Promise<ActionAccepted | ActionRefused> {
    if (action.type === 'Approve' && this.isCloud && db) {
      return this.transitionApprove(id, action, actor)
    }

    const booking = await this.get(id)
    if (!booking) return { ok: false, reason: 'No Booking with that id.' }

    const result = applyAction(booking, action, actor)
    if (!result.ok) return result

    // The action logged this change itself, so the write must not log it again:
    // one entry per state change, from the thing that made it.
    await writePatch(id, result.patch)
    await activityLogDB.append(result.entries)
    return result
  },

  /**
   * Approve, with the G2 re-check made atomic with the write (ADR-0006).
   *
   * The browser SDK's transaction reads documents, not queries, so the
   * protocol is split:
   *
   *   1. The callback — which the SDK reruns from the top on every abort —
   *      first reads the Bookings collection fresh. That read is not part of
   *      the transaction; it only decides whom to verify next.
   *   2. The Booking being approved, and every other Booking that still holds
   *      its dates, are then read through the transaction (approvalCouplingSet
   *      says who). Their data is not used — the reads are what couple
   *      concurrent approvals: a rival approval that commits in between makes
   *      one of the reads stale, this transaction aborts, and the callback
   *      reruns on the changed world.
   *   3. The decision is re-applied to the fresh document, and the patch is
   *      written through the same transaction.
   *
   * A refused approval writes nothing, so there is nothing to roll back: a
   * refused action stores nothing and logs nothing, as ever. The Activity
   * entry follows the commit through the regular append-only path — the log's
   * sequence is managed with a query of its own, and it must not start before
   * this transaction has actually committed (a logged approval whose write
   * aborted would be a false record, and the log is append-only).
   */
  async transitionApprove(
    id: string,
    action: Extract<BookingAction, { type: 'Approve' }>,
    actor: Actor,
  ): Promise<ActionAccepted | ActionRefused> {
    const result = await runTransaction(db!, async (tx) => {
      // 1. The world as it is now — inside the retryable callback, so a rerun
      //    sees whatever a rival approval has committed.
      const snapshot = await getDocs(query(collection(db!, COLLECTION), orderBy('created_at', 'desc')))
      const bookings = snapshot.docs.map((d) => mapDocToBooking(d.id, d.data()))

      // 2a. The Booking being approved, transactionally: a Booking cancelled
      //     or expired between the Admin's click and now is refused here, not
      //     approved on a stale read.
      const target = await tx.get(doc(db!, COLLECTION, id))
      if (!target.exists()) return { ok: false as const, reason: 'No Booking with that id.' }
      const booking = mapDocToBooking(target.id, target.data())

      // 2b. The coupling reads: one per overlapping date-holder, data unused.
      for (const rival of approvalCouplingSet(booking, bookings, instantOf(actor))) {
        await tx.get(doc(db!, COLLECTION, rival.id))
      }

      // 3. The decision on the fresh state, then the write — one atomic step.
      //    The action's payload carries the unit count the Admin published;
      //    the booking list is this fresh read, not the Admin's screen copy.
      const decision = applyAction(
        booking,
        { ...action, availability: { ...action.availability, bookings } },
        actor,
      )
      if (!decision.ok) return decision

      const { id: _omit, ...rest } = decision.patch as Record<string, unknown>
      tx.update(target.ref, rest)
      return decision
    })

    if (result.ok) {
      await activityLogDB.append(result.entries)
    }
    return result
  },

  /**
   * Write a patch to a stored Booking.
   *
   * Status changes made this way bypass the lifecycle's own rules, but they are
   * never bypass-able *and* silent: the log entry is written here, by the change
   * itself, so no surface can move a Booking without a trace (spec #9).
   * `transition()` is the door that checks the rules as well.
   */
  async update(id: string, patch: Partial<Booking>, by?: Actor): Promise<void> {
    const before = await this.get(id)
    await writePatch(id, patch)
    await logStatusChange(id, before, patch, by)
  },
}
