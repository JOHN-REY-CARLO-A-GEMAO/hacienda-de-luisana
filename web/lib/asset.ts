/**
 * Prefix public asset paths with Vite's base URL so they work on GitHub Pages
 * project sites (e.g. /hacienda-de-luisana/). Pass absolute public paths like
 * "/images/gmaps/img-01.jpg" — they become "/hacienda-de-luisana/images/..."
 * Locally BASE_URL is "/" so the path is unchanged.
 */
export function asset(path: string): string {
  if (!path) return path
  // Keep external, data, and blob URLs untouched
  if (/^(https?:\/\/|data:|blob:)/.test(path)) return path
  // Only rewrite root-absolute paths (/images/..., /favicon.svg)
  if (!path.startsWith('/')) return path
  const base: string = (import.meta as any).env.BASE_URL ?? '/'
  // base always ends with "/", e.g. "/hacienda-de-luisana/"
  return `${base}${path.slice(1)}`
}
