import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Nav } from '../../src/components/Nav'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  auth: { user: { uid: 'guest-1', email: 'john@example.com', isAnonymous: false }, profile: { first_name: 'John', display_name: 'John Santos' }, role: 'guest' },
  notifications: { unreadCount: 12, signedIn: true },
}))
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ ...mocks.auth, logout: mocks.logout }) }))
vi.mock('../../src/hooks/useNotifications', () => ({ useNotifications: () => mocks.notifications }))
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
function CurrentLocation() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}
function open() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/stay']}><Nav /><CurrentLocation /></MemoryRouter>))
  return host.querySelector<HTMLButtonElement>('button[aria-controls="desktop-account-menu"]')!
}
function click(element: Element) {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}
beforeEach(() => {
  mocks.auth.role = 'guest'
  mocks.notifications.unreadCount = 12
  mocks.logout.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('desktop account disclosure', () => {
  it('opens John’s menu with bookings, notifications, unread count, and sign out', () => {
    const button = open()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toContain('12 unread notifications')
    expect(host.querySelector('#desktop-account-menu')).toBeNull()
    click(button)
    const menu = host.querySelector('#desktop-account-menu')!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(menu.textContent).toContain('John Santos')
    expect(menu.textContent).toContain('9+')
    expect(menu.querySelector('a[href="/mybookings"]')?.textContent).toContain('My bookings')
    expect(menu.querySelector('a[href="/profile"]')?.textContent).toContain('My profile')
    expect(menu.querySelector('a[href="/mybookings?tab=notifications"]')?.textContent).toContain('Notifications')
    expect(menu.textContent).toContain('Sign out')
  })

  it('closes on Escape with focus returned, and on outside click', () => {
    const button = open()
    click(button)
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
    click(button)
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it.each(['/mybookings', '/profile'])('opens %s from the account menu', (path) => {
    const button = open()
    click(button)
    click(host.querySelector(`#desktop-account-menu a[href="${path}"]`)!)
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(path)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('navigates to notifications and closes the menu', () => {
    const button = open()
    click(button)
    click(host.querySelector('#desktop-account-menu a[href="/mybookings?tab=notifications"]')!)
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/mybookings?tab=notifications')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('signs out from the menu', () => {
    const button = open()
    click(button)
    click(host.querySelector('#desktop-account-menu button')!)
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not offer guest-only links to an admin', () => {
    mocks.auth.role = 'admin'
    const button = open()
    click(button)
    expect(host.querySelector('#desktop-account-menu a[href="/mybookings"]')).toBeNull()
    expect(host.querySelector('#desktop-account-menu a[href="/profile"]')).toBeNull()
    expect(host.querySelector('#desktop-account-menu a[href="/mybookings?tab=notifications"]')).toBeNull()
    expect(host.querySelector('#desktop-account-menu')?.textContent).toContain('Sign out')
  })
})
