# SEO and machine readability

**Scope:** the Guest website (`src/`), the build (`scripts/prerender.mjs`) and what
the deploy serves. The Admin app (`lib/`) is not a web surface and is not indexed.

The site is a React single-page app. An SPA answers a question it has never been
asked — "what is on this page?" — with an empty `<div id="root">`. Google's first
pass, Bing, and every AI assistant that quotes a source read exactly that, because
they do not run the JavaScript that would fill the div. The website therefore
looked, to everything except a human with a browser, like a page with no heading
and no words.

It never *was* that. `/` renders 855 words and one `<h1>`; `/rates` 566; `/faqs`
577. The problem was delivery, not content.

---

## What the build does now

`npm run build` runs three steps:

| Step | Command | Writes |
| --- | --- | --- |
| 1. Browser bundle | `npm run build:client` (`tsc -b && vite build`) | `dist/` — the app, `assets/`, the template `index.html` |
| 2. SSR bundle | `npm run build:server` (`vite build -c vite.ssr.config.ts`) | `dist-ssr/entry-server.js` (never deployed) |
| 3. Prerender | `npm run build:prerender` (`node scripts/prerender.mjs`) | `dist/*.html`, `dist/404.html`, `dist/sitemap.xml`, `dist/llms.txt`, `dist/robots.txt` |

The prerender renders each public route with the real components
(`src/entry-server.tsx` mounts `App` in a `StaticRouter`), writes that markup
inside `#root`, and replaces the `<!-- seo:start --> … <!-- seo:end -->` block in
the template with that route's `<head>`.

Nothing is rendered at request time. The deploy targets stay static: GitHub
Pages, Vercel and Firebase Hosting all serve files.

### Why flat `.html` files

Each route is written to `dist/<path>.html` — `dist/stay.html`, not
`dist/stay/index.html`. GitHub Pages redirects `/stay` to `/stay/` when it finds
a directory index, which would make the canonical URL a redirect. A flat file is
served at `/stay` with no redirect on GitHub Pages, Vercel (`cleanUrls`),
Firebase Hosting (`cleanUrls`) and Netlify alike.

Addresses with no file (`/account`, `/booking/status`, a genuinely missing page)
fall through to `404.html`, which is the *empty* app shell: the router decides
what the address means. It is deliberately not prerendered "not found" markup,
because a Guest following a deep link should not be shown a 404 for a moment
before their own booking appears.

That file — not `index.html` — is what every host is configured to fall back to
(`vercel.json`, `firebase.json`, and GitHub Pages' own `404.html` convention).
Falling back to `index.html` would answer every unknown address with a copy of
the prerendered homepage: infinite duplicate content, and a flash of the hero
before the router catches up. `404.html` carries `noindex`, so a soft 404 stays
out of an index instead of competing with `/`.

### The `createRoot` question

`src/main.tsx` mounts with `createRoot`, not `hydrateRoot`. React clears the
container's existing children on the first client render, so the prerendered
markup is replaced rather than duplicated. This is what makes the prerender
safe without a hydration pass: the signed-in navigation, the tutorial state and
the current year cannot mismatch, because nothing is being hydrated against
them.

---

## Where a page's metadata lives

One file: [`src/config/routes.ts`](../src/config/routes.ts). Each row is a path,
a title, a description, and two booleans:

- **`index`** — may a search engine list this page? False for the deployment
  report (`/status`) and for every signed-in page.
- **`prerender`** — is this route rendered to static HTML? True for every page a
  visitor can read without signing in.

Three consumers read it and nothing re-declares a title:

| Consumer | Uses it for |
| --- | --- |
| [`src/lib/seo.ts`](../src/lib/seo.ts) | the `<head>`: title, description, canonical, robots, Open Graph, Twitter, JSON-LD, sitemap, `llms.txt`, `robots.txt` |
| [`src/components/RouteMeta.tsx`](../src/components/RouteMeta.tsx) | applying the same tags in the browser when a Guest navigates without a page load |
| `scripts/prerender.mjs` | which routes to write, and the head for each |

### Adding a page

1. Add the route to `src/App.tsx`.
2. Add a row to `ROUTE_META`. Public page → `index: true, prerender: true`.
   Signed-in page → `index: false, prerender: false`.
3. Run `npm run build`. The console lists every page written, its word count and
   its size; `test/web/seo.test.ts` fails if the manifest and the router drift
   apart, if a description is the wrong length, or if two pages share a title.

---

## Crawler files

| File | Contents |
| --- | --- |
| `/robots.txt` | one `User-agent: *` group — public pages allowed, signed-in pages disallowed — and the sitemap URL. A named group would *replace* the Disallow list for that bot rather than add to it, which is why there is only one. |
| `/sitemap.xml` | the indexable routes only, with `lastmod` set to the build date. |
| `/llms.txt` | the short version for an assistant: address, coordinates, check-in and check-out, included guest counts, pets, Wi-Fi and parking, the dated Airbnb summary, how a booking is confirmed, the official channels, and a link to every public page with its description. |

`llms.txt` is generated from `src/config/site.ts` — the same facts the page
renders — so it cannot drift into advertising something the Hacienda does not
say. It states no rate: the Admin publishes those and the site reads them live.

---

## Structured data

`businessJsonLd()` emits one `@graph` with:

- **`LodgingBusiness`** — the business itself, with `@id`, address, geo,
  telephone, email, check-in/check-out, pets, amenities and `sameAs` to the
  Facebook page, Instagram, Airbnb and Agoda. `LodgingBusiness` is a subtype of
  `Organization`, so this *is* the Organization entity an assistant or knowledge
  panel needs; there is no second node claiming to be the same business.
- **`WebSite`** — with `publisher` pointing at the business node.

Route-level additions, only where true:

- **`FAQPage`** on `/faqs`, from `FAQS` character for character (Google requires
  the answer to be visible on the page).
- **`BreadcrumbList`** on every page below the homepage.

Deliberately absent: `priceRange` (the Hacienda quotes on request until the Admin
publishes a rate) and `aggregateRating` (the 5.0 is Airbnb's, not the Hacienda's
own rating system).

---

## Honest limits

- **There is still no blog, no founder story and no case study.** Adding one is a
  content decision for the owner, not something a build step can invent. What the
  site has — the stay, the rates, the FAQ, the house rules, the getting-here
  routes and the reviews — is now readable by machines, quotable, and linked.
- **`lastmod` is the build date.** It is accurate for the deploy that wrote the
  file and no more precise than that.
- **The prerender is only as good as the manifest.** A new route with no row gets
  the not-found head (noindex) rather than inheriting a neighbour's title. The
  test suite pins the two lists to each other, so this shows up as a failing
  test, not as a silent regression.

## Verifying a build

```bash
npm run build
grep -c '<h1' dist/stay.html                 # 1
grep -o '<title>[^<]*' dist/stay.html        # the /stay title, not the homepage's
grep -o 'rel="canonical" href="[^"]*"' dist/stay.html
grep -c '<loc>' dist/sitemap.xml             # 13
head -5 dist/llms.txt
```

To check what a crawler that does not run JavaScript actually receives:

```bash
node -e "const h=require('fs').readFileSync('dist/index.html','utf8');
console.log(h.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').split(' ').length + ' words')"
```
