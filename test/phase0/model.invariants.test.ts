// Ordinary RED tests: these desired probes have no expected-failure wrapper.
// They expose the current API seam, not a pre-approved replacement design.
// Retarget to the approved trusted command boundary when one exists. Do not
// add state to pure functions, tighten rules or alter booking UX in Phase 0.
import { expect, it } from 'vitest'
import { applyAction, isAvailable } from '../../src/lib/booking'
import { activityLogStorage } from '../../src/lib/storage'
import { booking, approved, actor, NOW, scenarios } from './fixtures'

it('F02/F07 DESIRED: a positive recorded quote cannot be confirmed for a tampered zero-due/₱1 claim', () => {
  expect(applyAction(booking(scenarios.money.tamperedPartial), { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor()).ok).toBe(false)
})
it('F07 DESIRED: fully credited quoted money cannot leave the old outstanding balance', () => {
  const state = booking({ amount_claimed: 25500 })
  const decision = applyAction(state, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actor())
  if (!decision.ok) throw new Error(decision.reason)
  expect({ ...state, ...decision.patch }).toMatchObject({ balance_due: 0 })
})
it('F09 DESIRED: future-dated stay cannot check in before its allowed date', () => {
  expect(applyAction(approved(), { type: 'CheckIn' }, actor()).ok).toBe(false)
})
it('F09 DESIRED: completion cannot erase outstanding money/deposit obligations', () => {
  expect(applyAction(approved({ ...scenarios.money.outstandingBalanceAndDeposit, status: 'Checked-Out' }), { type: 'Complete' }, actor()).ok).toBe(false)
})
it('F10 DESIRED: settlement is stable for the recorded policy, not caller-supplied changed contents', () => {
  const refunds = [scenarios.policy.historical, scenarios.policy.changedSameVersion].map(policy => {
    const result = applyAction(approved(), { type: 'Cancel', refund: { policy } }, actor())
    if (!result.ok) throw new Error(result.reason)
    return result.patch.refund_total
  })
  expect(refunds[1]).toBe(refunds[0])
})
it('F11 DESIRED: at most one occupied unit on each night leaves a unit free in a capacity-two stay', () => {
  expect(isAvailable(booking({ accommodation: 'house-a-camping' }), scenarios.inventory.consecutiveNights, { unitsAvailable: 2, forApproval: true, now: NOW })).toBe(true)
})
it('F18 DESIRED: retry of the same logical Activity intent has no duplicate side effect', () => {
  const result = applyAction(booking(), { type: 'Reject', reason: 'Synthetic same-intent retry' }, actor())
  if (!result.ok) throw new Error(result.reason)
  activityLogStorage.append(result.entries)
  activityLogStorage.append(result.entries)
  expect(activityLogStorage.list(booking().id)).toHaveLength(1)
})
