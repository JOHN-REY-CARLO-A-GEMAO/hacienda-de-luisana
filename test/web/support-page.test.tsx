import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string; isAnonymous: boolean }, role: 'guest', loading: false,
  auth: null as null | { currentUser: { uid: string; isAnonymous: boolean; getIdToken: ReturnType<typeof vi.fn> } },
  google: null as null | object,
  refresh: vi.fn(), credential: vi.fn(), linkEmail: vi.fn(), linkGoogle: vi.fn(),
}))
vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user, role: mocks.role, loading: mocks.loading, refresh: mocks.refresh }),
}))
vi.mock('../../src/lib/firebase', () => ({ get auth() { return mocks.auth }, get googleProvider() { return mocks.google } }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: mocks.credential },
  linkWithCredential: mocks.linkEmail,
  linkWithPopup: mocks.linkGoogle,
}))

import { SupportPage } from '../../src/pages/SupportPage'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.resetAllMocks()
  mocks.user = null
  mocks.role = 'guest'
  mocks.loading = false
  mocks.auth = null
  mocks.google = null
  mocks.refresh.mockResolvedValue(undefined)
  mocks.linkEmail.mockResolvedValue(undefined)
  mocks.linkGoogle.mockResolvedValue(undefined)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => root.render(<MemoryRouter><SupportPage /></MemoryRouter>))
}

function prepareAnonymous() {
  mocks.user = { uid: 'anonymous-one', isAnonymous: true }
  mocks.auth = { currentUser: { uid: 'anonymous-one', isAnonymous: true, getIdToken: vi.fn().mockResolvedValue('token') } }
}

function fill(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function submitLink() {
  fill(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'guest@example.com')
  fill(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'secret1')
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('general Guest support after case retirement', () => {
  it('keeps public support and sign-in links without case controls', async () => {
    await render()
    expect(container.textContent).toContain('How can we help?')
    expect(container.textContent).toContain('Sign in to start a private conversation')
    expect(container.querySelector('a[href="/messages"]')).not.toBeNull()
    expect(container.querySelector('a[href="/contact"]')).not.toBeNull()
    expect(container.textContent).not.toMatch(/dispute|case notification|report an issue|evidence/i)
  })

  it('offers an ordinary private message with an image instead of a case history', async () => {
    mocks.user = { uid: 'guest-one', isAnonymous: false }
    await render()
    expect(container.textContent).toContain('Your Booking, your conversation')
    expect(container.textContent).toContain('JPEG, PNG, or WebP')
    expect(container.textContent).toContain('5 MB')
    expect(container.textContent).not.toMatch(/case history|case notification|resolution|evidence/i)
  })

  it('does not offer guest messaging to an admin and supports the dark page', async () => {
    mocks.user = { uid: 'admin', isAnonymous: false }
    mocks.role = 'admin'
    await render()
    expect(container.textContent).toContain('Guest messages are in the Admin app')
    expect(container.querySelector('a[href="/messages"]')).toBeNull()
    expect(container.querySelector('.dark\\:bg-forest-950')).not.toBeNull()
  })

  it('disables Google when it is unavailable rather than falling back to email', async () => {
    prepareAnonymous()
    await render()
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Link with Google'))!
    expect(button.disabled).toBe(true)
    expect(container.textContent).toContain('Google linking is not configured')
    expect(mocks.linkEmail).not.toHaveBeenCalled()
  })

  it('links the existing identity and announces success', async () => {
    prepareAnonymous()
    await render()
    await submitLink()
    expect(mocks.linkEmail).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('linked successfully')
    expect(container.querySelector('form')).toBeNull()
  })

  it('does not report a completed link as failed when refreshing the token fails', async () => {
    prepareAnonymous()
    mocks.auth!.currentUser.getIdToken.mockRejectedValue(new Error('offline'))
    await render()
    await submitLink()
    expect(container.textContent).toContain('identity was linked, but the session could not be refreshed')
    expect(container.querySelector('form')).toBeNull()
  })

  it('explains account conflicts without exposing Firebase errors and permits retry', async () => {
    prepareAnonymous()
    mocks.linkEmail.mockRejectedValue({ code: 'auth/credential-already-in-use', message: 'Firebase internal details' })
    await render()
    await submitLink()
    expect(container.textContent).toContain('already linked to another account')
    expect(container.textContent).not.toContain('Firebase internal details')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })

  it('preserves anonymous Booking account linking', async () => {
    mocks.user = { uid: 'anonymous-one', isAnonymous: true }
    await render()
    expect(container.textContent).toContain('Secure this booking identity')
    expect(container.textContent).toContain('keeps the same UID')
    expect(container.querySelector('input[type="email"]')).not.toBeNull()
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
  })
})
