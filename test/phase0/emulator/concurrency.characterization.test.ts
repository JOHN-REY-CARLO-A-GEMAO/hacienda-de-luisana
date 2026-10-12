// Characterisation: what the shipped clients actually do, against the canonical
// Firebase rules. Behaviour here is recorded, not endorsed — the matching
// `*.invariants.test.ts` file says what it should be.
//
// CHANGED 2026-10-12 (booking capacity correctness). The stale-query schedule
// below used to record TWO approved Bookings for a one-unit Accommodation, and
// `expect(approvedCount).toBe(2)` was the point: it is the reproduced bug. The
// approval protocol now carries the Accommodation's lock version across its
// availability query, so the losing Admin discards the snapshot and re-reads the
// world. The expectation is inverted to the fixed behaviour and the reason is
// recorded here rather than left to be rediscovered.
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
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
it('F06-CANONICAL-CURRENT two cached Admin decisions on SAME Pending booking can both batch-commit under a blind batch write', async () => {
  const result = await officialCachedSamePendingProtocol(env)
  expect(result.committedApprovals).toBe(2)
  expect(result.final.status).toBe('Approved')
  expect(result.final.payment_verified_by).toBe(scenarios.identities.adminB.uid)
  // This is a documented batch protocol against actual rules, not Flutter
  // execution, a physical device, or an observed production incident. Neither
  // client writes an approval with a blind batch today: both approve through
  // `runTransaction`, which carries the target document's read version, so this
  // case records what a *hypothetical* batch write would do, not what ships.
})
it('F06-CANONICAL-CURRENT actual JS adapter stale-query schedule now leaves ONE booking approved of capacity ONE', async () => {
  const result = await officialLastUnitSchedule(env)
  expect(result.approvedCount).toBe(1)
  expect(result.results.filter(decision => decision.ok)).toHaveLength(1)
})
it('F06-CANONICAL-CURRENT a late-created, late-approved rival is seen by the losing Admin only after its snapshot is discarded', async () => {
  const result = await officialLateCreatedRivalSchedule(env)
  expect(result.approvedCount).toBe(1)
  expect(result.results.map(decision => decision.ok)).toEqual([false, true])
  // One bump, not two: the refused approval writes nothing, lock included.
  expect(result.lockVersion).toBe(1)
})
it('F06-CANONICAL-CURRENT the same two Bookings approved in sequence leave one refused', async () => {
  const result = await officialSequentialControl(env)
  expect(result.approvedCount).toBe(1)
  expect(result.results.map(decision => decision.ok)).toEqual([true, false])
})
it('F06-CANONICAL-CURRENT an inflated caller capacity does not buy a second unit', async () => {
  const result = await officialTrustedCapacitySchedule(env, 999)
  expect(result.approvedCount).toBe(1)
  expect(result.results.map(decision => decision.ok)).toEqual([true, false])
})
it('F06-CANONICAL-CURRENT independent Accommodations bump their own lock documents', async () => {
  const result = await officialIndependentAccommodationsSchedule(env)
  expect(result.approvedCount).toBe(2)
  expect(result.lockVersions).toEqual([1, 1])
})
it('F06-CANONICAL-CURRENT two Admins approving the SAME Pending Booking commit one review commitment', async () => {
  const result = await officialSameBookingDoubleApproval(env)
  expect(result.committedApprovals).toBe(1)
  expect(result.results.filter(decision => decision.ok)).toHaveLength(1)
})