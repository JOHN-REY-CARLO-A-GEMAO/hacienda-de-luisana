// Is this link the page I am reading, or merely its section?
//
// The bar and the footer both need the answer, and they must agree: the two
// used to disagree (the bar marked "Stay" on /rates, the footer marked nothing
// anywhere), so the rule lives here rather than in either component.
//
// `aria-current` has a token for each claim, and they are not interchangeable:
// "page" is the page itself, "true" is "current item in a set" — a section
// link that holds the page without being it. Marking /rates' "Stay" link as
// "page" told a screen reader the reader was on /stay, which they were not.

export type NavLink = { href: string; label: string; also?: readonly string[] }

/** 'page' for the page being read, 'section' for a link that holds it. */
export type CurrentState = 'page' | 'section' | null

/** Strip a trailing slash; the two spellings are one page. */
function normalise(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
}

/**
 * How `link` should be marked on `pathname`.
 *
 * Matching is by whole path segments, never by substring, and the homepage
 * matches only itself — a loose `startsWith('/')` would mark Home everywhere.
 */
export function currentStateFor(link: NavLink, pathname: string): CurrentState {
  const path = normalise(pathname)
  const at = (base: string) => path === base
  const under = (base: string) => base !== '/' && path.startsWith(`${base}/`)

  if (at(link.href)) return 'page'
  // A detail page this link stands for: same section, different address.
  if ((link.also ?? []).some((base) => at(base) || under(base))) return 'section'
  // A page nested under the link's own route.
  if (under(link.href)) return 'section'
  return null
}

/** True when `pathname` sits in the section `link` stands for. */
export function isCurrentSection(link: NavLink, pathname: string): boolean {
  return currentStateFor(link, pathname) !== null
}

/** The `aria-current` token for a state, or undefined when the link is neither. */
export function ariaCurrent(state: CurrentState): 'page' | 'true' | undefined {
  if (state === 'page') return 'page'
  if (state === 'section') return 'true'
  return undefined
}
