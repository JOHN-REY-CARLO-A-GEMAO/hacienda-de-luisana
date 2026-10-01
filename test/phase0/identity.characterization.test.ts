// Actual Auth adapter exercised through SDK doubles: no registration attempt,
// provider challenge, email ownership proof or production recovery access.
import { beforeEach, expect, it, vi } from 'vitest'
import { sdk, resetCloudDouble } from './doubles/cloud'
import { scenarios } from './fixtures'
import { BOOTSTRAP_ROLES, resolveRole } from '../../src/lib/auth/profile'

const calls = vi.hoisted(() => ({ create: vi.fn(), login: vi.fn(), signInAnonymous: vi.fn(), update: vi.fn() }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: calls.create, signInWithEmailAndPassword: calls.login,
  signInAnonymously: calls.signInAnonymous, updateProfile: calls.update,
  browserLocalPersistence: 'synthetic-persistence', setPersistence: vi.fn(async () => {}),
  onAuthStateChanged: vi.fn(() => () => {}), signOut: vi.fn(), signInWithPopup: vi.fn(), sendPasswordResetEmail: vi.fn(),
}))
import { ensureGuestUid } from '../../src/lib/guestAuth'
import { createFirebasePorts } from '../../src/lib/authFirebase'

beforeEach(() => {
  resetCloudDouble()
  for (const fn of [calls.create, calls.login, calls.signInAnonymous, calls.update]) fn.mockReset()
  const registered = { uid: scenarios.identities.authenticatedGuest.uid, email: scenarios.identities.authenticatedGuest.email, displayName: 'Synthetic Guest A', isAnonymous: false, providerData: [{ providerId: 'password' }] }
  calls.create.mockImplementation(async () => { sdk.auth.currentUser = registered as typeof sdk.auth.currentUser; return { user: registered } })
  calls.login.mockImplementation(async () => { sdk.auth.currentUser = registered as typeof sdk.auth.currentUser; return { user: registered } })
  calls.update.mockResolvedValue(undefined)
})

it('F16-ANONYMOUS-CONTINUITY: identity helper reuses an existing anonymous identity', async () => {
  expect(await ensureGuestUid()).toBe(scenarios.identities.anonymousGuest.uid)
  expect(await ensureGuestUid()).toBe(scenarios.identities.anonymousGuest.uid)
  expect(calls.signInAnonymous).not.toHaveBeenCalled()
})
it('F16-REGISTER: current registration path uses new-account creation rather than anonymous credential linking', async () => {
  const old = await ensureGuestUid()
  const ports = createFirebasePorts()
  if (!ports) throw new Error('SDK double did not initialize Auth ports')
  const user = await ports.auth.register({ email: scenarios.identities.authenticatedGuest.email, password: 'synthetic-test-only-password', displayName: 'Synthetic Guest A' })
  expect(calls.create).toHaveBeenCalledTimes(1)
  expect(user.uid).not.toBe(old)
  expect(await ensureGuestUid()).toBe(scenarios.identities.authenticatedGuest.uid)
})
it('F16-LOGIN: later authentication swaps the UID carried by future requests', async () => {
  const old = await ensureGuestUid()
  const ports = createFirebasePorts()
  if (!ports) throw new Error('missing synthetic ports')
  const user = await ports.auth.login({ email: scenarios.identities.authenticatedGuest.email, password: 'synthetic-test-only-password' })
  expect(calls.login).toHaveBeenCalledTimes(1)
  expect(user.uid).not.toBe(old)
})
it('F04-BOOTSTRAP: role resolver ignores verified identity/provider/bound UID facts for an allowlisted email claim', () => {
  const syntheticBearer = { ...scenarios.identities.unverifiedAllowlisted, email: BOOTSTRAP_ROLES[0].email }
  expect(resolveRole(syntheticBearer, null)).toBe('admin')
  expect(resolveRole({ ...syntheticBearer, uid: scenarios.identities.forgedUid.uid, isAnonymous: true }, null)).toBe('admin')
  // Token construction in an emulator is not evidence that a real provider
  // can issue either claim. That remains F04 runtime/owner verification.
})
it('F04-ROLE-CONTROL: stored role grants Admin to each seeded identity; non-Admin remains Guest', () => {
  for (const who of [scenarios.identities.adminA, scenarios.identities.adminB]) expect(resolveRole(who, { uid: who.uid, role: 'admin' })).toBe('admin')
  expect(resolveRole(scenarios.identities.nonAdmin, { uid: scenarios.identities.nonAdmin.uid, role: 'guest' })).toBe('guest')
})
