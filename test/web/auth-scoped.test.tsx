// The Guest's sign-in page, `/guest/auth` — and the absence of any Admin
// sign-in page on the website (ADR-0007).
//
// Rendered, not reasoned about — like the gates in auth-routes.test.tsx: the
// session behind the page is a hand-written context, which is what a signed-in
// Guest or Admin looks like from a component's point of view. `isConfigured`
// stays true here because the project has Firebase keys, which is exactly when
// the Google button must be on the page.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import * as AuthPages from '../../src/pages/AuthPage'
import { canOpenPage, permissionsOf, type Permission, type Role } from '../../src/lib/auth'
import { describeAuthError } from '../../src/lib/auth'

const { GuestAuthPage } = AuthPages

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
    can: (permission: Permission) => Boolean(role && permissionsOf(role).includes(permission)),
    canOpen: (path: string) => canOpenPage(role, path),
    actor: role ? { actor: role, actor_id: `uid-${role}`, actor_name: `${role}@hacienda.test` } : null,
    login: async () => {},
    register: async () => {},
    loginWithGoogle: async () => {},
    logout: async () => {},
    resetPassword: async () => {},
    refresh: async () => {},
    ...overrides,
  }
}

const BOOK_MARKER = 'SCOPED-BOOK-LANDED'

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
            <Route path="/book" element={<div>{BOOK_MARKER}</div>} />
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

  it('turns an Admin away and points them at the mobile app', () => {
    const admin = renderAt('/guest/auth', session({ role: 'admin' }))

    expect(admin.text()).toContain('This website is for Guests')
    expect(admin.text()).toContain('/guest/auth')
    expect(admin.text()).toContain('Admin mobile app')
    expect(admin.html()).not.toContain('href="/admin"')
    expect(admin.html()).not.toContain('href="/app"')
  })

  it('tells the Admin where to sign in, without linking to a page that no longer exists', () => {
    const page = renderAt('/guest/auth', session())

    expect(page.text()).toContain('Admin signs in on the Hacienda de LuisAna Admin mobile app')
    expect(page.html()).not.toContain('href="/admin/auth"')
    expect(page.text()).not.toMatch(/\bHost\b|\bStaff\b/)
  })
})

describe('the Admin sign-in page', () => {
  it('does not exist on the website', () => {
    // The Admin's application is the Flutter app; the website exports only
    // the Guest's page.
    expect('AdminAuthPage' in AuthPages).toBe(false)
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
