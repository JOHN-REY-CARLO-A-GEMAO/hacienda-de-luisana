// The homepage's sections became pages, and this file is the gate on that.
//
// Four ways that work goes wrong afterwards, all of them invisible in review:
//
//   1. A link is left pointing at a `/#section` anchor whose section has moved
//      off the homepage. Nothing breaks — the browser scrolls to the top of `/`
//      and the visitor sees a page that never mentions what they clicked.
//   2. A dedicated route exists but nothing links to it, so it is unreachable
//      except by typing the address.
//   3. A page renders with `.reveal` blocks that never get `.in`, which is
//      `opacity: 0` — a blank page that looks fine in the source.
//   4. A page answers with two `h1`s, or none, and its subject becomes
//      unreadable to a crawler.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { LINKS as NAV_LINKS } from '../../src/components/Nav'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The dedicated pages, and the one heading each must answer with.
 *
 * Listed rather than discovered: the point is that every route a visitor can be
 * sent to has a name, and that name is checked.
 */
const PAGES: ReadonlyArray<{ path: string; heading: string }> = [
  { path: '/stay', heading: 'Accommodations at the Hacienda' },
  { path: '/rates', heading: 'What a stay costs' },
  { path: '/gallery', heading: 'The Hacienda in photographs' },
  { path: '/experience', heading: 'More than a place to stay' },
  { path: '/location', heading: 'Getting to the Hacienda' },
  { path: '/reviews', heading: 'Reviews' },
  { path: '/faqs', heading: 'Common questions' },
  { path: '/house-rules', heading: 'Before you arrive' },
  { path: '/contact', heading: 'Talk to the Hacienda' },
]

/** Every path the site links to from the nav or the footer. */
const LINKED_PATHS = [
  ...NAV_LINKS.map((l) => l.href),
  '/house-rules',
  '/legal',
  '/book',
  '/account',
  '/messages',
]

/** The anchors the homepage still carries, and the hero and intro scroll to. */
const HOME_ANCHORS = ['intro', 'stay', 'rates', 'experience', 'gallery', 'reviews', 'location']

const mounted: Root[] = []

/**
 * The whole app on the real router, so a test can navigate the way a visitor
 * does. Mounting straight into an initial entry would not exercise the reveal
 * observer's re-arm: a fresh mount observes its own DOM either way, and the bug
 * is that a *second* page's DOM was never observed at all.
 *
 * `BrowserRouter` rather than a memory router on purpose. React Router's
 * `createMemoryRouter` builds a `Request` per navigation, and jsdom's
 * `AbortSignal` is not the instance undici accepts, so it throws inside the
 * router before the navigation happens. The history API avoids that entirely.
 */
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
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    reveals: () => [...container.querySelectorAll('.reveal')],
    async go(to: string) {
      await act(async () => {
        window.history.pushState({}, '', to)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
    },
  }
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
  window.history.pushState({}, '', '/')
})

describe('the homepage previews and the pages behind them', () => {
  it('gives every dedicated page exactly one heading, and it is the right one', () => {
    for (const { path, heading } of PAGES) {
      const page = open(path)
      const headings = [...page.container.querySelectorAll('h1')].map((h) =>
        (h.textContent ?? '').replace(/\s+/g, ' ').trim(),
      )
      expect(headings, `${path} should have exactly one h1`).toEqual([heading])
    }
  })

  it('reveals a page reached by navigating, not only one mounted directly', async () => {
    // jsdom has no IntersectionObserver, so `useReveal` marks every block `.in`
    // directly. What is under test is that it runs again for the second page's
    // DOM: an observer created once at mount never saw it, and `.reveal` is
    // `opacity: 0`, so /faqs would have rendered blank behind a working link.
    const page = open('/')
    expect(page.reveals().length).toBeGreaterThan(0)

    await page.go('/faqs')
    const reveals = page.reveals()
    expect(reveals.length, '/faqs rendered no reveal blocks').toBeGreaterThan(0)
    const hidden = reveals.filter((el) => !el.classList.contains('in'))
    expect(hidden, `${hidden.length} reveal blocks on /faqs are stuck invisible`).toEqual([])
    expect(page.text()).toContain('Common questions')
  })

  it('links to every dedicated page from the nav or the footer', () => {
    for (const { path } of PAGES) {
      expect(LINKED_PATHS, `${path} is not reachable from the nav or footer`).toContain(path)
    }
  })

  it('has no link pointing at a homepage anchor, on the homepage or any page', () => {
    for (const path of ['/', ...PAGES.map((p) => p.path)]) {
      const page = open(path)
      const stale = [...page.container.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((href) => href === '/#' || href.startsWith('/#'))
      expect(stale, `${path} still links to a homepage anchor: ${stale.join(', ')}`).toEqual([])
    }
  })

  it('has no same-page anchor without a target on the page it sits in', () => {
    // The one this catches for real: `Accommodations` used to sit on `/` beside
    // `#rates`, so `href="#rates"` was true there. Moved to /stay it became a
    // link to nowhere, and it looked fine in the source.
    for (const path of ['/', '/book', ...PAGES.map((p) => p.path)]) {
      const page = open(path)
      const dangling = [...page.container.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute('href')!)
        .filter((href) => href !== '#' && !page.container.querySelector(`[id="${href.slice(1)}"]`))
      expect(dangling, `${path} links to anchors it does not render: ${dangling.join(', ')}`).toEqual([])
    }
  })

  it('keeps every homepage anchor the nav used to point at', () => {
    const page = open('/')
    for (const id of HOME_ANCHORS) {
      expect(page.container.querySelector(`#${id}`), `/#${id} has no target left on /`).toBeTruthy()
    }
  })

  it('still offers every booking entry point on the homepage', () => {
    const page = open('/')
    const bookLinks = [...page.container.querySelectorAll('a[href^="/book"]')]
    expect(bookLinks.length, 'the homepage must still reach the booking form').toBeGreaterThan(0)
    for (const anchor of ['hero-cta', 'accommodation-cta', 'nav-book', 'mobile-cta']) {
      expect(page.container.querySelector(`[data-tour="${anchor}"]`), `data-tour="${anchor}" is gone`).toBeTruthy()
    }
  })
})