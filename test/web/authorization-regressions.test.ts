// ----------------------------------------------------------------------------
// Authorization regressions — the findings of the first verification pass
// ----------------------------------------------------------------------------
// Every case here reproduces something a malicious (or merely careless)
// authenticated client was able to do before the rules were tightened, or
// checks that the three layers which have to agree about money — the lifecycle
// module, the rules file and the two apps — still agree.
//
// The rules are enforced by `firestore.rules`; this suite is about the *app*
// half of each finding, so a regression in the application code fails here even
// while the rules stay correct. The rules half lives in
// `test/rules/firestore-rules.test.ts` (offline, executed) and
// `test/emulator/rules.emulator.test.ts` (canonical, needs the Emulator Suite).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyAction, type Actor, type BookingAction, type BookingState, type BookingPatch } from '../../src/lib/booking'
import { cloudBookingsDB, activityLogDB, signActivityEntries } from '../../src/lib/firestoreBookings'
import { bookingsDB, activityLogStorage } from '../../src/lib/storage'
import { reviewDocId, reviewRecordFor } from '../../src/lib/reviewsCloud'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')

const GUEST_UID = 'guest-uid-1'
const ADMIN_UID = 'admin-uid-1'
const guest: Actor = { actor: 'guest', actor_id: GUEST_UID, now: '2026-09-24T02:00:00.000Z' }
const admin: Actor = { actor: 'admin', actor_id: ADMIN_UID, now: '2026-09-24T02:00:00.000Z' }

const booking = (over: Partial<BookingState> = {}): BookingState => ({
  id: 'booking-1',
  accommodation: 'villa-luisana',
  check_in: '2026-10-05',
  check_out: '2026-10-07',
  guests: 2,
  status: 'Payment Pending',
  kyc_status: 'approved',
  kyc_id_url: 'kyc/x/1/id.jpg',
  payment_plan: 'down-payment',
  payment_status: 'pending',
  payment_proof_url: 'payments/x/1/proof.jpg',
  amount_claimed: 6500,
  amount_due: 4500,
  security_deposit: 2000,
  stay_total: 9000,
  hold_expires_at: null,
  created_at: '2026-09-20T02:00:00.000Z',
  ...over,
})

/** One action of every type the lifecycle offers, with the input it needs. */
const everyAction = (state: BookingState): BookingAction[] => [
  { type: 'UploadKyc', kyc_id_url: 'kyc/x/1/id-2.jpg' },
  { type: 'Approve', availability: { bookings: [] } },
  { type: 'Reject', reason: 'dates unavailable' },
  { type: 'RejectKyc', reason: 'blurred' },
  {
    type: 'ChoosePaymentPlan',
    plan: 'down-payment',
    stayTotal: state.stay_total,
    rate: { securityDeposit: 2000, downPaymentPercent: 50 },
    policy: { version: '2026-09-24', effectiveDate: '2026-09-24' },
  },
  { type: 'UploadPaymentProof', payment_proof_url: 'payments/x/1/proof2.jpg', amount_claimed: 6500 },
  { type: 'VerifyPayment', amount_verified: 6500 },
  { type: 'RejectPaymentProof', reason: 'unreadable', guestResubmits: true },
  { type: 'Cancel', reason: 'changed plans' },
  { type: 'MarkRefunded' },
  { type: 'PurgeKyc' },
  { type: 'RevokeKey' },
  { type: 'Expire' },
  { type: 'CheckIn' },
  { type: 'BeginStay' },
  { type: 'CheckOut' },
  { type: 'Complete' },
]

const ACTIONS: BookingAction['type'][] = [
  'UploadKyc', 'Approve', 'Reject', 'RejectKyc', 'ChoosePaymentPlan', 'UploadPaymentProof',
  'VerifyPayment', 'RejectPaymentProof', 'Cancel', 'MarkRefunded', 'PurgeKyc', 'RevokeKey',
  'Expire', 'CheckIn', 'BeginStay', 'CheckOut', 'Complete',
]

/** The keys a Guest's own write may touch, read out of `firestore.rules`. */
const guestServeKeys = ((): string[] => {
  const bookings = rules.slice(rules.indexOf('match /bookings/{bookingId}'))
  const guestBranch = bookings.slice(bookings.indexOf('|| (isSignedIn()'))
  const list = guestBranch.match(/\.hasOnly\(\[([\s\S]*?)\]\)/)
  return list ? [...list[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]) : []
})()

/** The key list must have been found, or every comparison below is vacuous. */
describe('the rules text this suite compares against', () => {
  it('exposes the Guest self-serve key list, and it is the one we think it is', () => {
    expect(guestServeKeys).toContain('payment_status')
    expect(guestServeKeys).toContain('payment_proof_url')
    expect(guestServeKeys).not.toContain('amount_verified')
    expect(guestServeKeys).not.toContain('payment_verified_by')
    expect(guestServeKeys).not.toContain('payment_verified_at')
  })
})

// ---------------------------------------------------------------------------
// Finding 1 — payment-status forgery
// ---------------------------------------------------------------------------

describe('P0: a Guest can never produce a verified payment', () => {
  const starts = ['Pending', 'KYC Submitted', 'Approved', 'Payment Pending', 'Reserved'] as const

  it('never lets a guest-run action set payment_status to verified', () => {
    const offenders: string[] = []
    for (const status of starts) {
      for (const payment of ['unpaid', 'pending', 'rejected', 'verified'] as const) {
        const state = booking({ status, payment_status: payment })
        for (const action of everyAction(state)) {
          const result = applyAction(state, action, guest)
          if (result.ok && result.patch.payment_status === 'verified') {
            offenders.push(`${action.type} from ${status}/${payment}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never lets a Guest claim back more money than the Admin verified', () => {
    const offenders: string[] = []
    for (const status of starts) {
      const state = booking({ status, payment_status: 'verified', amount_verified: 6500 })
      for (const action of everyAction(state)) {
        const result = applyAction(state, action, guest)
        if (!result.ok) continue
        const total = result.patch.refund_total
        if (typeof total === 'number' && total > 6500) offenders.push(`${action.type} refund_total=${total}`)
        if (result.patch.refund_status === 'refunded') offenders.push(`${action.type} refunded the money`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('writes only keys a Guest is allowed to touch — no verification field among them', () => {
    const offenders: string[] = []
    for (const status of starts) {
      const state = booking({ status })
      for (const action of everyAction(state)) {
        for (const actor of [guest, admin]) {
          const result = applyAction(state, action, actor)
          if (!result.ok || actor.actor !== 'guest') continue
          for (const key of Object.keys(result.patch)) {
            if (!guestServeKeys.includes(key)) offenders.push(`${action.type} wrote ${key}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Finding 2 — the lifecycle's money gate
// ---------------------------------------------------------------------------

describe('P1: Reserved is the status verified money buys', () => {
  it('is reached by no action at all while the money is unverified', () => {
    const offenders: string[] = []
    for (const status of ['Pending', 'KYC Submitted', 'Approved', 'Payment Pending'] as const) {
      const state = booking({ status, payment_status: 'pending' })
      for (const action of everyAction(state)) {
        for (const actor of [guest, admin]) {
          const result = applyAction(state, action, actor)
          if (!result.ok || result.patch.status !== 'Reserved') continue
          // Reaching Reserved is only legal if the same patch carries the
          // verification, or the money was already verified.
          if (result.patch.payment_status !== 'verified' && state.payment_status !== 'verified') {
            offenders.push(`${action.type} as ${actor.actor} from ${status}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('is reached by VerifyPayment, and by that action only', () => {
    const state = booking({ status: 'Payment Pending', payment_status: 'pending' })
    const reached = everyAction(state)
      .map((action) => ({ action, result: applyAction(state, action, admin) }))
      .filter(({ result }) => result.ok && result.patch.status === 'Reserved')
      .map(({ action }) => action.type)
    expect(reached).toEqual(['VerifyPayment'])
  })

  it('always carries the marker the rules require of a verified document', () => {
    const state = booking({ status: 'Payment Pending', payment_status: 'pending' })
    const result = applyAction(state, { type: 'VerifyPayment', amount_verified: 6500 }, admin)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const patch: BookingPatch = result.patch
    expect(patch.payment_status).toBe('verified')
    expect(patch.amount_verified).toBeGreaterThan(0)
    expect(patch.payment_verified_at).toBeTruthy()
    expect(patch.payment_verified_by).toBe(admin.actor_id)
  })

  it('never verifies less than the stay owes, and never a Booking with no proof', () => {
    const underpaid = applyAction(booking(), { type: 'VerifyPayment', amount_verified: 100 }, admin)
    expect(underpaid.ok).toBe(false)
    const noProof = applyAction(booking({ payment_proof_url: null }), { type: 'VerifyPayment', amount_verified: 6500 }, admin)
    expect(noProof.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Finding 3 — the Activity log names the person who wrote it
// ---------------------------------------------------------------------------

describe('P1: the submission entry is signed by the identity the Booking belongs to', () => {
  it('names the Guest uid on the Booking, not a placeholder', async () => {
    window.localStorage.clear()
    const created = await cloudBookingsDB.add({
      guest_name: 'Ana Reyes',
      phone: '09171234567',
      email: 'ana@example.com',
      guests: 2,
      special_requests: '',
      accommodation: 'villa-luisana',
      check_in: '2026-11-01',
      check_out: '2026-11-03',
      uid: 'guest-uid-7',
    })
    const entries = activityLogStorage.list(created.id)
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('Submit')
    expect(entries[0].actor).toBe('guest')
    // The rule refuses an entry whose actor_id is not the writer's uid, and the
    // writer is the anonymous identity stamped on the Booking (ADR-0004).
    expect(entries[0].actor_id).toBe('guest-uid-7')
    bookingsDB.list().forEach((b) => b.uid === 'guest-uid-7' && bookingsDB.remove(b.id))
  })

  it('signs every entry with the identity making the write', () => {
    const entry = (actor: string, actor_id: string) => ({
      booking_id: 'booking-9',
      action: 'UploadKyc',
      from_status: 'Pending',
      to_status: 'Pending',
      actor,
      actor_id,
      at: '2026-09-24T02:00:00.000Z',
    })
    const signed = signActivityEntries([entry('guest', 'guest'), entry('guest', 'someone-else'), entry('system', 'system')], 'guest-uid-1')
    expect(signed.map((e) => e.actor_id)).toEqual(['guest-uid-1', 'guest-uid-1', 'system'])
    // No connected identity (the offline store): the entries are left alone.
    expect(signActivityEntries([entry('guest', 'guest')], null).map((e) => e.actor_id)).toEqual(['guest'])
  })

  it('never files an entry in another identity’s name from the store API', async () => {
    window.localStorage.clear()
    await activityLogDB.append([
      {
        booking_id: 'booking-9',
        action: 'Submit',
        from_status: 'Pending',
        to_status: 'Pending',
        actor: 'guest',
        actor_id: 'guest-uid-8',
        at: '2026-09-24T02:00:00.000Z',
      },
    ])
    const entries = activityLogStorage.list('booking-9')
    expect(entries.map((e) => e.actor_id)).toEqual(['guest-uid-8'])
  })
})

// ---------------------------------------------------------------------------
// Finding 5 — one Review per stay, written by the Guest who stayed
// ---------------------------------------------------------------------------

describe('P1: a Review is stored at the Booking it is about', () => {
  it('uses the Booking id as the document id — the fact the rule reads', () => {
    expect(reviewDocId('booking-1')).toBe('booking-1')
    const record = reviewRecordFor({ bookingId: 'booking-1', uid: GUEST_UID, stars: 5, text: ' ' })
    expect(record.booking_id).toBe(reviewDocId('booking-1'))
    expect(record.uid).toBe(GUEST_UID)
    expect(record.text).toBeUndefined()
  })

  it('keeps one Review per stay: the write is a set at that id, not an append', () => {
    // The rule closes updates, so a set at an id that already holds a Review is
    // refused by the database — the app's duplicate check and the rule agree.
    expect(rules).toContain('allow update: if false;')
    expect(rules).toContain('request.resource.data.booking_id == reviewId')
  })

  it('matches the keys and actions list of every action to a known type', () => {
    const names = everyAction(booking()).map((a) => a.type)
    expect(names).toEqual(ACTIONS)
  })
})
