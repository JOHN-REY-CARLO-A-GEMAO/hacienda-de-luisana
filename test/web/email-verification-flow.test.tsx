// Real registration page, React auth provider, session and route transition;
// only Firebase itself is an in-memory port. No external mail is sent.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, type AuthPort, type ProfilePort, type SessionStore, type SessionUser } from '../../src/lib/auth'
import { resetRateLimit } from '../../src/lib/rateLimit'
import { AN_ADULT } from './registration-fixture'

const mocks = vi.hoisted(() => ({ session: null as SessionStore | null }))
vi.mock('../../src/lib/authSession', () => ({ appSession: () => mocks.session }))
vi.mock('../../src/lib/firebase', () => ({ isFirebaseConfigured: true }))
import { AuthProvider } from '../../src/context/AuthContext'
import { GuestAuthPage } from '../../src/pages/AuthPage'
import { EmailVerificationNotice } from '../../src/components/Auth/EmailVerificationNotice'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let root: Root
let container: HTMLDivElement
let session: SessionStore
let finishRegistration: ReturnType<typeof deferred<void>>
let delivery: ReturnType<typeof deferred<void>>
let send: ReturnType<typeof vi.fn>

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  resetRateLimit()
  finishRegistration = deferred<void>()
  delivery = deferred<void>()
  send = vi.fn(() => delivery.promise)
  let current: SessionUser | null = null
  let listener: (user: SessionUser | null) => void = () => {}
  const auth: AuthPort = {
    isCloud: true, supportsGoogle: true,
    subscribe(callback) { listener = callback; callback(current); return () => {} },
    current: () => current,
    async register(input) {
      current = { uid: 'new-guest', email: input.email, displayName: null, isAnonymous: false, provider: 'password', emailVerified: false }
      listener(current) // Firebase signs in before the rest of registration finishes.
      const created = current
      await finishRegistration.promise
      return created
    },
    async login() { throw new Error('not used') },
    async loginWithGoogle() { throw new Error('not used') },
    async logout() { current = null; listener(null) },
    async resetPassword() {},
    sendVerificationEmail: send,
    async reloadVerification() { if (!current) throw new Error('signed out'); return current },
  }
  const profiles: ProfilePort = { read: async () => null, create: async (profile) => profile }
  session = createSession(auth, profiles)
  mocks.session = session
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  session.destroy()
  mocks.session = null
  container.remove()
})

function fill(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector)
  if (!field) throw new Error(`Missing field ${selector}`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  act(() => field.dispatchEvent(new Event('input', { bubbles: true })))
}
function click(element: HTMLElement | null) {
  if (!element) throw new Error('Missing button')
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Page did not settle: ${container.textContent}`)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  }
}

async function startSignup(path: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/guest/auth" element={<GuestAuthPage />} />
          <Route path="/mybookings" element={<><h1>My Bookings destination</h1><EmailVerificationNotice /></>} />
          <Route path="/book" element={<><h1>Booking destination</h1><EmailVerificationNotice /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  ))
  const create = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Create one'))
  click(create ?? null)
  fill('input[autocomplete="given-name"]', 'Maria')
  fill('input[autocomplete="family-name"]', 'Santos')
  fill('input[autocomplete="tel"]', '09171234567')
  fill('input[type="date"]', AN_ADULT)
  fill('input[type="email"]', 'guest@example.com')
  fill('input[type="password"]', 'secret1')
  click(container.querySelector('input[type="checkbox"]'))
  const form = container.querySelector('form')!
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('verification feedback survives the signup redirect', () => {
  it.each([
    ['/guest/auth', 'My Bookings destination'],
    ['/guest/auth?returnTo=book', 'Booking destination'],
  ])('shows delivery failure and retry after redirect from %s', async (path, destination) => {
    await startSignup(path)
    await until(() => container.textContent?.includes(destination) === true)
    expect(container.textContent).toContain('Preparing a verification email')
    expect(send).not.toHaveBeenCalled()
    await act(async () => { finishRegistration.resolve() })
    await until(() => send.mock.calls.length === 1)
    await act(async () => { delivery.reject({ code: 'auth/network-request-failed' }) })
    await until(() => container.textContent?.includes('could not confirm a verification email') === true)
    expect(container.textContent).toContain('Your account is still ready')
    expect(container.textContent).toContain('Send verification email')
    expect(container.textContent).not.toContain('already exists')
    expect(session.getState().user?.uid).toBe('new-guest')
  })
})
