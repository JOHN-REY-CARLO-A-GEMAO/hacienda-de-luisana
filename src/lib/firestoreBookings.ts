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
import { auth, db, isFirebaseConfigured } from './firebase'
import { activityLogStorage, bookingsDB, type Booking } from './storage'
import { describeFirestoreFailure } from './firebaseFailure'
import { ACCOMMODATIONS } from '../config/site'
import { bookingPolicyDB } from './bookingPolicyDB'
import {
  applyAction,
  approvalCouplingSet,
  effectiveStatus,
  findDateConflicts,
  formatHoldCountdown,
  holdMsRemaining,
  instantOf,
  assertSubmittable,
  interpretStoredStatus,
  normalizeStatus,
  unitsForAccommodation,
  validateMinimumBookingLeadTime,
  type BookingDateValidation,
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
    status: interpretStoredStatus(data.status, {
      payment_status: data.payment_status,
      payment_proof_url: data.payment_proof_url ?? data.paymentProofUrl ?? null,
    }),
    created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || new Date().toISOString(),
    // Booking lifecycle v2 (additive — absent on Bookings stored before it)
    hold_expires_at: data.hold_expires_at ?? null,
    rejection_reason: data.rejection_reason ?? null,
    payment_plan: data.payment_plan,
    payment_status: data.payment_status,
    payment_proof_url: data.payment_proof_url ?? null,
    paymentProofUrl: data.paymentProofUrl ?? null,
    extractedRefNumber: data.extractedRefNumber ?? null,
    payment_reject_reason: data.payment_reject_reason ?? null,
    amount_claimed: typeof data.amount_claimed === 'number' ? data.amount_claimed : undefined,
    payment_reference: data.payment_reference,
    ocr_reference: data.ocr_reference,
    ocr_amount: data.ocr_amount,
    payment_verified_at: data.payment_verified_at ?? null,
    payment_verified_by: data.payment_verified_by ?? null,
    nights: typeof data.nights === 'number' ? data.nights : undefined,
    rate_amount: typeof data.rate_amount === 'number' ? data.rate_amount : undefined,
    rate_unit: data.rate_unit === 'night' || data.rate_unit === 'standard_stay' ? data.rate_unit : undefined,
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
    // P3-era keys still present on documents stored before Government ID KYC
    // was removed (2026-09-27 — recorded in ADR-0004's amendment): ref_id, uid
    // and source are kept; the KYC fields are dropped on read rather than
    // carried through the type.
    ref_id: data.ref_id,
    uid: data.uid,
    source: data.source,
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
    const signed = signActivityEntries(entries, auth?.currentUser?.uid)
    try {
      // Grouped per Booking, because the sequence continues from that Booking's
      // last entry. The id is the sequence, so two appends that both think they
      // are next collide instead of silently reordering the log.
      const byBooking = new Map<string, ActivityLogEntry[]>()
      for (const entry of signed) {
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
 * Sign a batch of Activity entries with the identity that is actually connected.
 *
 * `firestore.rules` refuses an entry whose `actor_id` is not the uid making the
 * write — an append-only log that lets a writer name somebody else is no log at
 * all — so an entry the caller attributed to a different uid (a Booking minted
 * before ADR-0004 forced an identity, a `guest` placeholder) is refused by the
 * database and drops out of the cloud log while the change it describes still
 * lands. Signing it with the writer keeps the two facts together: the entry says
 * who did write it. A `system` entry is the one that belongs to nobody — the
 * Admin app's screen recording a Date hold running out (ADR-0002) — and is left
 * exactly as it was written.
 */
export function signActivityEntries<T extends { actor: string; actor_id: string }>(
  entries: readonly T[],
  writerUid: string | null | undefined,
): readonly T[] {
  if (!writerUid) return entries
  return entries.map((entry) =>
    entry.actor !== 'system' && entry.actor_id !== writerUid ? { ...entry, actor_id: writerUid } : entry,
  )
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

/** A status or money marker a Guest must not be able to invent in this browser. */
function patchClaimsADecision(patch: Partial<Booking>): boolean {
  const status = patch.status ? normalizeStatus(patch.status) : undefined
  if (
    status &&
    ['Approved', 'Reserved', 'Payment Verified', 'Checked-In', 'Staying', 'Checked-Out', 'Completed'].includes(status)
  ) {
    return true
  }
  return patch.payment_status === 'verified' || patch.amount_verified != null || Boolean(patch.payment_verified_by)
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
    lastWriteFailure = describeFirestoreFailure(e)
    // A refused cloud write is not a local approval. Demo mode (no Firebase)
    // still writes above; a configured project that rejects the write must not
    // leave this browser believing the Hacienda accepted it.
    if (patchClaimsADecision(patch)) {
      console.warn(`[Firestore] update() refused a decision. ${lastWriteFailure.advice}`, e)
      throw e
    }
    console.warn(`[Firestore] update() failed, falling back to local. ${lastWriteFailure.advice}`, e)
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

/**
 * A Booking that has just been submitted, and where it actually landed.
 *
 * `storage` is not decoration. A cloud write can fail when the Guest is offline
 * or the project is unavailable; those failures keep the Booking locally so
 * nothing typed is lost. Security refusals are NOT replayed locally: the
 * payment page retains the draft, but creates no Booking or Activity entry.
 * The screen that says "sent" has to know which of the two happened, because
 * "sent to the Hacienda" and "saved in your browser" are different promises to
 * a Guest, and only one of them gets the Guest their dates.
 */
export type SubmittedBooking = Booking & { storage: 'cloud' | 'local' }

/** Why the last cloud write fell back to this browser, if it did. */
let lastWriteFailure: ReturnType<typeof describeFirestoreFailure> | null = null

/** Why the last cloud write fell back to this browser, or null if it landed. */
export function lastCloudWriteFailure(): ReturnType<typeof describeFirestoreFailure> | null {
  return lastWriteFailure
}

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
      // No fabricated data. In cloud mode this query is only authorised for an
      // Admin (firestore.rules: `isOwnDoc() || isAdmin()`, and `isOwnDoc()` is
      // per-document, so Firestore must refuse an unscoped read to a Guest), so for
      // every Guest this branch used to be the only branch that ran - and it
      // answered with whatever this browser happened to be holding. That is how a
      // Guest was told their dates were held by a Booking no other Guest can see,
      // including the test suite's fixtures written before vitest.config.ts was
      // made hermetic. An empty answer is honest; a borrowed one is not. A Guest's
      // own Bookings come from `listMine`, which the rules do allow.
      console.warn('[Firestore] list() was refused; answering with none', e)
      return []
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

  /** Courtesy/pre-upload guard. Only Firestore's request.time is authoritative. */
  async validateGuestCheckIn(checkIn: string): Promise<BookingDateValidation> {
    const days = await bookingPolicyDB.getMinimumLeadTimeDays()
    return validateMinimumBookingLeadTime(checkIn, new Date(), days)
  },

  /**
   * Submit a Booking.
   *
   * Places the 24-hour Date hold on its dates as stored data, and writes the
   * Booking's first Activity log entry. The `actor` is whoever is submitting —
   * a Guest from /book — and defaults to an unnamed Guest.
   */
  async add(
    input: Omit<Booking, 'id' | 'status' | 'created_at'>,
    actor?: Actor,
  ): Promise<SubmittedBooking> {
    // This is the public guest creation path; actor.now/source/uid must not
    // select the clock or grant an Admin exemption. Admin lifecycle updates
    // are separate and do not re-apply a creation-time constraint.
    const dates = await this.validateGuestCheckIn(input.check_in)
    if (!dates.ok) throw Object.assign(new Error(dates.reason), { code: dates.code })
    // The submission entry is signed by the identity the Booking is being
    // attached to. The Activity rule refuses an entry whose `actor_id` is not the
    // writer's uid, and the Booking carries the uid the Guest was given when the
    // form was opened (ADR-0004) — so the two are the same identity by
    // construction, not by convention.
    // ADR-0012: a Booking is born Pending, with a downpayment screenshot
    // already attached. A caller that skips the proof — or that tries to
    // arrive already verified — is refused here, not stored and wondered
    // about later. Verification fields are stripped so a Guest cannot claim
    // the Admin's decision at creation.
    const ready = assertSubmittable(input)
    if (!ready.ok) throw new Error(ready.reason)
    const {
      amount_verified: _amountVerified,
      payment_verified_at: _verifiedAt,
      payment_verified_by: _verifiedBy,
      ...rest
    } = input
    void _amountVerified
    void _verifiedAt
    void _verifiedBy
    const submitter: Actor = actor ?? { actor: 'guest', actor_id: rest.uid ?? 'guest' }
    const at = instantOf(submitter)
    const holdExpiresAt = initialHoldExpiry(at)
    const withHold = {
      ...rest,
      payment_status: 'pending' as const,
      payment_plan: rest.payment_plan ?? 'down-payment',
      hold_expires_at: holdExpiresAt,
    }

    if (!isCloud || !db) {
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, submitter, at)])
      return { ...booking, storage: 'local' }
    }
    try {
      const payload: Omit<FirestoreBooking, 'id'> = {
        ...withHold,
        status: 'Pending',
        created_at: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, COLLECTION), payload)
      await activityLogDB.append([submissionEntry(ref.id, submitter, at)])
      lastWriteFailure = null
      // Return optimistic booking
      return {
        id: ref.id,
        ...withHold,
        status: 'Pending',
        created_at: at,
        storage: 'cloud',
      }
    } catch (e) {
      // Remember why the write did not land. Non-policy failures keep the
      // existing labelled local fallback; a security refusal must store nothing.
      lastWriteFailure = describeFirestoreFailure(e)
      // A security refusal is not an offline booking. In particular, server
      // time/policy can reject a stale or manipulated client check. Never replay
      // that rejected create into localStorage or append an Activity entry.
      if (['permission-denied', 'unauthenticated'].includes(lastWriteFailure.code)) {
        // Surface a changed policy / midnight boundary as the domain message,
        // not Firebase's technical permission error. Other refusals stay generic.
        const days = await bookingPolicyDB.getMinimumLeadTimeDays()
        const currentDates = validateMinimumBookingLeadTime(input.check_in, new Date(), days)
        if (!currentDates.ok) throw Object.assign(new Error(currentDates.reason), { code: currentDates.code })
        throw new Error(`The booking could not be submitted. Check-in must be at least ${days} days from today. Please check your downpayment details and try again.`)
      }
      console.warn(
        `[Firestore] add() failed, falling back to local. ${lastWriteFailure.advice}`,
        e,
      )
      const booking = bookingsDB.add(withHold)
      activityLogStorage.append([submissionEntry(booking.id, submitter, at)])
      return { ...booking, storage: 'local' }
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

    // In cloud mode a Guest cannot be told whether other Guests hold the dates,
    // because the rules let them read only their own Booking and an availability
    // check needs to see everyone else's. There is no client-side query that
    // answers it, so this returns "no conflict" rather than inventing one - and
    // the check is not the real gate either way. The authoritative re-check is the
    // Admin's, run inside the approval transaction (G2, ADR-0006), which reads
    // Firestore under a rule that can see every Booking and cannot be raced.
    //
    // Previously this read `list()`, which for a Guest always failed and always
    // fell back to this browser's own store - so a Guest was refused their own
    // dates by a Booking no other Guest can see. That is the bug the demo-mode
    // branch below still usefully avoids.
    if (this.isCloud) return { available: true, conflicts: [] }

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
