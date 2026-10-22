// The mobile header is Logo | Book Now | Menu, and the drawer behind Menu is
// the only place the rest of the navigation goes on a phone. These checks hold
// that shape: the booking CTA stays outside the drawer, every destination is
// in it, and it opens, closes on Escape and closes after a choice.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { LINKS } from '../../src/components/Nav'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function open(initialPath = '/') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  window.history.pushState({}, '', initialPath)
  act(() => {
    root.render(
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>,
    )
  })
  return {
    container,
    header: () => container.querySelector('header') as HTMLElement,
    drawer: () => container.querySelector('#mobile-nav') as HTMLElement,
    menu: () => container.querySelector('button[aria-controls="mobile-nav"]') as HTMLButtonElement,
  }
}

function click(element: Element | null) {
  if (!element) throw new Error('nothing to click')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
  document.documentElement.classList.remove('dark')
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('the mobile header', () => {
  it('keeps a booking CTA and the menu button in the header, outside the drawer', () => {
    const page = open('/')
    const book = page.header().querySelector('a[aria-label="Book your stay"]')
    expect(book, 'the header lost its booking CTA').toBeTruthy()
    expect(book!.closest('#mobile-nav'), 'the booking CTA fell inside the drawer').toBeNull()
    expect(book!.getAttribute('href')).toBe('/book')

    const menu = page.menu()
    expect(menu, 'the header has no menu button').toBeTruthy()
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(menu.getAttribute('aria-label')).toBe('Open menu')
    expect(menu.getAttribute('aria-controls')).toBe('mobile-nav')
  })

  it('lists every destination and Sign in in the drawer, and no theme switch', () => {
    const page = open('/')
    const drawer = page.drawer()
    for (const link of LINKS) {
      expect(drawer.textContent, `${link.label} is missing from the drawer`).toContain(link.label)
    }
    expect(drawer.querySelector('a[href="/guest/auth"]'), 'no Sign in in the drawer').toBeTruthy()
    // And no dropdown: the drawer's primary list is plain links.
    expect(drawer.querySelector('[aria-haspopup], [role="menu"]')).toBeNull()
  })

  it('opens, and closes on Escape with focus back on the menu button', async () => {
    const page = open('/')
    click(page.menu())
    expect(page.menu().getAttribute('aria-expanded')).toBe('true')
    expect(page.menu().getAttribute('aria-label')).toBe('Close menu')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(page.menu().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(page.menu())
  })

  it('closes after choosing a destination, even when the route does not change', () => {
    const page = open('/')
    click(page.menu())
    const home = page.drawer().querySelector('a[href="/"]')
    expect(home, 'Home is missing from the drawer').toBeTruthy()
    click(home)
    expect(page.menu().getAttribute('aria-expanded')).toBe('false')
  })

  it('offers no theme switch anywhere in the header or the drawer', () => {
    const page = open('/')
    const isThemeSwitch = (el: Element) => /theme/i.test(el.getAttribute('aria-label') ?? '')
    expect([...page.header().querySelectorAll('button')].filter(isThemeSwitch)).toEqual([])
    click(page.menu())
    expect([...page.drawer().querySelectorAll('button, a')].filter(isThemeSwitch)).toEqual([])
    expect(page.drawer().textContent ?? '').not.toMatch(/theme/i)
  })
})
