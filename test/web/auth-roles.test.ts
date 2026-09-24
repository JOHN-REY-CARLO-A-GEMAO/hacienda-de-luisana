// Authentication & authorization — the two roles and what each of them may do.
//
// The roles are not invented here: CONTEXT.md § People defines the Guest and
// the Admin, each with their own application (ADR-0007), and `src/lib/booking`
// already refuses actions from the wrong `ActorKind`. This is the catalogue that
// turns those two words into permissions a page, a button and a Firestore rule
// can all ask about — so the surfaces cannot drift apart.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  can,
  permissionsOf,
  normalizeRole,
  isRole,
  canOpenPage,
  pageRoles,
  homeForRole,
  roleForEmail,
  resolveRole,
  type Role,
} from '../../src/lib/auth'

const MODULE_DIR = join(__dirname, '../../src/lib/auth')

describe('the two roles', () => {
  it('are Guest and Admin, in the glossary’s own words', () => {
    expect(ROLES).toEqual(['guest', 'admin'])
    expect(ROLE_LABELS).toEqual({ guest: 'Guest', admin: 'Admin' })
  })

  it('reads a stored role whatever its casing, and refuses one it does not know', () => {
    expect(normalizeRole('ADMIN')).toBe('admin')
    expect(normalizeRole(' guest ')).toBe('guest')
    // A role nobody defined must never quietly become a role that grants
    // something — and that includes the two roles this system used to have.
    expect(normalizeRole('owner')).toBeNull()
    expect(normalizeRole('administrator')).toBeNull()
    expect(normalizeRole('host')).toBeNull()
    expect(normalizeRole('staff')).toBeNull()
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole(undefined)).toBeNull()
    expect(isRole('guest')).toBe(true)
    expect(isRole('system')).toBe(false)
  })
})

describe('what each role may do', () => {
  it('gives the Admin every operating permission of the hacienda', () => {
    // The Admin operates the hacienda from the mobile app: reviews Bookings and
    // KYC, verifies money, refunds it, records the stay, reads the Access log
    // and the Guest's location, publishes rates (CONTEXT.md § People).
    for (const permission of [
      'bookings:read:all',
      'bookings:review',
      'bookings:cancel:any',
      'bookings:delete',
      'payments:verify',
      'refunds:mark',
      'stays:progress',
      'stays:complete',
      'kyc:read',
      'access-logs:read',
      'access-logs:correct',
      'guest-location:read',
      'analytics:read',
      'site:manage',
      'rates:publish',
    ] as const) {
      expect(can('admin', permission), `admin should hold ${permission}`).toBe(true)
    }
  })

  it('does not give the Admin a Guest’s own-Booking permissions', () => {
    // An Admin does not book through the website, and the website's one gated
    // page is a Guest's. This is what turns an Admin away from /account and
    // points them at the app.
    expect(can('admin', 'booking:create')).toBe(false)
    expect(can('admin', 'booking:read:own')).toBe(false)
    expect(can('admin', 'booking:update:own')).toBe(false)
    expect(can('admin', 'kyc:upload')).toBe(false)
  })

  it('gives a Guest their own Booking and nothing of anybody else’s', () => {
    expect(can('guest', 'booking:create')).toBe(true)
    expect(can('guest', 'booking:read:own')).toBe(true)
    expect(can('guest', 'booking:update:own')).toBe(true)
    expect(can('guest', 'kyc:upload')).toBe(true)

    expect(can('guest', 'bookings:read:all')).toBe(false)
    expect(can('guest', 'bookings:review')).toBe(false)
    expect(can('guest', 'payments:verify')).toBe(false)
    expect(can('guest', 'kyc:read')).toBe(false)
    expect(can('guest', 'access-logs:read')).toBe(false)
    expect(can('guest', 'stays:complete')).toBe(false)
    expect(can('guest', 'rates:publish')).toBe(false)
  })

  it('has no permission that belongs to a Staff or Host role', () => {
    expect(PERMISSIONS).not.toContain('team:manage')
    for (const permission of PERMISSIONS) {
      expect(permission).not.toMatch(/staff|host|team/)
    }
  })

  it('fails closed for anybody who is not one of the two roles', () => {
    // Signed out, a role the catalogue does not know, the retired roles, and
    // the `system` actor the lifecycle uses for a Date hold expiring: none of
    // them is a person with a permission.
    for (const permission of PERMISSIONS) {
      expect(can(null, permission), `signed-out should not hold ${permission}`).toBe(false)
      expect(can('system' as Role, permission)).toBe(false)
      expect(can('owner' as Role, permission)).toBe(false)
      expect(can('host' as Role, permission)).toBe(false)
      expect(can('staff' as Role, permission)).toBe(false)
    }
    expect(permissionsOf(null)).toEqual([])
  })

  it('holds no permission nobody can use, and invents none', () => {
    const held = new Set(ROLES.flatMap((role) => permissionsOf(role)))
    for (const permission of PERMISSIONS) {
      expect(held.has(permission), `${permission} belongs to nobody`).toBe(true)
    }
    for (const role of ROLES) {
      for (const permission of permissionsOf(role)) {
        expect(PERMISSIONS).toContain(permission)
      }
    }
  })
})

describe('which pages a role may open', () => {
  it('gives a Guest their own account page, and keeps everybody else out of it', () => {
    expect(pageRoles('/account')).toEqual(['guest'])
    expect(canOpenPage('guest', '/account')).toBe(true)
    expect(canOpenPage('admin', '/account')).toBe(false)
    expect(canOpenPage(null, '/account')).toBe(false)
  })

  it('has no Admin page: the old dashboards are public signposts to the app', () => {
    // /admin and /app are not gated because there is nothing behind them to
    // gate — the routes render a notice pointing at the mobile app (ADR-0007).
    for (const path of ['/admin', '/app', '/app/tracking', '/app/analytics', '/app/records', '/admin/auth']) {
      expect(pageRoles(path), `${path} has nothing to protect`).toBeNull()
    }
  })

  it('leaves the public website open to everybody, signed in or not', () => {
    for (const path of ['/', '/book', '/track', '/share-location', '/guest/auth', '/some-page-that-does-not-exist']) {
      expect(pageRoles(path), `${path} is public`).toBeNull()
      for (const role of [null, ...ROLES]) {
        expect(canOpenPage(role, path), `${path} open to ${role}`).toBe(true)
      }
    }
  })

  it('ignores a trailing slash, casing and any query string', () => {
    expect(canOpenPage('guest', '/account/')).toBe(true)
    expect(canOpenPage('guest', '/Account?tab=history')).toBe(true)
    expect(canOpenPage('admin', '/account#top')).toBe(false)
    expect(canOpenPage(null, '/account/anything')).toBe(false)
  })

  it('sends each role to the page that is theirs', () => {
    expect(homeForRole('guest')).toBe('/account')
    // The Admin's home is the mobile app; on the website that is the landing
    // page, where the gate explains as much.
    expect(homeForRole('admin')).toBe('/')
    expect(homeForRole(null)).toBe('/')
  })
})

describe('which role a signed-in user has', () => {
  const BOOTSTRAP_ADMINS = ['haciendadeluisiana@gmail.com', 'gemaojohnreycarloarguilles@gmail.com']

  it('recognises the allowlisted addresses the Firestore rules already recognise', () => {
    for (const email of BOOTSTRAP_ADMINS) {
      expect(roleForEmail(email)).toBe('admin')
      expect(roleForEmail(email.toUpperCase())).toBe('admin')
      expect(roleForEmail(`  ${email} `)).toBe('admin')
    }
    expect(roleForEmail('maria@example.com')).toBeNull()
    expect(roleForEmail(null)).toBeNull()
  })

  it('reads the role from the stored Profile', () => {
    expect(resolveRole({ uid: 'u1', email: 'ana@example.com' }, { uid: 'u1', role: 'admin' })).toBe('admin')
    expect(resolveRole({ uid: 'u2', email: 'ben@example.com' }, { uid: 'u2', role: 'guest' })).toBe('guest')
  })

  it('lets the allowlist win over a Profile, so the client and the rules agree', () => {
    // firestore.rules answers from the allowlisted email before it looks at a
    // Profile. A client that disagreed would show buttons the rules refuse.
    expect(resolveRole({ uid: 'u1', email: BOOTSTRAP_ADMINS[0] }, { uid: 'u1', role: 'guest' })).toBe('admin')
    expect(resolveRole({ uid: 'u2', email: BOOTSTRAP_ADMINS[1] }, null)).toBe('admin')
  })

  it('makes anybody signed in without a Profile a Guest', () => {
    // The default has to be the role with the fewest permissions, exactly as
    // firestore.rules defaults a signed-in user with no Profile to 'guest'.
    expect(resolveRole({ uid: 'u3', email: 'new@example.com' }, null)).toBe('guest')
    expect(resolveRole({ uid: 'anon-1', email: null, isAnonymous: true }, null)).toBe('guest')
  })

  it('gives no role at all to somebody who is not signed in', () => {
    expect(resolveRole(null, null)).toBeNull()
    expect(resolveRole(null, { uid: 'u1', role: 'admin' })).toBeNull()
  })

  it('refuses a Profile whose stored role is not one of the two', () => {
    expect(resolveRole({ uid: 'u4', email: 'x@example.com' }, { uid: 'u4', role: 'superuser' as Role })).toBe(
      'guest',
    )
    // The retired roles included: a leftover 'host' or 'staff' Profile is a
    // Guest until an Admin Profile is written or the address is allowlisted.
    expect(resolveRole({ uid: 'u5', email: 'old@example.com' }, { uid: 'u5', role: 'host' as Role })).toBe('guest')
    expect(resolveRole({ uid: 'u6', email: 'old@example.com' }, { uid: 'u6', role: 'staff' as Role })).toBe('guest')
  })
})

describe('the authorization core', () => {
  const PURE_FILES = ['roles.ts', 'pages.ts', 'profile.ts', 'credentials.ts', 'session.ts', 'index.ts']

  it('is decided without Firebase, so every surface asks the same question', () => {
    for (const file of PURE_FILES) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8')
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:'"])\/\/.*$/gm, '$1 ')
        .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''")
      expect(code, `${file} reaches for Firebase`).not.toMatch(/firebase/i)
      expect(code, `${file} touches localStorage`).not.toMatch(/localStorage/)
      expect(code, `${file} touches window`).not.toMatch(/\bwindow\b/)
    }
  })

  it('keeps its internals behind the entry point', () => {
    const entry = readFileSync(join(MODULE_DIR, 'index.ts'), 'utf8')
    expect(entry).toMatch(/export \{[^}]*\bcan\b/s)
    expect(entry).not.toMatch(/export \* from/)
  })

  it('knows no Staff or Host role anywhere in the module', () => {
    for (const file of PURE_FILES) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8')
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:'"])\/\/.*$/gm, '$1 ')
      expect(code, `${file} still names a retired role`).not.toMatch(/'(host|staff)'/)
    }
  })
})
