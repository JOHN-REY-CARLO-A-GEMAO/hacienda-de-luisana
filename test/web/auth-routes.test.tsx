// Protected routes — what the Guest website shows each of the two roles.
//
// Rendered, not reasoned about: a gate is a promise about what a person sees, so
// the promise is checked by rendering the gate. The session behind it is the real
// context with a hand-written value, which is what a signed-in Guest or Admin
// looks like from a component's point of view.
//
// Hiding a page is the courtesy half of authorization; the half that matters is
// asserted in auth-firestore-rules.test.ts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { ProtectedRoute } from '../../src/components/Auth/ProtectedRoute'
import { LoginForm } from '../../src/components/Auth/LoginForm'
import { AuthError, canOpenPage, permissionsOf, type Permission, type Role } from '../../src/lib/auth'

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
    const page = renderGate('/account', session())

    expect(page.text()).toContain('Sign in')
    expect(page.text()).not.toContain(BEHIND_THE_GATE)
  })

  it('says a sign-up makes a Guest, and never mentions a Staff or Host role', () => {
    const page = renderGate('/account', session())
    expect(page.text()).toContain('Signing up here makes you a Guest')
    expect(page.text()).not.toMatch(/\bStaff\b|\bHost\b/)
  })

  it('shows a spinner, and neither the form nor the page, while the session is restored', () => {
    const page = renderGate('/account', session({ loading: true, status: 'loading' }))

    expect(page.text()).toContain('Checking authentication')
    expect(page.text()).not.toContain(BEHIND_THE_GATE)
    expect(page.text()).not.toContain('Sign in')
  })
})

describe('the Guest’s own page', () => {
  it('opens for the Guest', () => {
    const page = renderGate('/account', session({ role: 'guest' }))
    expect(page.text()).toContain(BEHIND_THE_GATE)
    expect(page.text()).not.toContain("isn't yours")
  })

  it('opens for the Guest under a nested path, trailing slash or query', () => {
    for (const path of ['/account/', '/account/history']) {
      const page = renderGate(path, session({ role: 'guest' }))
      expect(page.text(), path).toContain(BEHIND_THE_GATE)
    }
  })

  it('shows the Guest the local-mode banner when there is no Firebase', () => {
    const page = renderGate('/account', session({ role: 'guest', isConfigured: false, isCloud: false }))
    expect(page.text()).toContain('Local Mode Active')
    expect(page.text()).toContain('Signed in as Guest')
    // The demo role switcher is gone with the roles it switched between.
    expect(page.text()).not.toContain('Switch Role')
  })
})

describe('an Admin on the Guest website', () => {
  it('is turned away from the Guest’s page and pointed at the mobile app', () => {
    const page = renderGate('/account', session({ role: 'admin' }))

    expect(page.text()).not.toContain(BEHIND_THE_GATE)
    expect(page.text()).toContain('This website is for Guests')
    expect(page.text()).toContain('Admin mobile app')
    expect(page.text()).toContain('/account')
  })

  it('is told who they are signed in as, and offered a way out', () => {
    const page = renderGate('/account', session({ role: 'admin' }))

    expect(page.text()).toContain('Admin')
    expect(page.text()).toContain('admin@hacienda.test')
    expect(page.text()).toContain('Sign out')
    expect(page.html()).toContain('href="/"')
    // No link to a dashboard that no longer exists on the website.
    expect(page.html()).not.toContain('href="/admin"')
    expect(page.html()).not.toContain('href="/app"')
  })
})

describe('the sign-in form itself', () => {
  it('offers Google only where there is a Firebase project to offer it from', () => {
    const cloud = renderForm(session())
    expect(cloud.text()).toContain('Continue with Google')

    const local = renderForm(session({ isConfigured: false, isCloud: false }))
    expect(local.text()).not.toContain('Continue with Google')
    expect(local.text()).toContain('Demo mode')
    // No role switcher: demo mode signs up a Guest like any other mode.
    expect(local.text()).not.toMatch(/Continue as (Host|Staff|Admin|Guest)/)
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

  it('offers a one-click switch to sign-in when the address already has an account', async () => {
    const value = session({
      register: async () => {
        throw new AuthError('auth/email-already-in-use')
      },
    })
    const page = renderForm(value)

    openSignUp(page.container)
    await fillAndSubmit(page.container, 'twice@example.com', 'bahay-kubo')

    clickButton(page.container, /Sign in instead/)

    // Login mode, with the email kept: the person only types the password.
    expect(page.text()).toContain('Sign In')
    expect(page.container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
      'twice@example.com',
    )
    expect(page.text()).not.toContain('already exists')
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
