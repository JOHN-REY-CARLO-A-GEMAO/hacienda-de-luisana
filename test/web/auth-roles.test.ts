// Authentication & RBAC — the three roles and what each of them may do.
//
// The roles are not invented here: CONTEXT.md § People defines Guest, Host and
// Staff, and `src/lib/booking` already refuses actions from the wrong
// `ActorKind`. This is the catalogue that turns those three words into
// permissions a page, a button and a Firestore rule can all ask about — so the
// three surfaces cannot drift apart.
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

describe('the three roles', () => {
  it('are Guest, Host and Staff, in the glossary’s own words', () => {
    expect(ROLES).toEqual(['guest', 'host', 'staff'])
    expect(ROLE_LABELS).toEqual({ guest: 'Guest', host: 'Host', staff: 'Staff' })
  })

  it('reads a stored role whatever its casing, and refuses one it does not know', () => {
    expect(normalizeRole('HOST')).toBe('host')
    expect(normalizeRole(' staff ')).toBe('staff')
    // `owner` and `admin` are synonyms CONTEXT.md tells us to avoid, and a role
    // nobody defined must never quietly become a role that grants something.
    expect(normalizeRole('owner')).toBeNull()
    expect(normalizeRole('administrator')).toBeNull()
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole(undefined)).toBeNull()
    expect(isRole('guest')).toBe(true)
    expect(isRole('system')).toBe(false)
  })
})

describe('what each role may do', () => {
  it('gives the Host the whole hacienda', () => {
    // The Host operates the hacienda: reviews Bookings and KYC, verifies money,
    // refunds it, reads the Access log and the Guest’s location, and decides who
    // else is Staff (CONTEXT.md § People).
    for (const permission of PERMISSIONS) {
      expect(can('host', permission), `host should hold ${permission}`).toBe(true)
    }
  })

  it('lets Staff see the bookings and the locks, and finish a cleaned stay', () => {
    expect(can('staff', 'bookings:read:all')).toBe(true)
    expect(can('staff', 'access-logs:read')).toBe(true)
    expect(can('staff', 'analytics:read')).toBe(true)
    // Flow §5 step 10: cleaning and inspection are Staff work.
    expect(can('staff', 'stays:complete')).toBe(true)
  })

  it('stops Staff short of every decision that is the Host’s', () => {
    // CONTEXT.md: Staff "cannot approve bookings or verify payments", and
    // storage.rules keeps government IDs away from them.
    expect(can('staff', 'bookings:review')).toBe(false)
    expect(can('staff', 'payments:verify')).toBe(false)
    expect(can('staff', 'refunds:mark')).toBe(false)
    expect(can('staff', 'kyc:read')).toBe(false)
    expect(can('staff', 'bookings:delete')).toBe(false)
    expect(can('staff', 'bookings:cancel:any')).toBe(false)
    expect(can('staff', 'team:manage')).toBe(false)
    expect(can('staff', 'guest-location:read')).toBe(false)
    expect(can('staff', 'site:manage')).toBe(false)
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
    expect(can('guest', 'team:manage')).toBe(false)
  })

  it('fails closed for anybody who is not one of the three roles', () => {
    // Signed out, a role the catalogue does not know, and the `system` actor the
    // lifecycle uses for a Date hold expiring: none of them is a person with a
    // permission.
    for (const permission of PERMISSIONS) {
      expect(can(null, permission), `signed-out should not hold ${permission}`).toBe(false)
      expect(can('system' as Role, permission)).toBe(false)
      expect(can('owner' as Role, permission)).toBe(false)
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
  it('keeps the Host dashboard to the Host', () => {
    expect(pageRoles('/admin')).toEqual(['host'])
    expect(canOpenPage('host', '/admin')).toBe(true)
    expect(canOpenPage('staff', '/admin')).toBe(false)
    expect(canOpenPage('guest', '/admin')).toBe(false)
    expect(canOpenPage(null, '/admin')).toBe(false)
  })

  it('opens the client app to the Host and to Staff, but not to a Guest', () => {
    expect(canOpenPage('host', '/app')).toBe(true)
    expect(canOpenPage('staff', '/app')).toBe(true)
    expect(canOpenPage('guest', '/app')).toBe(false)
    expect(canOpenPage(null, '/app')).toBe(false)
    // Nested paths answer from the deepest rule that matches them.
    expect(canOpenPage('staff', '/app/records')).toBe(true)
    expect(canOpenPage('staff', '/app/analytics')).toBe(true)
  })

  it('keeps the Guest’s live location to the Host', () => {
    // Tracking consent is given to the Host who reviews the stay, not to the
    // caretaker (CONTEXT.md § Tracking consent).
    expect(canOpenPage('host', '/app/tracking')).toBe(true)
    expect(canOpenPage('staff', '/app/tracking')).toBe(false)
  })

  it('gives a Guest their own account page, and keeps Staff out of it', () => {
    expect(canOpenPage('guest', '/account')).toBe(true)
    expect(canOpenPage('staff', '/account')).toBe(false)
    expect(canOpenPage(null, '/account')).toBe(false)
  })

  it('opens every gated page to the Host, who holds every permission', () => {
    // Not a special case: it falls out of the catalogue. The Host operates the
    // hacienda, so there is no page in it they are turned away from.
    for (const path of ['/admin', '/app', '/app/tracking', '/app/analytics', '/app/records', '/account']) {
      expect(canOpenPage('host', path), `host should open ${path}`).toBe(true)
    }
    expect(pageRoles('/account')).toEqual(['guest', 'host'])
  })

  it('leaves the public website open to everybody, signed in or not', () => {
    for (const path of ['/', '/book', '/track', '/share-location', '/some-page-that-does-not-exist']) {
      expect(pageRoles(path), `${path} is public`).toBeNull()
      for (const role of [null, ...ROLES]) {
        expect(canOpenPage(role, path), `${path} open to ${role}`).toBe(true)
      }
    }
  })

  it('ignores a trailing slash and any query string', () => {
    expect(canOpenPage('host', '/admin/')).toBe(true)
    expect(canOpenPage('staff', '/app?tab=bookings')).toBe(true)
    expect(canOpenPage('staff', '/app/tracking#map')).toBe(false)
  })

  it('sends each role to the page that is theirs', () => {
    expect(homeForRole('host')).toBe('/admin')
    expect(homeForRole('staff')).toBe('/app')
    expect(homeForRole('guest')).toBe('/account')
    expect(homeForRole(null)).toBe('/')
  })
})

describe('which role a signed-in user has', () => {
  const BOOTSTRAP_HOST = 'haciendadeluisiana@gmail.com'
  const BOOTSTRAP_STAFF = 'gemaojohnreycarloarguilles@gmail.com'

  it('recognises the two allowlisted addresses the Firestore rules already recognise', () => {
    expect(roleForEmail(BOOTSTRAP_HOST)).toBe('host')
    expect(roleForEmail(BOOTSTRAP_STAFF)).toBe('staff')
    expect(roleForEmail(BOOTSTRAP_HOST.toUpperCase())).toBe('host')
    expect(roleForEmail('maria@example.com')).toBeNull()
    expect(roleForEmail(null)).toBeNull()
  })

  it('reads the role from the stored Profile', () => {
    expect(resolveRole({ uid: 'u1', email: 'ana@example.com' }, { uid: 'u1', role: 'host' })).toBe('host')
    expect(resolveRole({ uid: 'u2', email: 'ben@example.com' }, { uid: 'u2', role: 'staff' })).toBe('staff')
  })

  it('lets the allowlist win over a Profile, so the client and the rules agree', () => {
    // firestore.rules answers from the allowlisted email before it looks at a
    // Profile. A client that disagreed would show the Host buttons the rules
    // then refuse.
    expect(resolveRole({ uid: 'u1', email: BOOTSTRAP_HOST }, { uid: 'u1', role: 'guest' })).toBe('host')
    expect(resolveRole({ uid: 'u2', email: BOOTSTRAP_STAFF }, { uid: 'u2', role: 'host' })).toBe('staff')
  })

  it('makes anybody signed in without a Profile a Guest', () => {
    // The default has to be the role with the fewest permissions, exactly as
    // firestore.rules defaults a signed-in user with no Profile to 'guest'.
    expect(resolveRole({ uid: 'u3', email: 'new@example.com' }, null)).toBe('guest')
    expect(resolveRole({ uid: 'anon-1', email: null, isAnonymous: true }, null)).toBe('guest')
  })

  it('gives no role at all to somebody who is not signed in', () => {
    expect(resolveRole(null, null)).toBeNull()
    expect(resolveRole(null, { uid: 'u1', role: 'host' })).toBeNull()
  })

  it('refuses a Profile whose stored role is not one of the three', () => {
    expect(resolveRole({ uid: 'u4', email: 'x@example.com' }, { uid: 'u4', role: 'superuser' as Role })).toBe(
      'guest',
    )
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
})
