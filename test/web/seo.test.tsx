import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NOT_FOUND_META, ROUTE_META, indexableRoutes, prerenderRoutes, routeMetaFor } from '../../src/config/routes'
import {
  absoluteUrl,
  breadcrumbJsonLd,
  businessJsonLd,
  faqJsonLd,
  headTags,
  llmsTxt,
  robotsTxt,
  scriptJson,
  sitemapXml,
  structuredData,
} from '../../src/lib/seo'
import { RouteMeta } from '../../src/components/RouteMeta'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

// -----------------------------------------------------------------------------
// The manifest is the only place a page's title and description are written, so
// these tests are about the *contract* between it and everything that reads it:
// the router, the prerender, the sitemap and the browser.
// -----------------------------------------------------------------------------

describe('the route manifest matches the router', () => {
  const appSource = read('src/App.tsx')
  const routerPaths = new Set(
    [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1].replace(/\/\*$/, '')),
  )

  it('describes every public route the app declares', () => {
    // `/login` redirects to `/guest/auth`, and `*` is the not-found route; both
    // are addresses rather than pages, so neither needs its own head.
    const expected = [...routerPaths].filter((path) => path !== '*' && path !== '/login')
    const described = new Set(ROUTE_META.map((route) => route.path))
    const missing = expected.filter((path) => !described.has(path))
    expect(missing, 'add these to src/config/routes.ts').toEqual([])
  })

  it('declares no route the router would not answer', () => {
    const described = ROUTE_META.map((route) => route.path).filter((path) => path !== '/')
    const orphans = described.filter((path) => !routerPaths.has(path))
    expect(orphans, 'remove these from src/config/routes.ts').toEqual([])
  })
})

describe('every described page has a head worth serving', () => {
  it('writes a title that fits a search result', () => {
    for (const route of ROUTE_META) {
      expect(route.title.length, `${route.path} title is too long`).toBeLessThanOrEqual(70)
      expect(route.title.length, `${route.path} has no title`).toBeGreaterThan(10)
    }
  })

  it('writes a description long enough to be read and short enough to be kept', () => {
    for (const route of ROUTE_META) {
      expect(route.description.length, `${route.path} description is too short`).toBeGreaterThanOrEqual(70)
      expect(route.description.length, `${route.path} description will be truncated`).toBeLessThanOrEqual(175)
    }
  })

  it('gives no two pages the same title or the same description', () => {
    expect(new Set(ROUTE_META.map((route) => route.title)).size).toBe(ROUTE_META.length)
    expect(new Set(ROUTE_META.map((route) => route.description)).size).toBe(ROUTE_META.length)
  })

  it('names every page after the Hacienda', () => {
    for (const route of ROUTE_META) {
      expect(route.title, `${route.path} does not name the business`).toContain('Hacienda de LuisAna')
    }
  })
})

describe('what may be crawled', () => {
  const privatePaths = ['/mybookings', '/profile', '/messages', '/booking/status', '/book/pay', '/review', '/guest/auth']

  it('never indexes a signed-in page', () => {
    for (const path of privatePaths) {
      const route = routeMetaFor(path)
      expect(route.index, `${path} would appear in a result list`).toBe(false)
      expect(route.prerender, `${path} would be baked into a public file`).toBe(false)
    }
  })

  it('answers an address it does not know with the not-found head', () => {
    expect(routeMetaFor('/definitely-not-a-page')).toBe(NOT_FOUND_META)
    expect(NOT_FOUND_META.index).toBe(false)
  })

  it('treats a trailing slash as the same page', () => {
    expect(routeMetaFor('/stay/').path).toBe('/stay')
    expect(routeMetaFor('/').path).toBe('/')
  })

  it('prefers the longest match for a nested address', () => {
    expect(routeMetaFor('/booking/status').path).toBe('/booking/status')
    expect(routeMetaFor('/book/pay').path).toBe('/book/pay')
  })

  // The dogfood run typed /book/confirmation and got the Booking page's whole
  // head — title, `canonical /book` and `index, follow` — while the app painted
  // "Page not found" underneath. A page that does not exist must not lend its
  // parent's identity to a search engine.
  it('answers a path the router would not render with the not-found head', () => {
    for (const path of [
      '/book/confirmation',
      '/book/confirmation/',
      '/book/summary?ref=abc',
      '/stay/anything',
      '/rates/2024',
      '/gallery/old',
      '/nope',
    ]) {
      const route = routeMetaFor(path.split('?')[0])
      expect(route, `${path} borrowed another page's head`).toBe(NOT_FOUND_META)
      expect(route.index, `${path} would be indexed`).toBe(false)
    }
  })

  it('still serves the addresses the router does answer', () => {
    // The rule is not "no nested paths": /book/pay and /booking/status are real
    // pages with their own rows, and a query string is not part of the path.
    expect(routeMetaFor('/book/pay').path).toBe('/book/pay')
    expect(routeMetaFor('/booking/status').path).toBe('/booking/status')
    expect(routeMetaFor('/book').path).toBe('/book')
  })

  it('keeps a declared section answering for its children', () => {
    // /admin and /app are sections, not single pages: the router renders them
    // under a wildcard, so their head is right for anything below them.
    expect(routeMetaFor('/admin/bookings').path).toBe('/admin')
    expect(routeMetaFor('/app/anything').path).toBe('/app')
    expect(routeMetaFor('/app').path).toBe('/app')
  })

  it('indexes every prerendered page except the deployment report', () => {
    const prerendered = prerenderRoutes().map((route) => route.path)
    expect(prerendered.length).toBeGreaterThanOrEqual(10)
    const noindex = prerendered.filter((path) => !routeMetaFor(path).index)
    expect(noindex).toEqual(['/status'])
  })
})

// -----------------------------------------------------------------------------
// The head is only half of "this page is not here": the *status* has to agree.
//
// Both hosts used to answer every address they had no file for with a rewrite
// to /404.html, which is a 200. So /book/confirmation — a page the router does
// not have — came back "200 OK" with the not-found text in the body: invisible
// to a reader, and to a crawler a soft 404 it may index or keep retrying.
//
// Both hosts do have a real 404: an unmatched request is answered with
// 404.html *and* a 404 status. What stopped that from happening was the
// catch-all rewrite, which made every address "matched". So the catch-all is
// gone, and the handful of addresses the app really serves without a
// pre-rendered file list themselves by name. These tests are the gate on that
// list staying complete: add a route without adding it here and a deep link
// starts returning 404.
// -----------------------------------------------------------------------------
describe('the hosts answer an address they do not have with a 404 status', () => {
  const vercel = JSON.parse(read('vercel.json')) as {
    rewrites: Array<{ source: string; destination: string }>
  }
  const firebase = JSON.parse(read('firebase.json')) as {
    hosting: { rewrites: Array<{ source: string; destination: string }> }
  }

  /** The routes the app renders itself, with no pre-rendered file behind them. */
  const appOnly = ROUTE_META.filter((route) => !route.prerender).map((route) => route.path)
  /** `/login` is a redirect the router answers; it has no manifest row. */
  const spaPaths = [...appOnly, '/login'].sort()

  /** Does this host rule name the path? `/admin/**` (Firebase) and
      `/admin/(.*)` (Vercel) stand for the section and everything below it. */
  const covers = (source: string, path: string) =>
    source === path || source === `${path}/**` || source === `${path}/(.*)`

  it('keeps no catch-all rewrite, which would turn the 404 into a 200', () => {
    for (const [host, rules] of [
      ['vercel.json', vercel.rewrites],
      ['firebase.json', firebase.hosting.rewrites],
    ] as const) {
      const catchAll = rules.filter((rule) => /^\/(\(\.\*\)|\*{1,2})$|^\*{1,2}$/.test(rule.source))
      expect(catchAll, `${host} still answers everything with one rewrite`).toEqual([])
    }
  })

  it('rewrites every address the app serves without a pre-rendered file', () => {
    for (const [host, rules] of [
      ['vercel.json', vercel.rewrites],
      ['firebase.json', firebase.hosting.rewrites],
    ] as const) {
      const missing = spaPaths.filter((path) => !rules.some((rule) => covers(rule.source, path)))
      expect(missing, `${host} would answer these with 404 but they are real pages`).toEqual([])
    }
  })

  it('leaves a page it does not serve to the host’s own 404', () => {
    // The complement of the list above, with the address the dogfood run used.
    const matches = (source: string, path: string) => {
      const section = /\/(\(\.\*\)|\*\*)$/.test(source)
      const base = source.replace(/\/(\(\.\*\)|\*\*)$/, '')
      return section ? path === base || path.startsWith(`${base}/`) : path === source
    }
    for (const [host, rules] of [
      ['vercel.json', vercel.rewrites],
      ['firebase.json', firebase.hosting.rewrites],
    ] as const) {
      for (const path of ['/book/confirmation', '/nope', '/stay/anything', '/legal/old']) {
        expect(
          rules.filter((rule) => matches(rule.source, path)),
          `${host} rewrites ${path}, so it cannot answer 404`,
        ).toEqual([])
      }
    }
  })
})

describe('canonical URLs', () => {
  it('is absolute and slash-free below the root', () => {
    expect(absoluteUrl('/')).toBe('https://haciendadeluisana.com/')
    expect(absoluteUrl('/stay')).toBe('https://haciendadeluisana.com/stay')
    expect(absoluteUrl('/stay/')).toBe('https://haciendadeluisana.com/stay')
    expect(absoluteUrl('stay')).toBe('https://haciendadeluisana.com/stay')
  })

  it('appears in the head of every route', () => {
    for (const route of ROUTE_META) {
      expect(headTags(route)).toContain(`<link rel="canonical" href="${absoluteUrl(route.path)}" />`)
    }
  })
})

describe('headTags', () => {
  const stay = routeMetaFor('/stay')

  it('carries the title, description and robots policy', () => {
    const head = headTags(stay)
    expect(head).toContain(`<title>${stay.title.replace(/&/g, '&amp;')}</title>`)
    expect(head).toContain('name="description"')
    expect(head).toContain('name="robots" content="index, follow')
  })

  it('asks search engines to keep a private page out', () => {
    expect(headTags(routeMetaFor('/mybookings'))).toContain('content="noindex, nofollow"')
  })

  it('escapes the ampersands the page titles are full of', () => {
    expect(headTags(routeMetaFor('/rates'))).not.toMatch(/content="[^"]*&(?!amp;)[^"]*"/)
  })

  it('preloads the hero photograph on the homepage only', () => {
    expect(headTags(routeMetaFor('/'))).toContain('rel="preload" as="image" href="/images/gmaps/img-07.jpg"')
    expect(headTags(stay)).not.toContain('rel="preload"')
  })

  it('always shares the Hacienda’s own picture', () => {
    for (const route of ROUTE_META) {
      expect(headTags(route)).toContain('property="og:image" content="https://haciendadeluisana.com/images/brand/hdl-logo.jpg"')
    }
  })
})

describe('structured data', () => {
  it('describes the business as a LodgingBusiness an assistant can quote', () => {
    const graph = businessJsonLd()['@graph'] as Array<Record<string, unknown>>
    const lodging = graph.find((node) => node['@type'] === 'LodgingBusiness')!
    expect(lodging.name).toBe('Hacienda de LuisAna')
    expect(lodging.address).toMatchObject({ addressLocality: 'Luisiana', addressRegion: 'Laguna', addressCountry: 'PH' })
    expect(lodging.telephone).toBeTruthy()
    expect(lodging.sameAs).toEqual(expect.arrayContaining([expect.stringContaining('airbnb.com')]))
    // The claim the audit asked for: an Organization-shaped entity, not just a page.
    expect(lodging['@id']).toBe('https://haciendadeluisana.com/#lodging')
  })

  it('lists the website as its publisher', () => {
    const graph = businessJsonLd()['@graph'] as Array<Record<string, unknown>>
    const site = graph.find((node) => node['@type'] === 'WebSite')!
    expect(site.publisher).toEqual({ '@id': 'https://haciendadeluisana.com/#lodging' })
  })

  it('publishes the FAQ answers the page actually shows', () => {
    const faq = faqJsonLd() as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> }
    expect(faq.mainEntity.length).toBeGreaterThan(3)
    expect(faq.mainEntity[0].acceptedAnswer.text.length).toBeGreaterThan(40)
  })

  it('gives the FAQ page its questions and no other page', () => {
    const faqs = structuredData(routeMetaFor('/faqs')).join('\n')
    expect(faqs).toContain('FAQPage')
    expect(structuredData(routeMetaFor('/stay')).join('\n')).not.toContain('FAQPage')
  })

  it('breadcrumbs every page below the homepage', () => {
    const crumbs = breadcrumbJsonLd(routeMetaFor('/rates'))
    expect(crumbs['@type']).toBe('BreadcrumbList')
    expect(structuredData(routeMetaFor('/')).join('\n')).not.toContain('BreadcrumbList')
  })

  it('does not describe a private page to a crawler', () => {
    const schema = structuredData(routeMetaFor('/mybookings')).join('\n')
    expect(schema).toContain('LodgingBusiness')
    expect(schema).not.toContain('BreadcrumbList')
  })

  it('cannot be made to close its own script element', () => {
    expect(scriptJson({ text: '</script><script>alert(1)</script>' })).not.toContain('</script>')
  })
})

describe('crawler files', () => {
  it('lists every indexable page in the sitemap and nothing else', () => {
    const xml = sitemapXml('2026-10-23')
    for (const route of indexableRoutes()) {
      expect(xml).toContain(`<loc>${absoluteUrl(route.path)}</loc>`)
    }
    expect(xml).not.toContain('/mybookings')
    expect(xml).not.toContain('/status')
    expect(xml.match(/<url>/g)!.length).toBe(indexableRoutes().length)
  })

  it('keeps signed-in pages out of robots.txt, with the sitemap named', () => {
    const robots = robotsTxt()
    for (const path of ['/mybookings', '/messages', '/booking/status', '/book/pay', '/review']) {
      expect(robots).toContain(`Disallow: ${path}`)
    }
    expect(robots).toContain('Sitemap: https://haciendadeluisana.com/sitemap.xml')
    // One `*` group only: a named group would replace the Disallow list for that
    // bot rather than add to it.
    expect(robots.match(/^User-agent:/gm)!.length).toBe(1)
  })

  it('disallows exactly the pages the manifest keeps out of an index', () => {
    // `/status` is the one noindex route that is not in robots.txt: it is a
    // prerendered page that asks not to be listed with its own meta tag, and a
    // Disallow would stop a crawler reading the tag that says so.
    const disallowed = ROUTE_META.filter((route) => !route.index && !route.prerender).map((route) => route.path)
    const robots = robotsTxt()
    for (const path of disallowed) expect(robots, `${path} is not disallowed`).toContain(`Disallow: ${path}`)
  })

  it('writes an llms.txt an assistant can answer from', () => {
    const text = llmsTxt()
    expect(text.startsWith('# Hacienda de LuisAna')).toBe(true)
    expect(text).toContain('Luisiana–Lucban Road')
    expect(text).toContain('Check-in 2:00 PM')
    // Every public page is linked, absolutely, with its description.
    for (const route of indexableRoutes().filter((route) => route.path !== '/')) {
      expect(text).toContain(`(${absoluteUrl(route.path)})`)
      expect(text).toContain(route.description)
    }
    // No rate is invented, and no private page is advertised.
    expect(text).not.toContain('/mybookings')
    expect(text).not.toMatch(/₱\s?\d/ )
  })
})

describe('index.html', () => {
  const html = read('index.html')

  it('keeps the block the prerender replaces', () => {
    expect(html).toContain('<!-- seo:start -->')
    expect(html).toContain('<!-- seo:end -->')
    expect(html).toContain('<div id="root"></div>')
  })

  it('still carries the brand roundel the gallery audit looks for', () => {
    expect(html).toContain('/images/brand/hdl-logo.jpg')
  })

  it('does not hand-write structured data that seo.ts now generates', () => {
    expect(html).not.toContain('application/ld+json')
  })

  it('keeps the typefaces outside the block the prerender replaces', () => {
    // The head swap is a string replacement between two markers: anything inside
    // them is per-page and anything outside must survive. The fonts were once
    // lost this way, and the site rendered in a fallback serif.
    const afterMarkers = html.slice(html.indexOf('<!-- seo:end -->'))
    expect(afterMarkers).toContain('fonts.googleapis.com')
    expect(afterMarkers).toContain('family=Cormorant+Garamond')
  })

  it('does not let reveal-on-scroll hide the page when JavaScript never runs', () => {
    expect(html).toMatch(/<noscript>[\s\S]*\.reveal[\s\S]*<\/noscript>/)
  })
})

describe('the build actually runs the prerender', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  const gate = read('scripts/phase0/inside.mjs')

  it('builds the client, the SSR bundle and the static pages, in that order', () => {
    expect(pkg.scripts.build).toBe('npm run build:client && npm run build:server && npm run build:prerender')
    expect(pkg.scripts['build:server']).toContain('vite.ssr.config.ts')
    expect(pkg.scripts['build:prerender']).toContain('scripts/prerender.mjs')
  })

  it('is covered by the phase-0 build gate, so a broken prerender fails it', () => {
    expect(gate).toContain('scripts/prerender.mjs')
  })

  it('keeps the SSR bundle out of the repository and out of the deploy', () => {
    expect(read('.gitignore')).toContain('dist-ssr/')
  })
})

// -----------------------------------------------------------------------------
// The client half: navigating without a page load must still change the head.
// -----------------------------------------------------------------------------

describe('RouteMeta', () => {
  let container: HTMLDivElement
  let root: Root

  // `MemoryRouter` reads `initialEntries` once, so navigation has to be a real
  // push rather than a second mount — which is also what the app does.
  let navigate: (to: string) => void = () => {}
  function CapturedNavigate() {
    navigate = useNavigate()
    return null
  }

  function renderAt(path: string) {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <CapturedNavigate />
          <Routes>
            <Route path="*" element={<RouteMeta />} />
          </Routes>
        </MemoryRouter>,
      )
    })
  }

  beforeEach(() => {
    document.head.innerHTML = '<title>old</title><meta name="description" content="old" />'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('rewrites the title and description for the page on screen', () => {
    renderAt('/rates')
    const meta = routeMetaFor('/rates')
    expect(document.title).toBe(meta.title)
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(meta.description)
  })

  it('moves the canonical link and the Open Graph URL with it', () => {
    renderAt('/faqs')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://haciendadeluisana.com/faqs')
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://haciendadeluisana.com/faqs')
  })

  it('replaces — never appends — the route schema', () => {
    renderAt('/faqs')
    act(() => navigate('/stay'))
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts.length).toBe(1)
    expect(scripts[0].textContent).not.toContain('FAQPage')
  })

  it('marks an unknown address noindex', () => {
    renderAt('/no-such-page')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })

  it('keeps the head of a page opened with a query string', () => {
    // A payment link carries its reference in the query; the path is the page.
    renderAt('/book/pay?txn=ABC-123')
    expect(document.title).toBe(routeMetaFor('/book/pay').title)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://haciendadeluisana.com/book/pay',
    )
  })

  it('gives /book/confirmation the not-found head, not the Booking page head', () => {
    renderAt('/book/confirmation')
    expect(document.title).toBe(NOT_FOUND_META.title)
    expect(document.title).not.toBe(routeMetaFor('/book').title)
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    // No canonical pointing at a page this is not.
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).not.toBe(
      'https://haciendadeluisana.com/book',
    )
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      NOT_FOUND_META.title,
    )
  })
})
