// Ticket #11: every state change to a Booking is recorded, and the Admin can read
// the record. The log is append-only, and the Admin's view is ordered.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { activityLogDB, cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { describeActivity } from '../../src/lib/booking'
import type { ActivityLogEntry } from '../../src/lib/booking'

const guest = { actor: 'guest', actor_id: 'guest-1', actor_name: 'Maria Santos' } as const
const admin = { actor: 'admin', actor_id: 'admin-1', actor_name: 'Ana Luisana' } as const
const NOW = '2026-09-20T01:00:00.000Z'

const request = {
  guest_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: 'maria@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-04',
  guests: 4,
  accommodation: 'main-house',
  special_requests: '',
}

beforeEach(() => {
  localStorage.clear()
  if (!('randomUUID' in crypto)) {
    let n = 0
    ;(crypto as Crypto & { randomUUID: () => string }).randomUUID = () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as ReturnType<typeof crypto.randomUUID>
  }
})

describe('the Activity log records every state change', () => {
  it('names the previous status, the new status and the reason for a change', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    await cloudBookingsDB.transition(booking.id, { type: 'UploadKyc', kyc_id_url: 'gs://ids/1.jpg' }, { ...guest, now: NOW })

    const rejected = await cloudBookingsDB.transition(
      booking.id,
      { type: 'Reject', reason: 'Government ID expired last month' },
      { ...admin, now: NOW },
    )
    expect(rejected.ok).toBe(true)

    const history = await activityLogDB.list(booking.id)
    expect(history.at(-1)).toMatchObject({
      action: 'Reject',
      from_status: 'KYC Submitted',
      to_status: 'Rejected',
      actor: 'admin',
      actor_id: 'admin-1',
      at: NOW,
      reason: 'Government ID expired last month',
    })
  })

  it('reads back in the order things happened, even when they happened in the same instant', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    // A Guest uploading an ID and the Admin approving it inside the same
    // millisecond is unusual but legal: the order must not depend on the clock
    // having moved on.
    for (const action of [
      { type: 'UploadKyc', kyc_id_url: 'gs://ids/1.jpg' },
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
    ] as const) {
      const actor = action.type === 'UploadKyc' ? guest : admin
      const result = await cloudBookingsDB.transition(booking.id, action, { ...actor, now: NOW })
      expect(result.ok).toBe(true)
    }

    const history = await activityLogDB.list(booking.id)
    expect(history.map((entry) => entry.action)).toEqual(['Submit', 'UploadKyc', 'Approve'])
    expect(history.map((entry) => entry.to_status)).toEqual(['Pending', 'KYC Submitted', 'Approved'])

    // The sequence is part of the record, so a reader can order it without
    // trusting two timestamps to differ.
    expect(history.map((entry) => entry.seq)).toEqual([0, 1, 2])
  })

  it('records one entry per Booking, and keeps another Booking out of it', async () => {
    const first = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    const second = await cloudBookingsDB.add({ ...request, guest_name: 'JP Santos' }, { ...guest, now: NOW })

    await cloudBookingsDB.transition(first.id, { type: 'UploadKyc', kyc_id_url: 'gs://ids/1.jpg' }, { ...guest, now: NOW })

    expect((await activityLogDB.list(first.id)).map((e) => e.action)).toEqual(['Submit', 'UploadKyc'])
    expect((await activityLogDB.list(second.id)).map((e) => e.action)).toEqual(['Submit'])
  })

  it('is reachable from the bookings interface the Admin already uses', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    expect((await cloudBookingsDB.history(booking.id)).map((e) => e.action)).toEqual(['Submit'])
  })
})

describe('the Activity log is append-only', () => {
  it('offers no way to edit or delete an entry, in either adapter', () => {
    expect(Object.keys(activityLogDB).sort()).toEqual(['append', 'list'])
  })

  it('is denied update and delete in the Firestore rules, including to the owner', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
    const activity = rules.slice(rules.indexOf('match /activity/{entryId}'))
    const block = activity.slice(0, activity.indexOf('\n    }'))

    expect(block).toMatch(/allow create:/)
    expect(block).toMatch(/allow read:/)
    expect(block).toMatch(/allow update, delete: if false/)
    // The Admin's usual write override must not appear here: nobody edits or
    // deletes an audit record.
    expect(block).not.toMatch(/allow (update|delete|write)[^;]*isAdmin\(\)/)
  })
})

// The Admin reads the log as sentences, so the wording is behaviour worth testing
// rather than string-munging buried in a component.
describe('describeActivity', () => {
  const entry = (over: Partial<ActivityLogEntry> = {}): ActivityLogEntry => ({
    booking_id: 'book-1',
    action: 'Approve',
    from_status: 'KYC Submitted',
    to_status: 'Approved',
    actor: 'admin',
    actor_id: 'admin-1',
    actor_name: 'Ana Luisana',
    at: '2026-09-20T01:00:00.000Z',
    seq: 2,
    ...over,
  })

  it('reads as what happened, who did it, and when', () => {
    const line = describeActivity(entry())

    expect(line.headline).toBe('Booking approved')
    expect(line.change).toBe('KYC Submitted → Approved')
    expect(line.actor).toBe('Ana Luisana (Admin)')
    expect(line.at).toBe('2026-09-20T01:00:00.000Z')
    expect(line.reason).toBeUndefined()
  })

  it('carries a display-ready instant, so the Admin view does its own formatting nowhere', () => {
    const line = describeActivity(entry())

    expect(line.atLabel).not.toBe('')
    expect(line.atLabel).not.toBe(line.at)
  })

  it('names the actor by role when nobody is named', () => {
    expect(describeActivity(entry({ actor_name: undefined, actor: 'system' })).actor).toBe('System')
    expect(describeActivity(entry({ actor_name: undefined, actor: 'guest' })).actor).toBe('Guest')
  })

  it('says what each action did, in the glossary’s words', () => {
    expect(describeActivity(entry({ action: 'Submit', from_status: 'Pending', to_status: 'Pending' })).headline).toBe(
      'Booking submitted',
    )
    expect(describeActivity(entry({ action: 'UploadKyc', to_status: 'KYC Submitted' })).headline).toBe(
      'Government ID uploaded for KYC',
    )
    expect(describeActivity(entry({ action: 'Reject', to_status: 'Rejected' })).headline).toBe('Booking rejected')
    expect(describeActivity(entry({ action: 'VerifyPayment', to_status: 'Reserved' })).headline).toBe(
      'Payment proof verified — Booking Reserved',
    )
    expect(describeActivity(entry({ action: 'Cancel', to_status: 'Cancelled' })).headline).toBe('Booking cancelled')
    expect(describeActivity(entry({ action: 'Expire', to_status: 'Expired' })).headline).toBe('Date hold ran out')
    expect(describeActivity(entry({ action: 'CheckIn', to_status: 'Checked-In' })).headline).toBe(
      'First Credential use — Guest checked in',
    )
    expect(describeActivity(entry({ action: 'MarkRefunded', to_status: 'Cancelled' })).headline).toBe(
      'Refund returned to the Guest',
    )
  })

  it('carries the reason through when the action had one', () => {
    expect(describeActivity(entry({ action: 'Reject', reason: 'ID was blurred' })).reason).toBe('ID was blurred')
  })
})

// Spec #9: "The Activity log is append-only and written by the state change
// itself, not by the UI that triggered it, so a transition cannot happen
// unlogged." The Admin dashboard still sets a status directly today (moving it
// onto the lifecycle's own actions is ticket #13), so that write is logged too —
// a status change with no entry behind it is the hole the spec closes.
describe('a status written straight to the store is still logged', () => {
  it('appends an entry naming the previous status and the new one', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    await cloudBookingsDB.update(booking.id, { status: 'Reserved' })

    const history = await activityLogDB.list(booking.id)
    expect(history.map((entry) => entry.action)).toEqual(['Submit', 'SetStatus'])
    expect(history.at(-1)).toMatchObject({
      from_status: 'Pending',
      to_status: 'Reserved',
      actor: 'admin',
    })
  })

  it('logs nothing for a patch that changes no status, so a non-state write stays out of the log', () => {
    return (async () => {
      const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

      // Live location no longer rides on the Booking at all (G6): a session
      // write never touches the Activity log. A plain Booking patch that
      // changes nothing but a note must be just as quiet.
      await cloudBookingsDB.update(booking.id, { special_requests: 'Birthday celebration — no candles' })

      expect((await activityLogDB.list(booking.id)).map((entry) => entry.action)).toEqual(['Submit'])
    })()
  })

  it('logs nothing when the status written is the one it already had', async () => {
    const booking = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    await cloudBookingsDB.update(booking.id, { status: 'Pending' })

    expect((await activityLogDB.list(booking.id)).map((entry) => entry.action)).toEqual(['Submit'])
  })
})
