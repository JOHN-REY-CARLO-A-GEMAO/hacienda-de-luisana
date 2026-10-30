// Successful sign-ins must not spend the login cooldown.
//
// checkRateLimit counts every call, and the login form used to count *before*
// attempting a sign-in, with nothing refunding a success. Five genuine
// sign-ins in a minute — a reviewer, a demo — then locked the Guest out with
// "Too many attempts". Failures still spend the budget.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '../../src/components/Auth/LoginForm'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { LIMITS, resetRateLimit } from '../../src/lib/rateLimit'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function open(login: AuthContextType['login']) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)

  const onSuccess = vi.fn()
  const context = {
    user: null,
    profile: null,
    role: null,
    loading: false,
    status: 'signed-out',
    isConfigured: true,
    isCloud: false,
    can: () => false,
    canOpen: () => true,
    actor: null,
    login,
    register: vi.fn(async () => {}),
    loginWithGoogle: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  } as unknown as AuthContextType

  act(() => {
    root.render(
      <MemoryRouter>
        <AuthContext.Provider value={context}>
          <LoginForm onSuccess={onSuccess} />
        </AuthContext.Provider>
      </MemoryRouter>,
    )
  })

  const text = () => (container.textContent ?? '').replace(/\s+/g, ' ')
  return { container, text, onSuccess, login }
}

function write(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })))
}

function fillCredentials(container: HTMLElement) {
  write(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'guest@example.com')
  write(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'bahay-kubo-9')
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetRateLimit()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  resetRateLimit()
})

describe('login cooldown', () => {
  it('lets a Guest sign in a sixth time when every attempt succeeds', async () => {
    const login = vi.fn(async () => {})
    const page = open(login)
    fillCredentials(page.container)

    for (let i = 0; i < LIMITS.login.max + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await submit(page.container)
    }

    expect(login).toHaveBeenCalledTimes(LIMITS.login.max + 1)
    expect(page.onSuccess).toHaveBeenCalledTimes(LIMITS.login.max + 1)
    expect(page.text()).not.toMatch(/Too many attempts/i)
  })

  it('still locks after five failures', async () => {
    const login = vi.fn(async () => {
      throw new Error('Wrong password')
    })
    const page = open(login)
    fillCredentials(page.container)

    for (let i = 0; i < LIMITS.login.max; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await submit(page.container)
    }
    expect(login).toHaveBeenCalledTimes(LIMITS.login.max)
    expect(page.onSuccess).not.toHaveBeenCalled()

    await submit(page.container)

    expect(login).toHaveBeenCalledTimes(LIMITS.login.max)
    expect(page.text()).toMatch(/Too many attempts/i)
  })
})
