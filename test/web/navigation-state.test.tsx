// "You are here" — said once, and only about the page being read.
//
// The dogfood run found /legal (and /rates, and /faqs) with no `aria-current`
// anywhere, so a screen-reader user had no way to tell which of the links they
// were offered was the page in front of them. Auditing the bar turned up the
// opposite problem too: "Stay" was marked `aria-current="page"` on /rates, which
// is a different page — /stay. Both are pinned here, route by route, against the
// real app on the real router.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { ROUTE_META } from '../../src/config/routes'
import { currentStateFor, type NavLink } from '../../src/lib/nav-state'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function open(path: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  window.history.pushState({}, '', path)
  act(() => {
    root.render(
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>,
    )
  })
  return container
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
  window.history.pushState({}, '', '/')
})

/**
 * The pages a visitor can reach, the one address that should claim to *be* each
 * page, and the bar link whose section holds it.
 *
 * `page` is where an exact link to the page exists — the bar for a destination,
 * the footer for /legal, /support and /house-rules, the phone drawer for those
 * three as well. `section` is the bar link that stays marked on a detail page
 * (/rates under Stay). Both are compared as sets over the whole document, so a
 * disagreement between the bar, the drawer and the footer fails.
 *
 * /book is its own flow under no bar link: the bar keeps offering the seven
 * destinations while it is open, and none of them is the page.
 */
const ROUTES: ReadonlyArray<{ path: string; page: string | null; section?: string }> = [
  { path: '/', page: '/' },
  { path: '/stay', page: '/stay' },
  { path: '/rates', page: '/rates', section: '/stay' },
  { path: '/experience', page: '/experience' },
  { path: '/gallery', page: '/gallery' },
  { path: '/location', page: '/location' },
  { path: '/reviews', page: '/reviews' },
  { path: '/contact', page: '/contact' },
  { path: '/faqs', page: '/faqs', section: '/contact' },
  { path: '/book', page: null },
  { path: '/legal', page: '/legal' },
  { path: '/house-rules', page: '/house-rules' },
  { path: '/support', page: '/support' },
]

/**
 * Every public page in the manifest — the 13 the audit walked.
 *
 * Taken from the manifest, not from `ROUTES`, so a page added to the site
 * without being added to the audit fails here instead of quietly going
 * unmarked. /status is deliberately absent: it is an operational notice page,
 * not a destination in the bar or the footer.
 */
const PUBLIC_PATHS = ROUTE_META.filter((route) => route.prerender && route.path !== '/status').map(
  (route) => route.path,
)

const href = (el: Element) => el.getAttribute('href') ?? ''

/** A destination can be offered twice — bar on desktop, drawer on a phone — so
    markers are compared as the set of addresses they point at. */
const distinct = (values: string[]) => [...new Set(values)].sort()

function marks(container: HTMLElement) {
  // This audit is about destination links. The booking journey also uses the
  // valid ARIA token `step` on a non-link list item; it is not a page marker.
  const all = [...container.querySelectorAll<HTMLElement>('a[aria-current]')]
  return {
    pages: distinct(all.filter((el) => el.getAttribute('aria-current') === 'page').map(href)),
    sections: distinct(all.filter((el) => el.getAttribute('aria-current') === 'true').map(href)),
    // Anything still carrying the legacy token (`aria-current=""`, "location",
    // "date"…) — `aria-current` is enumerated, and an invented value is
    // announced as nothing at all.
    invalid: all
      .map((el) => el.getAttribute('aria-current'))
      .filter((value) => value !== 'page' && value !== 'true' && value !== 'false'),
  }
}

describe('the audit covers every public page', () => {
  it('lists the 13 routes the audit walked', () => {
    expect(PUBLIC_PATHS.slice().sort()).toEqual(
      ['/', '/book', '/contact', '/experience', '/faqs', '/gallery', '/house-rules', '/legal', '/location', '/rates', '/reviews', '/stay', '/support'].sort(),
    )
    expect(ROUTES.map((route) => route.path).sort()).toEqual(PUBLIC_PATHS.slice().sort())
  })
})

describe('each page names itself exactly once', () => {
  for (const { path, page, section } of ROUTES) {
    it(`${path} marks ${page ?? 'no bar link'} as the page${section ? ` and ${section} as its section` : ''}`, () => {
      const container = open(path)
      const { pages, sections, invalid } = marks(container)

      // No invented tokens: an invalid `aria-current` is worse than none.
      expect(invalid, `${path} has an aria-current a screen reader will ignore`).toEqual([])

      // Exactly one address claims to *be* this page, everywhere on the page:
      // the bar, the phone drawer and the footer must agree.
      expect(pages, `${path} page marker`).toEqual(page ? [page] : [])
      expect(sections, `${path} section marker`).toEqual(section ? [section] : [])
    })
  }
})

describe('the rule itself', () => {
  const stay: NavLink = { href: '/stay', label: 'Stay', also: ['/rates'] }
  const home: NavLink = { href: '/', label: 'Home' }
  const legal: NavLink = { href: '/legal', label: 'Legal' }

  it('separates "this page" from "this section"', () => {
    expect(currentStateFor(stay, '/stay')).toBe('page')
    expect(currentStateFor(stay, '/rates')).toBe('section')
    expect(currentStateFor(stay, '/rates/')).toBe('section')
  })

  it('does not match by substring', () => {
    // '/stay' must not answer for '/staying' or '/gallery/stay'.
    expect(currentStateFor(stay, '/staying')).toBeNull()
    expect(currentStateFor(stay, '/gallery/stay')).toBeNull()
    expect(currentStateFor(legal, '/legal-notes')).toBeNull()
  })

  it('matches the homepage only on the homepage', () => {
    expect(currentStateFor(home, '/')).toBe('page')
    expect(currentStateFor(home, '/stay')).toBeNull()
  })

  it('leaves an unrelated page unmarked', () => {
    expect(currentStateFor(legal, '/stay')).toBeNull()
  })
})
