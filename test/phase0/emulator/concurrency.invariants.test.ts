import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { environment, reset } from './helpers'
import {
  officialCachedSamePendingProtocol,
  officialIndependentAccommodationsSchedule,
  officialLastUnitSchedule,
  officialLateCreatedRivalSchedule,
  officialSameBookingDoubleApproval,
  officialSequentialControl,
  officialTrustedCapacitySchedule,
} from './concurrency-harness'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
it('F06 CANONICAL DESIRED: only one authoritative review commitment for one Pending booking', async () => {
  const result = await officialCachedSamePendingProtocol(env)
  expect(result.committedApprovals).toBe(1)
})
it('F06 CANONICAL DESIRED: only one committed booking for a capacity-one overlap', async () => {
  const result = await officialLastUnitSchedule(env)
  expect(result.approvedCount).toBe(1)
})
it('F06 CANONICAL DESIRED: a rival created and approved after the availability snapshot cannot also be claimed', async () => {
  // The window the coupling reads alone cannot see: the rival does not exist when
  // the query runs, so no transactional read of it can abort this approval. The
  // snapshot has to be invalidated by the Accommodation's lock version.
  const result = await officialLateCreatedRivalSchedule(env)
  expect(result.approvedCount).toBe(1)
  expect(result.results[0].ok).toBe(false)
  expect(result.results[1].ok).toBe(true)
  // One bump, not two: the losing approval discards its snapshot, decides, and
  // is refused — and a refused approval writes nothing, lock included.
  expect(result.lockVersion).toBe(1)
})
it('F06 CANONICAL DESIRED: two overlapping approvals issued together leave exactly one committed', async () => {
  const result = await officialLastUnitSchedule(env)
  expect(result.results.filter(decision => decision.ok)).toHaveLength(1)
})
it('F06 CANONICAL CONTROL: the same two approvals, issued one after the other, leave one committed and one refused', async () => {
  const result = await officialSequentialControl(env)
  expect(result.approvedCount).toBe(1)
  expect(result.results.map(decision => decision.ok)).toEqual([true, false])
})
it('F06 CANONICAL CONTROL: two Admins approving the SAME Pending Booking commit one review commitment', async () => {
  const result = await officialSameBookingDoubleApproval(env)
  expect(result.committedApprovals).toBe(1)
  expect(result.results.filter(decision => decision.ok)).toHaveLength(1)
})
it('F06 CANONICAL DESIRED: independent Accommodations approve together, each on its own lock', async () => {
  const result = await officialIndependentAccommodationsSchedule(env)
  expect(result.results.map(decision => decision.ok)).toEqual([true, true])
  expect(result.approvedCount).toBe(2)
  expect(result.lockVersions).toEqual([1, 1])
})
it.each([
  ['an inflated 999', 999],
  ['a malformed figure', 'many'],
  ['no figure at all', undefined],
])('F06 CANONICAL DESIRED: a caller claiming %s cannot buy more than the configured capacity', async (_label, claimed) => {
  const result = await officialTrustedCapacitySchedule(env, claimed)
  expect(result.approvedCount).toBe(1)
  expect(result.results.map(decision => decision.ok)).toEqual([true, false])
})