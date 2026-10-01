// Actual pure TS module behavior. No claim of a cloud ledger, raced commit,
// deployed authorization, device actuation or real money received.
import { describe, expect, it } from 'vitest'
import { applyAction, assertSubmittable, BOOKING_STATUSES, interpretStoredStatus, isAvailable, datesOverlap } from '../../src/lib/booking'
import { activityLogStorage } from '../../src/lib/storage'
import { booking, approved, actor, NOW, scenarios } from './fixtures'

describe('current new and historical flow (model, not browser/native E2E)', () => {
  it('FLOW-NEW: proof precedes Pending; Approved goes directly to stay progression', () => {
    const input = booking()
    expect(assertSubmittable(input).ok).toBe(true)
    let state = input
    const statuses = [state.status]
    for (const action of [
      { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } },
      { type: 'CheckIn' }, { type: 'BeginStay' }, { type: 'CheckOut' }, { type: 'Complete' },
    ] as const) {
      const result = applyAction(state, action, actor())
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.reason)
      expect(result.entries).toEqual([expect.objectContaining({ actor: 'admin', actor_id: scenarios.identities.adminA.uid, at: NOW })])
      state = { ...state, ...result.patch }
      statuses.push(state.status)
    }
    expect(statuses).toEqual(scenarios.states.newPath)
    expect(statuses).not.toContain('Reserved')
  })
  it('FLOW-HISTORICAL: Payment Pending verification still lands on Reserved', () => {
    const result = applyAction(booking({ status: 'Payment Pending', payment_plan: 'full', amount_claimed: 13500 }), { type: 'VerifyPayment', amount_verified: 13500 }, actor())
    expect(result).toMatchObject({ ok: true, patch: { status: 'Reserved', payment_status: 'verified' } })
  })
  it('FLOW-TERMINAL: rejection, cancellation and expiry remain separate terminal branches', () => {
    for (const [action, expected, who] of [
      [{ type: 'Reject', reason: 'Synthetic declined request' }, 'Rejected', actor()],
      [{ type: 'Cancel', reason: 'Synthetic withdrawal' }, 'Cancelled', actor('anonymousGuest')],
      [{ type: 'Expire' }, 'Expired', { actor: 'system', actor_id: 'system', now: '2026-10-03T04:00:00.000Z' }],
    ] as const) expect(applyAction(booking(), action, who)).toMatchObject({ ok: true, patch: { status: expected } })
  })
  it('FIXTURES: represent every implemented status and retired read compatibility without introducing one', () => {
    const represented = [...scenarios.states.new, ...scenarios.states.historical]
    expect(BOOKING_STATUSES.every(status => represented.includes(status))).toBe(true)
    expect(interpretStoredStatus('Confirmed')).toBe('Reserved')
    expect(interpretStoredStatus('KYC Submitted')).toBe('Pending')
  })
  it('FLOW-GUARDS: unsigned financial verification is not a Guest action; missing proof cannot submit', () => {
    expect(applyAction(booking(), { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor('anonymousGuest')).ok).toBe(false)
    expect(assertSubmittable(booking(scenarios.money.noPayment)).ok).toBe(false)
  })
})

describe('observed financial behavior, separate from desired invariants', () => {
  it('F02/F07-TAMPERED-QUOTE: ₱1 claimed and zero due is accepted on a ₱24,000 stay', () => {
    expect(applyAction(booking(scenarios.money.tamperedPartial), { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()))
      .toMatchObject({ ok: true, patch: { status: 'Approved', amount_verified: 1 } })
  })
  it('F07-PARTIAL-CONTROL: unchanged required due refuses an insufficient claim', () => {
    expect(applyAction(booking(scenarios.money.partial), { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()).ok).toBe(false)
  })
  it('F07-OVERPAYMENT: approval copies the claim but neither recalculates balance nor represents overage', () => {
    const state = booking(scenarios.money.overpayment)
    const result = applyAction(state, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
    expect(result).toMatchObject({ ok: true, patch: { amount_verified: 30000 } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.patch).not.toHaveProperty('balance_due')
    expect({ ...state, ...result.patch }).toMatchObject({ amount_verified: 30000, balance_due: 13500 })
  })
  it('F07-DUPLICATE-REFERENCE: two independent approvals accept the same transfer claim', () => {
    const a = booking(scenarios.money.duplicateReference)
    const b = booking({ ...scenarios.money.duplicateReference, id: 'phase0-booking-b', accommodation: 'casita-del-rio' })
    const results = [a, b].map(state => applyAction(state, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()))
    expect(results.map(result => result.ok)).toEqual([true, true])
    expect(results.map(result => result.ok ? result.patch.amount_verified : 0)).toEqual([12000, 12000])
    // An authoritative transfer allocation service is absent; this does NOT
    // claim that a real bank transfer or a production approval was duplicated.
  })
  it.each(['Reject', 'Cancel', 'Expire'] as const)('F08-PAID-PENDING-%s: no transfer-resolution fact is produced by the terminal model action', type => {
    const state = booking()
    const action = type === 'Reject' ? { type, reason: 'Synthetic inventory unavailable' } : { type }
    const result = applyAction(state, action, type === 'Expire'
      ? { actor: 'system', actor_id: 'system', now: '2026-10-03T04:00:00.000Z' } : actor())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.patch.refund_status ?? state.refund_status).toBe('none')
    expect(result.patch.amount_verified).toBeUndefined()
  })
  it('F09-EARLY-COMPLETION: dates, outstanding balance and deposit are not progression gates', () => {
    let state = approved(scenarios.money.outstandingBalanceAndDeposit)
    for (const type of ['CheckIn', 'BeginStay', 'CheckOut', 'Complete'] as const) {
      const result = applyAction(state, { type }, actor())
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.reason)
      state = { ...state, ...result.patch }
    }
    expect(state).toMatchObject({ status: 'Completed', balance_due: 23999, security_deposit: 1500, check_in: '2026-12-01' })
  })
  it('F10-SAME-VERSION-POLICY: supplied current contents change settlement despite the same recorded version', () => {
    const state = approved()
    const refunds = [scenarios.policy.historical, scenarios.policy.changedSameVersion].map(policy => {
      const result = applyAction(state, { type: 'Cancel', refund: { policy } }, actor())
      if (!result.ok) throw new Error(result.reason)
      return result.patch.refund_total
    })
    expect(refunds).toEqual([12000, 1500])
    expect(state.policy_version).toBe('phase0-v1')
  })
  it('F08-REFUND-STATES: initiated and completed refunds remain represented; marking return is Admin-only', () => {
    expect(applyAction(booking(scenarios.money.refundPending), { type: 'MarkRefunded' }, actor())).toMatchObject({ ok: true, patch: { status: 'Cancelled', refund_status: 'refunded' } })
    expect(applyAction(booking(scenarios.money.refundCompleted), { type: 'MarkRefunded' }, actor()).ok).toBe(false)
    expect(applyAction(booking(scenarios.money.refundPending), { type: 'MarkRefunded' }, actor('anonymousGuest')).ok).toBe(false)
  })
})

describe('inventory fixtures and current counting', () => {
  it('F11-CONSECUTIVE-NIGHTS: two disjoint single-night reservations falsely exhaust two units', () => {
    const request = booking({ accommodation: 'house-a-camping' })
    expect(datesOverlap('2026-12-01', '2026-12-02', '2026-12-02', '2026-12-03')).toBe(false)
    expect(isAvailable(request, scenarios.inventory.consecutiveNights, { unitsAvailable: 2, now: NOW, forApproval: true })).toBe(false)
  })
  it('F11-POSITIVE-CONTROL: truly simultaneous occupation of both units blocks overlapping dates', () => {
    expect(isAvailable(booking({ accommodation: 'house-a-camping' }), scenarios.inventory.overlappingNights, { unitsAvailable: 2, now: NOW, forApproval: true })).toBe(false)
  })
  it('F29-MAINTENANCE-SEPARATION: the booking unit resolver has no physical room-status input', () => {
    expect(scenarios.inventory.maintenanceUnit.status).toBe('maintenance')
    expect(isAvailable(booking({ accommodation: 'house-a-camping' }), [], { unitsAvailable: scenarios.inventory.multipleUnits.availableUnits, now: NOW })).toBe(true)
  })
})

describe('Activity is a client-side record, not an authoritative event ledger', () => {
  it('F18-REPLAY: appending the same client entry twice creates two Activity records', () => {
    const result = applyAction(booking(), { type: 'Reject', reason: 'Synthetic rejection' }, actor())
    if (!result.ok) throw new Error(result.reason)
    activityLogStorage.append(result.entries)
    activityLogStorage.append(result.entries)
    expect(activityLogStorage.list(booking().id)).toHaveLength(2)
    expect(activityLogStorage.list(booking().id).map(entry => entry.seq)).toEqual([0, 1])
  })
  it('F18-ACTOR-TIME: approval and refund models attribute Admin A and Admin B with deterministic time', () => {
    const a = applyAction(booking(), { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
    const b = applyAction(booking(scenarios.money.refundPending), { type: 'MarkRefunded' }, actor('adminB'))
    expect(a).toMatchObject({ ok: true, entries: [expect.objectContaining({ action: 'Approve', actor_id: scenarios.identities.adminA.uid, at: NOW })] })
    expect(b).toMatchObject({ ok: true, entries: [expect.objectContaining({ action: 'MarkRefunded', actor_id: scenarios.identities.adminB.uid, at: NOW })] })
  })
})
