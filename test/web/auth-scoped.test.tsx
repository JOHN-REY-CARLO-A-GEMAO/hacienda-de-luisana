// The scoped sign-in pages: `/guest/auth` for Guests, `/admin/auth` for the Host.
//
// Rendered, not reasoned about — like the gates in auth-routes.test.tsx: the
// session behind each page is a hand-written context, which is what a signed-in
// Host, Staff member or Guest looks like from a component's point of view.
// `isConfigured` stays true here because the project has Firebase keys, which
// is exactly when the Google button must be on the page.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { GuestAuthPage, AdminAuthPage } from '../../src/pages/AuthPage'
import { AuthError, canOpenPage, type Permission, type Role } from '../../src/lib/auth'
import { describeAuthError } from '../../src/lib/auth'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The context a component reads, for a person in a known situation. */
function session(overrides: Partial<AuthContextType> = {}): AuthContextType {
  const role = (overrides.role ?? null) as Role | null
  return {
    user: role
      ? { uid: `uid-${role}`, email: `${role}@hacienda.test`, displayName: null, isAnonymous: false, provider: 'password' }
      : null,
    profile: role ? { uid: `uid-${role}`, role } : null,
    role,
    loading: false,
    status: role ? 'signed-in' : 'signed-out',
    isConfigured: true,
    isCloud: true,
    can: (permission: Permission) => Boolean(role && CAN[role].includes(permission)),
    canOpen: (path: string) => canOpenPage(role, path),
    actor: role ? { actor: role, actor_id: `uid-${role}`, actor_name: `${role}@hacienda.test` } : null,
    login: async () => {},
    register: async () => {},
    loginWithGoogle: async () => {},
    logout: async () => {},
    resetPassword: async () => {},
    signInAsRole: async () => {},
    assignRole: async () => {
      throw new AuthError('hdl/forbidden')
    },
    team: async () => [],
    refresh: async () => {},
    ...overrides,
  }
}

/** What each role holds, straight from the catalogue the app uses. */
const CAN: Record<Role, Permission[]> = {
  guest: ['booking:create', 'booking:read:own', 'booking:update:own', 'kyc:upload'],
  host: [
    'booking:create',
    'booking:read:own',
    'booking:update:own',
    'kyc:upload',
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
    'team:manage',
    'site:manage',
    'rates:publish',
  ],
  staff: ['bookings:read:all', 'access-logs:read', 'analytics:read', 'stays:complete'],
}

// Where a redirect lands, so a test can tell "sent on" from "stayed".
const BOOK_MARKER = 'SCOPED-BOOK-LANDED'
const ADMIN_MARKER = 'SCOPED-ADMIN-LANDED'

const mounted: Root[] = []

function renderAt(path: string, value: AuthContextType): { text: () => string; html: () => string } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/guest/auth" element={<GuestAuthPage />} />
            <Route path="/admin/auth" element={<AdminAuthPage />} />
            <Route path="/book" element={<div>{BOOK_MARKER}</div>} />
            <Route path="/admin" element={<div>{ADMIN_MARKER}</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
  })
  return {
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    html: () => container.innerHTML,
  }
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('/guest/auth', () => {
  it('opens without a session and says it is the Guest page', () => {
    const page = renderAt('/guest/auth', session())

    expect(page.text()).toContain('Sign in as Guest')
    expect(page.text()).toContain('Sign in')
    expect(page.text()).not.toContain("This page isn't yours")
  })

  it('offers Google sign-in where there is a Firebase project to offer it from', () => {
    const page = renderAt('/guest/auth', session())

    expect(page.text()).toContain('Continue with Google')
  })

  it('sends a signed-in Guest straight to booking', () => {
    const page = renderAt('/guest/auth', session({ role: 'guest' }))

    expect(page.text()).toContain(BOOK_MARKER)
    expect(page.text()).not.toContain('Sign in as Guest')
  })

  it('turns away a role the Guest page is not for', () => {
    const staff = renderAt('/guest/auth', session({ role: 'staff' }))

    expect(staff.text()).toContain("This page isn't yours")
    expect(staff.text()).toContain('403')
    expect(staff.text()).toContain('/guest/auth')
    expect(staff.html()).toContain('href="/app"')

    const host = renderAt('/guest/auth', session({ role: 'host' }))

    expect(host.text()).toContain("This page isn't yours")
    expect(host.text()).toContain('403')
  })

  it('points the Host at the Host page', () => {
    const page = renderAt('/guest/auth', session())

    expect(page.html()).toContain('href="/admin/auth"')
  })
})

describe('/admin/auth', () => {
  it('opens without a session and says it is the Host page', () => {
    const page = renderAt('/admin/auth', session())

    expect(page.text()).toContain('Sign in as Host')
    expect(page.text()).toContain('Sign in')
    expect(page.text()).not.toContain("This page isn't yours")
  })

  it('offers Google sign-in where there is a Firebase project to offer it from', () => {
    const page = renderAt('/admin/auth', session())

    expect(page.text()).toContain('Continue with Google')
  })

  it('sends a signed-in Host to the dashboard', () => {
    const page = renderAt('/admin/auth', session({ role: 'host' }))

    expect(page.text()).toContain(ADMIN_MARKER)
    expect(page.text()).not.toContain('Sign in as Host')
  })

  it('turns away a role the dashboard is not for', () => {
    const staff = renderAt('/admin/auth', session({ role: 'staff' }))

    expect(staff.text()).toContain("This page isn't yours")
    expect(staff.text()).toContain('403')
    expect(staff.text()).toContain('/admin/auth')
    expect(staff.html()).toContain('href="/app"')

    const guest = renderAt('/admin/auth', session({ role: 'guest' }))

    expect(guest.text()).toContain("This page isn't yours")
    expect(guest.text()).toContain('403')
  })
})

describe('Google sign-in failures, in words', () => {
  it('says the popup was blocked, and how to fix it', () => {
    expect(describeAuthError({ code: 'auth/popup-blocked' }).message).toContain('popup')
  })

  it('says an unlisted domain is a console setting, not a broken account', () => {
    expect(describeAuthError({ code: 'auth/unauthorized-domain' }).message).toContain('Authorized domains')
  })

  it('treats a cancelled popup as a cancellation', () => {
    expect(describeAuthError({ code: 'auth/cancelled-popup-request' }).message).toContain('cancelled')
  })
})
