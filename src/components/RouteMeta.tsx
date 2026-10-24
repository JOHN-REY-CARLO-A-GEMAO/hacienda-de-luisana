import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { routeMetaFor } from '../config/routes'
import { absoluteUrl, structuredData } from '../lib/seo'

/**
 * Keeps `<head>` honest while the Guest moves around the app.
 *
 * The built pages carry their own title, description, canonical, Open Graph
 * tags and JSON-LD (written into the HTML by `scripts/prerender.mjs`). But a
 * client-side navigation does not load a document, so without this the tab, the
 * history entry and every link the Guest copies would still say "homepage".
 *
 * The tags are not re-declared here: `headTags()` in `src/lib/seo.ts` builds the
 * same markup the prerender writes, so there is one definition of what `/rates`
 * is called. This component only applies it.
 *
 * The structured data is replaced too — imperatively, with `textContent`, so
 * markup from a config string is never parsed as HTML.
 */
export function RouteMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = routeMetaFor(pathname)
    document.title = meta.title

    for (const [attr, name, content] of [
      ['name', 'description', meta.description],
      ['name', 'robots', meta.index ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow'],
      ['property', 'og:url', absoluteUrl(meta.path)],
      ['property', 'og:title', meta.title],
      ['property', 'og:description', meta.description],
      ['name', 'twitter:title', meta.title],
      ['name', 'twitter:description', meta.description],
    ] as const) {
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attr, name)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = absoluteUrl(meta.path)

    // One script node, rewritten in place: adding a new one per navigation
    // would leave the previous route's schema in the document.
    let schema = document.getElementById('route-structured-data') as HTMLScriptElement | null
    if (!schema) {
      schema = document.createElement('script')
      schema.type = 'application/ld+json'
      schema.id = 'route-structured-data'
      document.head.appendChild(schema)
    }
    schema.textContent = structuredData(meta).join('\n')
  }, [pathname])

  return null
}
