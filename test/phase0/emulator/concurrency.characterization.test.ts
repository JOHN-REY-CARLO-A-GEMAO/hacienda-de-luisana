import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { environment, reset } from './helpers'
import { officialCachedSamePendingProtocol, officialLastUnitSchedule } from './concurrency-harness'
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
it('F06-CANONICAL-CURRENT two cached Admin decisions on SAME Pending booking can both batch-commit under the mobile protocol', async () => {
  const result = await officialCachedSamePendingProtocol(env)
  expect(result.committedApprovals).toBe(2)
  expect(result.final.status).toBe('Approved')
  expect(result.final.payment_verified_by).toBe(scenarios.identities.adminB.uid)
  // This is the documented batch protocol against actual rules, not Flutter
  // execution, a physical device, or an observed production incident.
})
it('F06-CANONICAL-CURRENT actual JS adapter stale-query schedule accepts TWO bookings for capacity ONE', async () => {
  const result = await officialLastUnitSchedule(env)
  expect(result.approvedCount).toBe(2)
  expect(result.results.map(decision => decision.ok)).toEqual([true, true])
})
