/**
 * ADR-0007: one role, two applications. The Admin operates the hacienda from
 * the Flutter app; the website is the Guest's. An allowlisted Admin address
 * must not be able to sign in on the website.
 *
 * `firestore.rules` cannot enforce this — the app and the website share one
 * Firebase project and one rules file, and Firestore rules cannot tell a
 * browser from a phone. So the refusal lives in the web sign-in adapter, and
 * what these tests protect is that it stays on *every* door: a guard on
 * `login` alone would still leave the Google popup wide open.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_ROLES, roleForEmail } from '../../src/lib/auth/profile'

const adapter = readFileSync(join(__dirname, '../../src/lib/authFirebase.ts'), 'utf8')

describe('the Admin does not sign in on the website', () => {
  it('knows which addresses are the Admin, from the one list the rules use', () => {
    expect(BOOTSTRAP_ROLES.filter((entry) => entry.role === 'admin').length).toBeGreaterThan(0)
    for (const { email, role } of BOOTSTRAP_ROLES) {
      expect(roleForEmail(email)).toBe(role)
      expect(roleForEmail(`  ${email.toUpperCase()} `)).toBe(role)
    }
  })

  it('refuses the Admin at every sign-in door, not just one', () => {
    // register, login, and loginWithGoogle each hand back a session user.
    // A guard on any single one of them leaves the other two open.
    const doors = ['async register(', 'async login(', 'async loginWithGoogle(']
    for (const door of doors) {
      const at = adapter.indexOf(door)
      expect(at, `${door} should exist in the adapter`).toBeGreaterThan(0)
      const body = adapter.slice(at, adapter.indexOf('\n    },', at))
      expect(body, `${door} must call refuseAdminOnWeb`).toContain('refuseAdminOnWeb(')
    }
  })

  it('signs the refused session out rather than leaving it half-open', () => {
    const guard = adapter.slice(
      adapter.indexOf('function refuseAdminOnWeb'),
      adapter.indexOf('\n}', adapter.indexOf('function refuseAdminOnWeb')),
    )
    expect(guard).toContain('signOut(firebaseAuth)')
    expect(guard).toContain("roleForEmail(user.email) !== 'admin'")
  })

  it('carries a message that says where the Admin does sign in', () => {
    const credentials = readFileSync(join(__dirname, '../../src/lib/auth/credentials.ts'), 'utf8')
    expect(credentials).toContain('hdl/admin-uses-app')
    expect(credentials).toMatch(/'hdl\/admin-uses-app':\s*'[^']*app[^']*'/)
  })
})
