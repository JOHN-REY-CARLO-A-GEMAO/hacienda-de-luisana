// The register form's own checks, and what it says when they refuse.
//
// These were enforced by the form and nothing else: the checkbox had no
// `required`, the date of birth was collected and never read, and
// `validateBirthdate` was imported into this file without ever being called. So
// a sign-up could be completed with the Terms unticked and with a birthdate that
// put the person under the age the Terms state. The rules now live in
// `validateRegistration`, and this is the half a person sees.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '../../src/components/Auth/LoginForm'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { AN_ADULT } from './registration-fixture'
import { LEGAL_VERSION } from '../../src/lib/legal'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function open(register = vi.fn(async () => {})) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)

  const context = {
    user: null,
    profile: null,
    role: null,
    loading: false,
    status: 'signed-out',
    isConfigured: false,
    isCloud: false,
    can: () => false,
    canOpen: () => true,
    actor: null,
    login: vi.fn(async () => {}),
    register,
    loginWithGoogle: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  } as unknown as AuthContextType

  const draw = () =>
    act(() => {
      root.render(
        <MemoryRouter>
          <AuthContext.Provider value={context}>
            <LoginForm />
          </AuthContext.Provider>
        </MemoryRouter>,
      )
    })

  draw()
  const text = () => (container.textContent ?? '').replace(/\s+/g, ' ')
  const byText = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))
  const click = (el: HTMLElement | undefined) => {
    if (!el) throw new Error('expected a button and found none')
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  }

  return { container, text, byText, click, register }
}

function write(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })))
}

function tick(container: HTMLElement) {
  const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!box) throw new Error('no Terms checkbox on the form')
  act(() => box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}

/** Switch the form into register mode and fill the credentials it always asks for. */
function toRegister(page: ReturnType<typeof open>, birthdate = AN_ADULT, accept = true) {
  page.click(page.byText('Create one'))
  const email = page.container.querySelector<HTMLInputElement>('input[type="email"]')!
  const password = page.container.querySelector<HTMLInputElement>('input[type="password"]')!
  const dob = page.container.querySelector<HTMLInputElement>('input[type="date"]')!
  write(email, 'newcomer@example.com')
  write(password, 'bahay-kubo-9')
  write(dob, birthdate)
  if (accept) tick(page.container)
  return { email, password, dob }
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('registering refuses what the Terms do not allow', () => {
  it('will not create an account with the Terms unticked', async () => {
    const page = open()
    toRegister(page, AN_ADULT, false)

    await submit(page.container)

    expect(page.text()).toContain('Please accept the Terms and Conditions to create an account.')
    expect(page.register).not.toHaveBeenCalled()
  })

  it('will not create an account for somebody under the minimum age', async () => {
    const page = open()
    // Nine years old as of this year.
    toRegister(page, String(new Date().getFullYear() - 9) + '-01-01')

    await submit(page.container)

    expect(page.text()).toMatch(/10 years old|born/i)
    expect(page.register).not.toHaveBeenCalled()
  })

  it('will not create an account with no date of birth', async () => {
    const page = open()
    toRegister(page, '')

    await submit(page.container)

    expect(page.text()).toMatch(/date of birth/i)
    expect(page.register).not.toHaveBeenCalled()
  })

  it('refuses a one-character name instead of storing it', async () => {
    const page = open()
    toRegister(page)
    const name = page.container.querySelector<HTMLInputElement>('input[autocomplete="name"]')!
    write(name, 'A')

    await submit(page.container)

    expect(page.text()).toMatch(/short|2 characters/i)
    expect(page.register).not.toHaveBeenCalled()
  })

  it('names every problem at once rather than one per attempt', async () => {
    const page = open()
    // Register mode, nothing filled in at all.
    page.click(page.byText('Create one'))

    await submit(page.container)

    expect(page.text()).toContain('Please accept the Terms and Conditions to create an account.')
    expect(page.text()).toMatch(/date of birth/i)
  })
})

describe('registering goes through when the Terms are met', () => {
  it('passes the birthdate and the acceptance to the session', async () => {
    const page = open()
    toRegister(page)

    await submit(page.container)

    expect(page.register).toHaveBeenCalledTimes(1)
    const [email, password, registration] = page.register.mock.calls[0] as unknown as [
      string,
      string,
      { birthdate: string; acceptedTerms: boolean; displayName?: string },
    ]
    expect(email).toBe('newcomer@example.com')
    expect(password).toBe('bahay-kubo-9')
    expect(registration.birthdate).toBe(AN_ADULT)
    expect(registration.acceptedTerms).toBe(true)
  })

  it('names the version of the Terms the person is agreeing to', () => {
    const page = open()
    page.click(page.byText('Create one'))
    expect(page.text()).toContain(`version ${LEGAL_VERSION}`)
  })

  it('leaves login and password reset alone', async () => {
    const page = open()
    // Nothing ticked and no date of birth — irrelevant, because this is login.
    const email = page.container.querySelector<HTMLInputElement>('input[type="email"]')!
    const password = page.container.querySelector<HTMLInputElement>('input[type="password"]')!
    write(email, 'maria@example.com')
    write(password, 'bahay-kubo-9')

    await submit(page.container)

    expect(page.text()).not.toContain('Please accept the Terms')
  })
})