import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { EmailVerificationNotice } from '../../src/components/Auth/EmailVerificationNotice'

let container: HTMLDivElement
let root: Root
const send = vi.fn<() => Promise<void>>()
const check = vi.fn<() => Promise<boolean>>()

function auth(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: { uid: 'guest-one', email: 'guest@example.com', displayName: null, isAnonymous: false, provider: 'password', emailVerified: false },
    profile: null, role: 'guest', actor: null, loading: false, status: 'signed-in',
    isConfigured: true, isCloud: true, isRegistering: false,
    verificationEmail: { uid: null, email: null, status: 'idle', message: null },
    can: () => true, canOpen: () => true, login: async () => {}, register: async () => {}, loginWithGoogle: async () => {},
    logout: async () => {}, resetPassword: async () => {}, sendVerificationEmail: send,
    checkEmailVerification: check, refresh: async () => {}, ...overrides,
  }
}
async function render(value: AuthContextType) {
  await act(async () => root.render(<AuthContext.Provider value={value}><EmailVerificationNotice /></AuthContext.Provider>))
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
async function click(element: HTMLElement) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  send.mockReset().mockResolvedValue(undefined)
  check.mockReset().mockResolvedValue(false)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('email verification notice', () => {
  it('shows pending, sent and delivery-failure states without blocking Guest access', async () => {
    const user = auth()
    await render({ ...user, isRegistering: true })
    expect(container.textContent).toContain('Preparing a verification email')
    expect(button('Sending email').disabled).toBe(true)
    await render({ ...user, verificationEmail: { uid: 'guest-one', email: 'guest@example.com', status: 'sent', message: null } })
    expect(container.textContent).toContain('We requested a verification email for')
    expect(container.textContent).not.toContain('Email verified')
    await render({ ...user, verificationEmail: { uid: 'guest-one', email: 'guest@example.com', status: 'failed', message: 'Please try again.' } })
    expect(container.textContent).toContain('Your account is still ready')
    expect(container.textContent).toContain('Please try again')
    await click(button('Send verification email'))
    expect(send).toHaveBeenCalledOnce()
  })

  it('offers an explicit status check and confirms only an actually verified address', async () => {
    const user = auth()
    await render(user)
    await click(button('I have verified my email'))
    expect(check).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Your email is not verified yet')
    check.mockResolvedValueOnce(true)
    await click(button('I have verified my email'))
    await render({ ...user, user: { ...user.user!, emailVerified: true } })
    expect(container.textContent).toContain('Email verified')
    await click(button('Dismiss'))
    expect(container.textContent).toBe('')
  })

  it('never attributes another account’s delivery state to the current Guest', async () => {
    await render(auth({
      verificationEmail: { uid: 'other-guest', email: 'other@example.com', status: 'sent', message: null },
    }))
    expect(container.textContent).toContain('guest@example.com')
    expect(container.textContent).not.toContain('other@example.com')
    expect(container.textContent).not.toContain('was sent')
  })

  it('does not show the notice for demo, Google, anonymous or already-verified sessions', async () => {
    const user = auth()
    for (const value of [
      { ...user, isCloud: false },
      { ...user, user: { ...user.user!, provider: 'google' as const } },
      { ...user, user: { ...user.user!, isAnonymous: true, provider: 'anonymous' as const } },
      { ...user, user: { ...user.user!, emailVerified: true } },
    ]) {
      await render(value)
      expect(container.textContent).toBe('')
    }
    expect(send).not.toHaveBeenCalled()
  })
})
