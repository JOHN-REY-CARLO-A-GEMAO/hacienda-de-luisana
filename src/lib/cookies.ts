/** Cookie helpers for the website. Never store secrets or tokens here. */

export type CookieOpts = {
  days?: number
  sameSite?: 'Lax' | 'Strict' | 'None'
  secure?: boolean
}

export function setCookie(name: string, value: string, opts: CookieOpts = {}) {
  if (typeof document === 'undefined') return
  const days = opts.days ?? 30
  const maxAge = Math.floor(days * 86400)
  const sameSite = opts.sameSite ?? 'Lax'
  const secure = opts.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:')
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}`
  if (secure) cookie += '; Secure'
  document.cookie = cookie
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${encodeURIComponent(name)}=`
  const hit = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(prefix))
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null
}

export function clearCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`
}

export const COOKIE = {
  tutorialDone: 'hdl_tutorial_done',
  prefs: 'hdl_ui_prefs',
}
