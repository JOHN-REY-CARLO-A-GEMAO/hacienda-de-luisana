import { describe, expect, it } from 'vitest'
import { securityCases, supplementalDecision } from './supplemental-security'

describe('SUPPLEMENTAL evaluator desired probes — failures are not hidden', () => {
  for (const c of securityCases.filter(c => c.current !== c.desired)) it(`${c.id} DESIRED`, () => {
    expect(supplementalDecision(c).allow).toBe(c.desired)
  })
})
