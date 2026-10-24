import {
  AIRBNB_RATING,
  BUSINESS,
  FAQS,
  LISTINGS,
  OFFICIAL_CHANNELS,
  SITE_ORIGIN,
} from '../config/site'
import { indexableRoutes, type RouteMeta } from '../config/routes'

// -----------------------------------------------------------------------------
// SEO — everything that describes a page to a machine that is not a browser
// -----------------------------------------------------------------------------
//
// The website was a single-page app with one hand-written `<title>`, one
// description, no canonical, no `Organization`, no sitemap and no robots file.
// None of that is a design question; it is the difference between a crawler
// seeing twenty pages of writing and seeing an empty `<div id="root">`.
//
// Everything here is a pure string builder: no DOM, no React. That is what lets
// the same functions serve three callers —
//
//   * `scripts/prerender.mjs`, which writes the `<head>` into static HTML at
//     build time (this is what crawlers that do not run JavaScript actually
//     read: Google's first pass, Bing, and every AI assistant);
//   * `src/components/RouteMeta.tsx`, which applies the same tags in the
//     browser when a Guest navigates client-side;
//   * `test/web/seo.test.ts`, which pins the invariants — absolute canonical
//     URLs, no indexable private page, a description of a useful length.
//
// The rules the output follows:
//
//   * `canonical` is always absolute and always without a trailing slash (but
//     the root, which is `/`). `/stay` and `/stay/` are one page.
//   * `og:image` points at the Hacienda's own roundel, served from this site, so
//     a shared link always carries a picture.
//   * Structured data describes what is on the page and nothing else: no
//     invented prices, no aggregate rating the Hacienda has not earned (the
//     Airbnb figure is Airbnb's, and is attributed as such in `Reviews`).

const BRAND_LOGO = '/images/brand/hdl-logo.jpg'
const BRAND_ALT = 'Hacienda de LuisAna — Munting Mansyon ng Luisiana'

/** `'/'` → `https://haciendadeluisana.com/`, `'/stay'` → `…/stay`. */
export function absoluteUrl(path: string): string {
  if (path === '/' || path === '') return `${SITE_ORIGIN}/`
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`.replace(/\/+$/, '')
}

/** HTML text/attribute escaping. Titles carry `&` and `—`; descriptions carry `’`. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * JSON for embedding inside `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is not safe there: a `</script>` inside any string
 * would close the element early. Escaping `<` is the standard fix and changes
 * nothing a consumer of the JSON sees.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c')
}

/**
 * The `<head>` for one route: title, description, canonical, robots, and the
 * Open Graph / Twitter pairs that make a pasted link look like the Hacienda
 * rather than like a URL.
 *
 * `noindex` pages still get a title and a description — a Guest on `/account`
 * sees them in the tab, and a shared link still previews correctly — but they
 * ask not to be listed.
 */
export function headTags(meta: RouteMeta): string {
  const url = absoluteUrl(meta.path)
  const image = absoluteUrl(BRAND_LOGO)
  const robots = meta.index
    ? 'index, follow, max-image-preview:large, max-snippet:-1'
    : 'noindex, nofollow'
  const lines = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(BUSINESS.name)}" />`,
    `<meta property="og:locale" content="en_PH" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="834" />`,
    `<meta property="og:image:height" content="835" />`,
    `<meta property="og:image:alt" content="${escapeHtml(BRAND_ALT)}" />`,
    '',
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(BRAND_ALT)}" />`,
  ]
  // The homepage's largest paint is the hero photograph. Preloading it here
  // means the browser starts on it while the JS bundle is still parsing,
  // instead of discovering it after React has mounted (`sections/Hero.tsx`).
  if (meta.path === '/') {
    lines.unshift(
      '<link rel="preload" as="image" href="/images/gmaps/img-07.jpg" fetchpriority="high" />',
    )
  }
  return lines.join('\n    ')
}

// -----------------------------------------------------------------------------
// Structured data
// -----------------------------------------------------------------------------

/**
 * The site-wide graph: the business, and the website that describes it.
 *
 * `LodgingBusiness` is a subtype of `Organization`, so this *is* the
 * Organization entity a knowledge panel needs — there is no second node
 * claiming to be the same business under a different type, which is the usual
 * way this markup goes wrong.
 *
 * Everything asserted here is published elsewhere in `src/config/site.ts` or in
 * `index.html`'s static facts; nothing is inferred. `priceRange` is left out on
 * purpose: the Hacienda quotes on request until the Admin publishes a rate, and
 * a made-up range in schema is a made-up claim in a search result.
 */
export function businessJsonLd(): Record<string, unknown> {
  const origin = absoluteUrl('/')
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LodgingBusiness',
        '@id': `${origin}#lodging`,
        name: BUSINESS.name,
        alternateName: BUSINESS.tagline,
        description: BUSINESS.positioning,
        url: origin,
        image: [absoluteUrl(BRAND_LOGO)],
        logo: absoluteUrl(BRAND_LOGO),
        telephone: BUSINESS.contact.phone,
        email: BUSINESS.contact.email,
        address: {
          '@type': 'PostalAddress',
          streetAddress: BUSINESS.address.street,
          addressLocality: BUSINESS.address.city,
          addressRegion: BUSINESS.address.region,
          addressCountry: 'PH',
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: BUSINESS.coordinates.lat,
          longitude: BUSINESS.coordinates.lng,
        },
        hasMap: BUSINESS.contact.googleMaps,
        checkinTime: '14:00',
        checkoutTime: '12:00',
        petsAllowed: BUSINESS.policies.petFriendly,
        smokingAllowed: BUSINESS.policies.smokingAllowed,
        sameAs: [
          BUSINESS.contact.facebook,
          BUSINESS.contact.instagram,
          LISTINGS.airbnb.url,
          LISTINGS.agoda.url,
        ],
        amenityFeature: [
          { '@type': 'LocationFeatureSpecification', name: 'Free Wi-Fi', value: true },
          { '@type': 'LocationFeatureSpecification', name: 'Free Parking', value: true },
          { '@type': 'LocationFeatureSpecification', name: 'Air Conditioning', value: true },
          { '@type': 'LocationFeatureSpecification', name: 'Kitchen', value: true },
          { '@type': 'LocationFeatureSpecification', name: 'Grill / Ihawan', value: true },
          { '@type': 'LocationFeatureSpecification', name: 'Campfire Area', value: true },
        ],
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}#website`,
        url: origin,
        name: BUSINESS.name,
        inLanguage: 'en-PH',
        publisher: { '@id': `${origin}#lodging` },
      },
    ],
  }
}

/**
 * The questions on `/faqs`, as `FAQPage`.
 *
 * The answers are the ones the page renders, character for character — taken
 * from `FAQS` rather than retyped, so a correction cannot land on one and not
 * the other. Google requires the answer to be visible on the page, which is why
 * this is emitted only for the route that shows them.
 */
export function faqJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  }
}

/** Home → page, for every page that is not the homepage. */
export function breadcrumbJsonLd(meta: RouteMeta): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: meta.title.split('|')[0].trim(), item: absoluteUrl(meta.path) },
    ],
  }
}

/**
 * Every JSON-LD block a route should carry, already serialised.
 *
 * The site-wide graph is emitted on every page (a crawler may land anywhere
 * first), plus the route's own schema. A `noindex` route gets nothing but the
 * business graph: there is no reason to describe a private page to a machine
 * that has been asked not to read it.
 */
export function structuredData(meta: RouteMeta): string[] {
  const blocks = [scriptJson(businessJsonLd())]
  if (!meta.index) return blocks
  if (meta.path === '/faqs') blocks.push(scriptJson(faqJsonLd()))
  if (meta.path !== '/') blocks.push(scriptJson(breadcrumbJsonLd(meta)))
  return blocks
}

/** The complete `<head>` payload for a route, ready to drop into the template. */
export function headFor(meta: RouteMeta): string {
  const scripts = structuredData(meta)
    .map((json) => `<script type="application/ld+json">\n${json}\n</script>`)
    .join('\n    ')
  return `${headTags(meta)}\n    ${scripts}`
}

// -----------------------------------------------------------------------------
// Crawler files
// -----------------------------------------------------------------------------

/**
 * `sitemap.xml`.
 *
 * Only indexable routes: the sitemap is a list of pages the Hacienda is asking
 * to have listed, so a noindex page in here would be a contradiction.
 */
export function sitemapXml(lastmod: string, routes: readonly RouteMeta[] = indexableRoutes()): string {
  const urls = routes
    .map((route) =>
      [
        '  <url>',
        `    <loc>${escapeHtml(absoluteUrl(route.path))}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        route.changefreq ? `    <changefreq>${route.changefreq}</changefreq>` : '',
        route.priority !== undefined ? `    <priority>${route.priority.toFixed(1)}</priority>` : '',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * `llms.txt` — the short version of the site, for an assistant asked about a
 * stay in Luisiana, Laguna.
 *
 * The format (a title, a one-line summary, then facts and links) is what an
 * AI crawler reads when it wants to answer a question rather than index a page.
 * Every line is sourced from `src/config/site.ts`: the address, the check-in
 * times, the guest counts, the published house rules and the Hacienda's own
 * listings. No rate is stated — the Admin publishes those and the site reads
 * them live — and no review text is reproduced, only the dated Airbnb summary
 * it already shows with attribution.
 */
export function llmsTxt(routes: readonly RouteMeta[] = indexableRoutes()): string {
  const facts = [
    `- Name: ${BUSINESS.name} (${BUSINESS.tagline})`,
    `- What it is: ${BUSINESS.positioning}`,
    `- Address: ${BUSINESS.address.formatted}`,
    `- Coordinates: ${BUSINESS.coordinates.lat}, ${BUSINESS.coordinates.lng}`,
    `- Phone: ${BUSINESS.contact.phoneDisplay} · Email: ${BUSINESS.contact.email}`,
    `- Check-in ${BUSINESS.policies.checkIn} · check-out ${BUSINESS.policies.checkOut} · a ${BUSINESS.policies.standardStayHours}-hour standard stay`,
    `- Guests: the Main House base rate includes ${BUSINESS.policies.mainHouseIncludedGuests}; the Annex includes ${BUSINESS.policies.annexIncludedGuests}. These are included counts, not absolute caps.`,
    `- Pets: ${BUSINESS.policies.petFriendly ? 'welcome, for a cleaning and sanitising fee' : 'not allowed'}. Smoking: ${BUSINESS.policies.smokingAllowed ? 'allowed' : 'not allowed'}.`,
    `- Free Wi-Fi and free on-site parking.`,
    `- Airbnb: ${AIRBNB_RATING.rating.toFixed(1)} from ${AIRBNB_RATING.reviewCount} reviews${
      AIRBNB_RATING.superhost ? ', Superhost' : ''
    } (checked ${AIRBNB_RATING.checkedOn}).`,
    `- Booking: request the dates on the website, the Hacienda confirms availability and the final quote, then the downpayment screenshot is approved by the Admin. Nothing is confirmed until that approval.`,
    `- Rates are published by the Admin and read live; the website never states a figure it has not been given.`,
    // The channel policy verbatim, minus "below": it points at the layout of the
    // contact page, which is not what an assistant is reading.
    `- ${OFFICIAL_CHANNELS.headline}: ${OFFICIAL_CHANNELS.body.replace(' below', '')}`,
    `- Also listed on ${LISTINGS.airbnb.label} (${LISTINGS.airbnb.url}) and ${LISTINGS.agoda.label} (${LISTINGS.agoda.url}).`,
  ]

  const pages = routes
    .filter((route) => route.path !== '/')
    .map((route) => `- [${route.title.split('|')[0].trim()}](${absoluteUrl(route.path)}): ${route.description}`)

  return [
    `# ${BUSINESS.name}`,
    '',
    `> ${BUSINESS.positioning}`,
    '',
    '## Key facts',
    '',
    ...facts,
    '',
    '## Pages',
    '',
    `- [Home](${absoluteUrl('/')}): ${routes.find((route) => route.path === '/')?.description ?? BUSINESS.positioning}`,
    ...pages,
    '',
    '## Notes',
    '',
    '- The website is a single React app, prerendered to static HTML: every page above is readable without JavaScript.',
    `- Reviews quoted on ${absoluteUrl('/reviews')} are the guests’ own words, attributed to them, and the Airbnb summary is dated rather than presented as permanent.`,
    '- This file lists public pages only. Bookings, messages and account pages are private to one guest and are excluded from every crawler by `robots.txt`.',
    '',
  ].join('\n')
}

/** The robots.txt body. `*` only: a named group would silently drop the Disallow list. */
export function robotsTxt(): string {
  const disallow = ['/account', '/messages', '/booking/status', '/book/pay', '/review', '/guest/auth', '/login', '/admin', '/app']
  return [
    '# Hacienda de LuisAna — public pages are open to every crawler, including',
    '# assistants that summarise rather than index. Signed-in pages are not.',
    'User-agent: *',
    'Allow: /',
    ...disallow.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n')
}
