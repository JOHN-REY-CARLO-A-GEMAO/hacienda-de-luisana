import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { NOT_FOUND_META, prerenderRoutes, type RouteMeta } from './config/routes'
import { headFor, llmsTxt, robotsTxt, sitemapXml } from './lib/seo'

/**
 * The build-time renderer.
 *
 * This file is never shipped to a browser. `scripts/prerender.mjs` builds it
 * with `vite.ssr.config.ts` and calls it once per public route, then writes the
 * result into the page template. It exists because the website is a
 * single-page app, and a single-page app answers a crawler that does not run
 * JavaScript — which is Google's first pass, Bing, and every AI assistant
 * asked "where can we stay in Luisiana, Laguna?" — with an empty
 * `<div id="root"></div>`.
 *
 * It is a *build* step, not a server: no request is ever rendered at runtime.
 * That is deliberate. The deploy targets are static hosts (GitHub Pages, Vercel,
 * Firebase Hosting), and a prerender pass keeps them static while still
 * serving real HTML, real headings and real links.
 *
 * `AuthProvider` renders in its signed-out state here. That is the correct
 * state for every prerendered route — all of them are public pages — and the
 * browser replaces this markup on boot (`src/main.tsx` mounts a fresh root
 * rather than hydrating), so a signed-in Guest never sees the signed-out
 * navigation for longer than the first paint.
 */
export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={path}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </StaticRouter>
    </StrictMode>,
  )
}

/**
 * Everything the prerender script needs, in one import.
 *
 * The script is plain Node and cannot read TypeScript; handing it the finished
 * strings keeps the route manifest, the schema and the crawler files in the
 * typed half of the codebase where the tests are.
 */
export const prerender = {
  /** Routes to write as static HTML, in manifest order. */
  routes: (): RouteMeta[] => prerenderRoutes(),
  /** The `<head>` payload for one route. */
  head: (meta: RouteMeta): string => headFor(meta),
  /** The page an unknown address should fall back to. */
  notFoundHead: (): string => headFor(NOT_FOUND_META),
  sitemap: (lastmod: string): string => sitemapXml(lastmod),
  llms: (): string => llmsTxt(),
  robots: (): string => robotsTxt(),
}
