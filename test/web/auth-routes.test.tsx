// Protected routes — what the frontend shows each of the three roles.
//
// Rendered, not reasoned about: a gate is a promise about what a person sees, so
// the promise is checked by rendering the gate. The session behind it is the real
// context with a hand-written value, which is what a signed-in Host, Staff member
// or Guest looks like from a component's point of view.
//
// Hiding a page is the courtesy half of RBAC; the half that matters is asserted in
// auth-firestore-rules.test.ts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { ProtectedRoute } from '../../src/components/Auth/ProtectedRoute'
import { LoginForm } from '../../src/components/Auth/LoginForm'
import { AuthError, canOpenPage, type Permission, type Role } from '../../src/lib/auth'

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

// Not a credential — the copy a page shows once you are let in, so a test can
// tell "rendered" from "turned away" without guessing at a heading.
const BEHIND_THE_GATE = 'PAGES-NOTHING-ELSE-SHOWS'

type Rendered = { text: () => string; html: () => string; container: HTMLElement }

const mounted: Root[] = []

function render(element: React.ReactElement, value: AuthContextType): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(<AuthContext.Provider value={value}>{element}</AuthContext.Provider>)
  })
  return {
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    html: () => container.innerHTML,
    container,
  }
}

/** A protected page standing at `path`, with something on it worth keeping secret. */
function gatedPage(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <ProtectedRoute>
              <div>{BEHIND_THE_GATE}</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  ) as React.ReactElement
}

/** Render that page for somebody in a known situation. */
function renderGate(path: string, value: AuthContextType): Rendered {
  return render(gatedPage(path), value)
}

/** A form on its own, inside a router because it links somewhere. */
function renderForm(value: AuthContextType): Rendered {
  return render(
    <MemoryRouter>
      <LoginForm />
    </MemoryRouter>,
    value,
  )
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('a page nobody has signed in for', () => {
  it('shows the sign-in form and none of the page', () => {
    const page = renderGate('/admin', session())

    expect(page.text()).toContain('Sign in')
    expect(page.text()).not.toContain(BEHIND_THE_GATE)
  })

  it('says which role the page is for', () => {
    const admin = renderGate('/admin', session())
    expect(admin.text()).toContain('Host access only')

    const app = renderGate('/app', session())
    expect(app.text()).toContain('Host or Staff access only')
  })

  it('shows a spinner, and neither the form nor the page, while the session is restored', () => {
    const page = renderGate('/admin', session({ loading: true, status: 'loading' }))

    expect(page.text()).toContain('Checking authentication')
    expect(page.text()).not.toContain(BEHIND_THE_GATE)
    expect(page.text()).not.toContain('Sign in')
  })
})

describe('a page opened by the role it belongs to', () => {
  const cases: Array<[string, Role]> = [
    ['/admin', 'host'],
    ['/app', 'host'],
    ['/app', 'staff'],
    ['/app/analytics', 'staff'],
    ['/app/records', 'staff'],
    ['/app/tracking', 'host'],
    ['/account', 'guest'],
  ]

  it.each(cases)('opens %s for the %s', (path, role) => {
    const page = renderGate(path, session({ role }))
    expect(page.text()).toContain(BEHIND_THE_GATE)
    expect(page.text()).not.toContain("isn't yours")
  })
})

describe('a page turned away for the role that is signed in', () => {
  const cases: Array<[string, Role]> = [
    ['/admin', 'staff'],
    ['/admin', 'guest'],
    ['/app', 'guest'],
    ['/app/tracking', 'staff'],
    ['/account', 'staff'],
  ]

  it.each(cases)('turns the %s away from %s', (path, role) => {
    const page = renderGate(path, session({ role }))

    expect(page.text()).not.toContain(BEHIND_THE_GATE)
    expect(page.text()).toContain("This page isn't yours")
    expect(page.text()).toContain('403')
    expect(page.text()).toContain(path)
  })

  it('tells the person who they are signed in as, and offers a way out', () => {
    const page = renderGate('/admin', session({ role: 'staff' }))

    expect(page.text()).toContain('Staff')
    expect(page.text()).toContain('staff@hacienda.test')
    expect(page.html()).toContain('href="/app"')
  })

  it('reads the path it stands on, so a nested page answers from its own rule', () => {
    // /app is open to Staff; /app/tracking inside it is not.
    const open = renderGate('/app', session({ role: 'staff' }))
    expect(open.text()).toContain(BEHIND_THE_GATE)

    const closed = renderGate('/app/tracking', session({ role: 'staff' }))
    expect(closed.text()).not.toContain(BEHIND_THE_GATE)
  })
})

describe('the sign-in form itself', () => {
  it('offers Google only where there is a Firebase project to offer it from', () => {
    const cloud = renderForm(session())
    expect(cloud.text()).toContain('Continue with Google')

    const local = renderForm(session({ isConfigured: false, isCloud: false }))
    expect(local.text()).not.toContain('Continue with Google')
    expect(local.text()).toContain('Demo mode')
    expect(local.text()).toContain('Continue as Host')
    expect(local.text()).toContain('Continue as Staff')
    expect(local.text()).toContain('Continue as Guest')
  })

  it('says a sign-up makes a Guest, because that is all a sign-up can make', () => {
    const page = renderForm(session({ isConfigured: false, isCloud: false }))

    openSignUp(page.container)

    expect(page.text()).toContain('Create Guest Account')
    expect(page.text()).toContain('Make a Guest account')
    expect(page.text()).not.toMatch(/owner account/i)
  })

  it('answers a wrong password in words a person can act on', async () => {
    const value = session({
      login: async () => {
        throw new AuthError('auth/invalid-credential')
      },
    })
    const page = renderForm(value)

    await fillAndSubmit(page.container, 'maria@example.com', 'mali-ang-password')

    expect(page.text()).toContain('Invalid email or password. Please try again.')
  })

  it('answers a duplicate sign-up by saying the account already exists', async () => {
    const value = session({
      register: async () => {
        throw new AuthError('auth/email-already-in-use')
      },
    })
    const page = renderForm(value)

    openSignUp(page.container)
    await fillAndSubmit(page.container, 'twice@example.com', 'bahay-kubo', { name: 'Maria Santos' })

    expect(page.text()).toContain('An account with this email already exists. Try logging in.')
  })

  it('shows the session’s refusal of a password too short to keep', async () => {
    // Validation lives in the session, where every surface shares it (and is
    // tested there); the form's job is to say what came back, in words.
    const value = session({
      register: async () => {
        throw new AuthError('auth/weak-password')
      },
    })
    const page = renderForm(value)

    openSignUp(page.container)
    await fillAndSubmit(page.container, 'short@example.com', '123')

    expect(page.text()).toContain('Password must be at least 6 characters')
  })

  it('sends a password reset and says it was sent', async () => {
    const sent: string[] = []
    const value = session({
      resetPassword: async (email: string) => {
        sent.push(email)
      },
    })
    const page = renderForm(value)

    openForgot(page.container)
    await fillAndSubmit(page.container, 'maria@example.com')

    // What the address is cleaned into is the session's business, and is tested
    // there; the form's job is to ask, and to say the answer out loud.
    expect(sent).toEqual(['maria@example.com'])
    expect(page.text()).toContain('Password reset email sent')
  })
})

// ----------------------------------------------------------------------------
// Driving a form the way a person does
// ----------------------------------------------------------------------------

const setValue = (input: HTMLInputElement, value: string) => {
  // React tracks the value it set itself, so assigning straight to `.value`
  // would be ignored: go through the prototype's setter, then say it changed.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const submit = async (container: HTMLElement) => {
  const form = container.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const clickButton = (container: HTMLElement, label: RegExp) => {
  const button = [...container.querySelectorAll('button')].find((candidate) => label.test(candidate.textContent ?? ''))
  if (!button) throw new Error(`no button matching ${label}`)
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const openSignUp = (container: HTMLElement) => clickButton(container, /Create one/)
const openForgot = (container: HTMLElement) => clickButton(container, /Forgot password/)

async function fillAndSubmit(
  container: HTMLElement,
  email: string,
  password?: string,
  extra: { name?: string } = {},
) {
  if (extra.name !== undefined) {
    const name = container.querySelector<HTMLInputElement>('input[autocomplete="name"]')
    if (name) setValue(name, extra.name)
  }
  setValue(container.querySelector<HTMLInputElement>('input[type="email"]')!, email)
  const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]')
  if (password !== undefined && passwordInput) setValue(passwordInput, password)
  await submit(container)
}
