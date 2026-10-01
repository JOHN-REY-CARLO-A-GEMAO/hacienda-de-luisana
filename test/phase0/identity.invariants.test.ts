import { expect, it } from 'vitest'
import { BOOTSTRAP_ROLES, resolveRole } from '../../src/lib/auth/profile'
import { scenarios } from './fixtures'

it('F04 DESIRED: unverified, unbound allowlisted-email claim alone does not grant Admin authority', () => {
  const identity = { ...scenarios.identities.unverifiedAllowlisted, email: BOOTSTRAP_ROLES[0].email }
  expect(resolveRole(identity, null)).not.toBe('admin')
})
