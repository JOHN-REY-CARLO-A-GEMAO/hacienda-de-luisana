// Approval-protocol invariants (booking capacity correctness, 2026-10-12).
//
// The cloud approval protocol is only sound while ONE fact holds: the only way a
// Booking starts counting against an Accommodation's capacity is the Admin's
// Approve, and every Approve bumps that Accommodation's lock version. A future
// status, a bulk import, or a raw write that reaches a committed status without
// going through Approve would reopen the double-booking window with no other
// test failing — the failure mode is an absence of protection, not a wrong
// answer. This file pins the fact from behaviour rather than restating it.
import { expect, it } from 'vitest'
import { BOOKING_STATUSES, canTransition, isAvailable, type BookingStatus } from '../../src/lib/booking'
import { booking, NOW } from './fixtures'

/** `COMMITTED_STATUSES` in src/lib/booking/availability.ts, as ADR-0003 defines it. */
const COUNTS_AT_APPROVAL: readonly BookingStatus[] = [
  'Approved',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Checked-In',
  'Staying',
  'Checked-Out',
]

function rivalIn(status: BookingStatus) {
  // No recorded hold: a Pending rival reads as Expired, so it stands for the
  // status the document actually carries rather than for its countdown. Same
  // Accommodation and same nights as the request below, so the only thing that
  // can decide the question is the status.
  return booking({ status, hold_expires_at: null })
}

it('F06 DESIRED: exactly the committed statuses make a one-unit Accommodation unavailable to an approval', () => {
  for (const status of BOOKING_STATUSES) {
    const blocks = !isAvailable(booking(), [rivalIn(status)], {
      unitsAvailable: 1,
      forApproval: true,
      now: NOW,
    })
    expect({ status, blocks }).toEqual({ status, blocks: COUNTS_AT_APPROVAL.includes(status) })
  }
})

it('F06 DESIRED: Pending -> Approved is the only edge into a status that counts at approval', () => {
  const edges: string[] = []
  for (const from of BOOKING_STATUSES) {
    for (const to of BOOKING_STATUSES) {
      if (from === to || !canTransition(from, to)) continue
      if (!COUNTS_AT_APPROVAL.includes(from) && COUNTS_AT_APPROVAL.includes(to)) edges.push(`${from} -> ${to}`)
    }
  }
  expect(edges).toEqual(['Pending -> Approved'])
})