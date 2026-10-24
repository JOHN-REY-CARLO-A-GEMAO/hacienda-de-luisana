// -----------------------------------------------------------------------------
// ROUTE MANIFEST — one row per address, and the only place a page's title and
// description are written.
// -----------------------------------------------------------------------------
//
// The website shipped for months with a single `<title>` and a single
// description for all twenty-odd pages, written by hand in `index.html`. Two
// things followed from that:
//
//   * Every address answered search engines with the homepage's headline, so
//     `/rates`, `/faqs` and `/stay` were indistinguishable in a result list.
//   * Nothing told the client that the title had changed. A Guest who navigated
//     from `/` to `/reviews` stayed "Hacienda de LuisAna | Private Stay &
//     Camping…" in the tab, the history, and any link they copied.
//
// This file is that list. It is read by three consumers and no others:
//
//   1. `src/lib/seo.ts` — builds the `<head>` (title, description, canonical,
//      Open Graph, Twitter, robots, JSON-LD) for a given path.
//   2. `src/components/RouteMeta.tsx` — applies the same tags in the browser
//      when the Guest navigates without a page load.
//   3. `scripts/prerender.mjs` — decides which routes are rendered to static
//      HTML at build time, and which go into `sitemap.xml` and `llms.txt`.
//
// Adding a route to `src/App.tsx` without adding it here is not an error, but
// the page will inherit the "not found" head (noindex) instead of its own. The
// test in `test/web/seo.test.ts` pins the manifest against the router, so the
// two lists cannot drift quietly.
//
// `prerender` and `index` are deliberately separate questions:
//
//   * `prerender` — render this route to HTML at build time. True for every
//     page a visitor can read without signing in, because those are the pages a
//     crawler that does not run JavaScript (and that is most of them, including
//     every AI assistant) can otherwise not see at all.
//   * `index` — ask search engines to list it. False for the deployment report
//     (useful to the Hacienda, noise in a result list) and for every signed-in
//     page: `/account`, `/messages`, a booking's status, the payment step and
//     the review desk belong to one Guest and must never appear in a search
//     result.
//
// A route that is not listed here is answered with the "not found" head. That is
// the safe default: a page we forgot to describe is a page we have not decided
// to publish.

export type RouteMeta = {
  /** Path only, no origin, no trailing slash except at the root. */
  path: string
  /** `<title>`. Kept under 60 characters so Google does not rewrite it. */
  title: string
  /** `<meta name="description">`. Kept near 155 characters. */
  description: string
  /** Ask search engines to list this page. */
  index: boolean
  /** Render to static HTML at build time. */
  prerender: boolean
  /** `sitemap.xml` hint for indexable routes. 1.0 is the homepage. */
  priority?: number
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  /**
   * The router serves this address *and everything under it* (`/admin/*`).
   * Only a row that says so may answer for a longer path; without this flag a
   * stray `/book/confirmation` inherited the Booking page's title, canonical
   * and `index, follow` while the app rendered "Page not found" underneath.
   */
  subtree?: boolean
}

const BRAND = 'Hacienda de LuisAna'

export const ROUTE_META: readonly RouteMeta[] = [
  {
    path: '/',
    title: `${BRAND} | Private Stay & Camping in Luisiana, Laguna`,
    description:
      'Discover Hacienda de LuisAna in Luisiana, Laguna — a peaceful private getaway for families, small gatherings, camping, and countryside escapes.',
    index: true,
    prerender: true,
    priority: 1,
    changefreq: 'weekly',
  },
  {
    path: '/stay',
    title: `Stay: Main House & A-Frame Camping | ${BRAND}`,
    description:
      'The Main House, the Annex and the A-frame camping units at Hacienda de LuisAna in Luisiana, Laguna — what each one sleeps, what it includes, and what it costs.',
    index: true,
    prerender: true,
    priority: 0.9,
    changefreq: 'monthly',
  },
  {
    path: '/rates',
    title: `Rates & Fees | ${BRAND}`,
    description:
      'Accommodation rates, the refundable security deposit, the 22-hour standard stay and the extras the Hacienda charges for — as published by the Admin.',
    index: true,
    prerender: true,
    priority: 0.9,
    changefreq: 'weekly',
  },
  {
    path: '/book',
    title: `Check Availability & Book | ${BRAND}`,
    description:
      'Check live availability for the Main House or an A-frame camping unit, send a booking request, and upload the downpayment screenshot the Hacienda reviews.',
    index: true,
    prerender: true,
    priority: 0.8,
    changefreq: 'weekly',
  },
  {
    path: '/gallery',
    title: `Gallery | ${BRAND}`,
    description:
      'Photographs of Hacienda de LuisAna — the Main House, the grounds, the camping units and the countryside around Luisiana, Laguna.',
    index: true,
    prerender: true,
    priority: 0.7,
    changefreq: 'monthly',
  },
  {
    path: '/experience',
    title: `Experience & Nearby Attractions | ${BRAND}`,
    description:
      'Campfires, long meals and quiet mornings at the Hacienda, plus the waterfalls, caves, heritage towns and lakes within reach of Luisiana, Laguna.',
    index: true,
    prerender: true,
    priority: 0.7,
    changefreq: 'monthly',
  },
  {
    path: '/location',
    title: `Location & Directions | ${BRAND}`,
    description:
      'Luisiana–Lucban Road, Brgy. San Isidro, Luisiana, Laguna — the landmark to look for, the driving route from Metro Manila and the public-transport route.',
    index: true,
    prerender: true,
    priority: 0.7,
    changefreq: 'yearly',
  },
  {
    path: '/reviews',
    title: `Guest Reviews | ${BRAND}`,
    description:
      'What guests say about Hacienda de LuisAna, word for word: the Airbnb reviews of the listing alongside reviews written by guests after a real stay.',
    index: true,
    prerender: true,
    priority: 0.6,
    changefreq: 'weekly',
  },
  {
    path: '/faqs',
    title: `FAQs: Guests, Pets, Parking & Wi-Fi | ${BRAND}`,
    description:
      'How many guests can stay, whether pets are allowed, parking, Wi-Fi, cooking, check-in times and the booking lead time — answered by the Hacienda.',
    index: true,
    prerender: true,
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/house-rules',
    title: `House Rules | ${BRAND}`,
    description:
      'The house rules at Hacienda de LuisAna, and what recent guests found useful to know before arriving in Luisiana, Laguna.',
    index: true,
    prerender: true,
    priority: 0.5,
    changefreq: 'yearly',
  },
  {
    path: '/contact',
    title: `Contact the Hacienda | ${BRAND}`,
    description:
      'Phone, email, Messenger and the Facebook page — the only official channels. Ask about your dates, a small gathering, or whether the house is free.',
    index: true,
    prerender: true,
    priority: 0.7,
    changefreq: 'yearly',
  },
  {
    path: '/legal',
    title: `Terms, Privacy & Booking Rules | ${BRAND}`,
    description:
      'The terms, privacy policy, booking and cancellation rules, payment rules and smart-lock rules that apply to every stay at Hacienda de LuisAna.',
    index: true,
    prerender: true,
    priority: 0.4,
    changefreq: 'yearly',
  },
  {
    path: '/support',
    title: `Support & Disputes | ${BRAND}`,
    description:
      'Report a problem with a booking, attach evidence, and follow the case the Admin reviews in the Hacienda de LuisAna mobile app.',
    index: true,
    prerender: true,
    priority: 0.4,
    changefreq: 'yearly',
  },
  {
    path: '/status',
    title: `Deployment Status | ${BRAND}`,
    // Public and read-only, but it answers a question about this deployment
    // rather than about the Hacienda. Crawlers are asked to skip it.
    description:
      'Which Firebase and Supabase project this deployment reaches, and what happens to a Guest’s booking and payment proof when one is missing.',
    index: false,
    prerender: true,
  },

  // ---- Signed-in pages: rendered by the app, never prerendered, never indexed.
  // They still get a title and a description: a Guest sees the first in the tab
  // and the second in a link preview, and neither is a claim about the site —
  // they describe one person's own records.
  {
    path: '/account',
    title: `My Bookings & Profile | ${BRAND}`,
    description:
      'Your own bookings, their status and payment plan, your saved profile details and the notifications the Hacienda has sent you.',
    index: false,
    prerender: false,
  },
  {
    path: '/messages',
    title: `Messages | ${BRAND}`,
    description:
      'Your private conversation with the Hacienda about a stay — only your thread is visible, and it is cleared after its retention period.',
    index: false,
    prerender: false,
  },
  {
    path: '/booking/status',
    title: `Booking Status | ${BRAND}`,
    description:
      'Look up the status of a booking request: whether the dates are held, whether the downpayment was approved, and what happens next.',
    index: false,
    prerender: false,
  },
  {
    path: '/book/pay',
    title: `Downpayment | ${BRAND}`,
    description:
      'Send the downpayment screenshot for your booking request, and the reference number the Hacienda checks it against before approving.',
    index: false,
    prerender: false,
  },
  {
    path: '/guest/auth',
    title: `Sign In | ${BRAND}`,
    description:
      'Sign in to your Guest account, create one, or reset a forgotten password — the same account that holds your bookings and messages.',
    index: false,
    prerender: false,
  },
  {
    path: '/review',
    title: `Review Desk | ${BRAND}`,
    description:
      'The downpayments awaiting the Admin: approve a screenshot to confirm a stay, or decline it with the reason the Guest will read.',
    index: false,
    prerender: false,
  },
  // The retired web dashboards. The pages exist only to say where that work
  // moved, so they are addressed here and kept out of every index.
  {
    path: '/admin',
    title: `The Admin Dashboard Moved | ${BRAND}`,
    description:
      'Booking review, payment verification, stays and analytics are in the Hacienda de LuisAna Admin mobile app. This website is for Guests.',
    index: false,
    prerender: false,
    subtree: true,
  },
  {
    path: '/app',
    title: `The Admin App | ${BRAND}`,
    description:
      'The Admin dashboard lives in the Hacienda de LuisAna mobile app. Book, pay and follow your own stay on this website instead.',
    index: false,
    prerender: false,
    subtree: true,
  },
] as const

/** The head a route we know nothing about gets: a 404, and no indexing. */
export const NOT_FOUND_META: RouteMeta = {
  path: '/404',
  title: `Page Not Found | ${BRAND}`,
  description:
    'That page does not exist or has moved. Head back to the Hacienda, or check availability for the dates you had in mind.',
  index: false,
  prerender: false,
}

/**
 * The manifest row for a pathname, or the not-found head.
 *
 * Longest match wins, so `/booking/status` is never answered by a `/booking`
 * row that a future edit might add. Trailing slashes are ignored: `/stay/` and
 * `/stay` are one page, and the canonical tag says so.
 *
 * A path *under* a listed one is not that page. `/book/confirmation` is not
 * `/book`: the router has no such screen, so the app renders "Page not found"
 * there, and the head has to agree — title, canonical and `noindex` included.
 * Only a row marked `subtree` (`/admin/*`, `/app/*`) answers for its children,
 * because those are the only ones the router actually serves as a section.
 */
export function routeMetaFor(pathname: string): RouteMeta {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  const exact = ROUTE_META.find((route) => route.path === clean)
  if (exact) return exact
  const subtree = ROUTE_META.filter(
    (route) => route.subtree && route.path !== '/' && clean.startsWith(`${route.path}/`),
  ).sort((a, b) => b.path.length - a.path.length)[0]
  return subtree ?? NOT_FOUND_META
}

/** Routes rendered to static HTML at build time, homepage first. */
export function prerenderRoutes(): RouteMeta[] {
  return ROUTE_META.filter((route) => route.prerender)
}

/** Routes listed in `sitemap.xml`. */
export function indexableRoutes(): RouteMeta[] {
  return ROUTE_META.filter((route) => route.index)
}
