import { describe, expect, it } from 'vitest'
import { securityCases, supplementalDecision } from './supplemental-security'

describe('SUPPLEMENTAL evaluator current behavior — NOT canonical Firebase rules', () => {
  for (const c of securityCases) it(c.id, () => {
    const decision = supplementalDecision(c)
    expect(decision.allow, JSON.stringify(decision.statements)).toBe(c.current)
  })
})
