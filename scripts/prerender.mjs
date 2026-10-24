#!/usr/bin/env node
// -----------------------------------------------------------------------------
// PRERENDER — turn the built single-page app into twenty real documents
// -----------------------------------------------------------------------------
//
// Run after `vite build` and after `vite build -c vite.ssr.config.ts` (the
// `build` script in package.json does all three in order).
//
// What it does, for each route in `src/config/routes.ts` marked `prerender`:
//
//   1. renders the app to HTML with the same components the browser mounts;
//   2. replaces the `<!-- seo:start --> … <!-- seo:end -->` block in
//      `dist/index.html` with that route's title, description, canonical,
//      Open Graph tags and JSON-LD;
//   3. writes `dist/<path>.html` with the markup inside `#root`.
//
// It also writes `404.html` (the empty shell every static host falls back to),
// `sitemap.xml`, `llms.txt` and `robots.txt`.
//
// Flat `.html` files rather than `<path>/index.html` on purpose: the deploy
// targets disagree about directory indexes (GitHub Pages redirects `/stay` to
// `/stay/`, which would make the canonical URL a redirect), and every one of
// them serves `/stay.html` at `/stay` with no redirect at all.
//
// The script fails the build if a page comes out without an `<h1>`, without
// real prose, or with an un-replaced placeholder. A prerender that silently
// produces an empty page is worse than no prerender: the site would still look
// fine in a browser and be invisible to everything else.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const TEMPLATE = path.join(DIST, 'index.html')
const SSR_ENTRY = path.join(ROOT, 'dist-ssr', 'entry-server.js')

const SEO_OPEN = '<!-- seo:start -->'
const SEO_CLOSE = '<!-- seo:end -->'
const ROOT_MARK = '<div id="root"></div>'

/** Words of prose a prerendered page must contain, as a broken-render guard. */
const MIN_WORDS = 120

function fail(message) {
  console.error(`\n[prerender] ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

function wordsIn(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length
}

if (!existsSync(TEMPLATE)) fail('dist/index.html is missing — run `vite build` first')
if (!existsSync(SSR_ENTRY)) fail('dist-ssr/entry-server.js is missing — run `vite build -c vite.ssr.config.ts` first')

const template = readFileSync(TEMPLATE, 'utf8')
if (!template.includes(SEO_OPEN) || !template.includes(SEO_CLOSE)) {
  fail('index.html has lost its <!-- seo:start --> / <!-- seo:end --> markers')
}
if (!template.includes(ROOT_MARK)) {
  fail('index.html has no empty <div id="root"></div> to render into')
}

const { render, prerender } = await import(pathToFileURL(SSR_ENTRY).href)
const routes = prerender.routes()

/**
 * The template with a route's `<head>` in it, before any body is rendered.
 *
 * Both markers are removed from the output: they are instructions to this
 * script, and shipping them would invite a second, later pass to rewrite a page
 * that is already finished.
 */
function withHead(head) {
  const open = template.indexOf(SEO_OPEN)
  const close = template.indexOf(SEO_CLOSE)
  return `${template.slice(0, open)}    ${head}\n${template.slice(close + SEO_CLOSE.length)}`
}

function writePage(relativePath, html) {
  const target = path.join(DIST, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, html)
  return statSync(target).size
}

const written = []

for (const route of routes) {
  const slug = route.path === '/' ? 'index.html' : `${route.path.replace(/^\//, '')}.html`
  const body = render(route.path)

  if (!/<h1[\s>]/i.test(body)) fail(`${route.path} rendered without an <h1>`)
  const words = wordsIn(body)
  if (words < MIN_WORDS) fail(`${route.path} rendered only ${words} words — the render is broken`)

  const html = withHead(prerender.head(route)).replace(ROOT_MARK, `<div id="root">${body}</div>`)
  if (/<!--\s*seo:(start|end)\s*-->/i.test(html)) fail(`${route.path} kept a seo marker`)

  written.push({ path: route.path, file: slug, words, bytes: writePage(slug, html) })
}

// Every static host falls back to 404.html for an address it has no file for —
// a signed-in page such as /account, a booking status link, or a genuinely
// missing page. It keeps an *empty* root rather than prerendered "not found"
// markup: the app decides what the address means, and a Guest following a deep
// link should not be shown a 404 for a moment before their booking appears.
writePage(
  '404.html',
  withHead(
    `${prerender.notFoundHead()}`,
  ).replace(ROOT_MARK, ROOT_MARK),
)

const lastmod = new Date().toISOString().slice(0, 10)
writePage('sitemap.xml', prerender.sitemap(lastmod))
writePage('llms.txt', prerender.llms())
writePage('robots.txt', prerender.robots())

const totalBytes = written.reduce((sum, page) => sum + page.bytes, 0)
console.log(`\n[prerender] ${written.length} pages, ${(totalBytes / 1024).toFixed(0)} kB of HTML total:`)
for (const page of written) {
  console.log(`  ${page.path.padEnd(16)} ${String(page.words).padStart(4)} words  ${String(Math.round(page.bytes / 1024)).padStart(4)} kB  → dist/${page.file}`)
}
console.log('[prerender] wrote 404.html, sitemap.xml, llms.txt, robots.txt')
