import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { environment, reset } from './helpers'
import { officialCachedSamePendingProtocol, officialLastUnitSchedule } from './concurrency-harness'
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
