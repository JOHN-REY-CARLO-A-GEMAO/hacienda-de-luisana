import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: null as null | { uid: string; isAnonymous: boolean }, role: 'guest' }))
vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user, role: mocks.role, refresh: vi.fn() }),
}))
vi.mock('../../src/lib/firebase', () => ({ auth: null, googleProvider: null }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: vi.fn() },
  linkWithCredential: vi.fn(),
  linkWithPopup: vi.fn(),
}))

import { SupportPage } from '../../src/pages/SupportPage'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.user = null
  mocks.role = 'guest'
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

  it('preserves anonymous Booking account linking', async () => {
    mocks.user = { uid: 'anonymous-one', isAnonymous: true }
    await render()
    expect(container.textContent).toContain('Secure this booking identity')
    expect(container.textContent).toContain('keeps the same UID')
    expect(container.querySelector('input[type="email"]')).not.toBeNull()
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
  })
})
