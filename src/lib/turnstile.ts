/**
 * Cloudflare Turnstile — the one place that knows its API, and how its script
 * arrives.
 *
 * The two auth forms ask a Guest to prove they are a person before they sign in
 * or create an account. Both forms need the same three things: the shape of
 * `window.turnstile`, a way to wait for the script, and a widget they can tear
 * down. This module owns all three so the forms only decide *whether* to ask.
 *
 * The `Window.turnstile` declaration lives here, inside a module, on purpose.
 * It used to live in `src/types/global.d.ts` as `declare global` in a file that
 * was not a module — an augmentation TypeScript refuses to apply (TS2669).
 * `skipLibCheck` hid the refusal itself, so the production build only reported
 * the symptom (`Property 'turnstile' does not exist on type 'Window'`) and
 * stopped. Next to the code that uses it, the declaration is part of every
 * compilation that could ever need it.
 *
 * Site keys are public by design (they ship in the bundle). The matching secret
 * key never appears here and must never appear in any `VITE_*` variable.
 */

/** Options accepted by `turnstile.render()`, limited to what this site uses. */
export interface TurnstileRenderOptions {
  /** Public site key from the Cloudflare dashboard. */
  sitekey: string
  /** Called with the verification token once the Guest passes the challenge. */
  callback?: (token: string) => void
  /** The token is no longer valid and must be obtained again. */
  'expired-callback'?: () => void
  /** The challenge timed out; the Guest must interact again. */
  'timeout-callback'?: () => void
  /** Cloudflare could not issue a challenge (bad key, blocked request, …). */
  'error-callback'?: (errorCode?: string) => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
  appearance?: 'always' | 'execute' | 'interaction-only'
  language?: string
  action?: string
  cData?: string
  retry?: 'auto' | 'never'
  'refresh-expired'?: 'auto' | 'manual' | 'never'
  'response-field'?: boolean
  'response-field-name'?: string
  tabindex?: number
}

/** The subset of the Turnstile API this site calls. */
export interface TurnstileApi {
  /** Draw a widget into `container` and return its id. */
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string
  /** Remove a widget and release its iframe. */
  remove(widgetId: string): void
  /** Ask the current widget for a new token. */
  reset(widgetId?: string): void
  /** Run the challenge (used with `appearance: 'execute'`). */
  execute(widgetId?: string, options?: { action?: string }): void
  /** The current token, or undefined while the challenge is unsolved. */
  getResponse(widgetId?: string): string | undefined
  /** Whether the current token has expired. */
  isExpired(widgetId?: string): boolean
  /** Run `callback` once the API is ready to render. */
  ready(callback: (widgetId?: string) => void): void
}

declare global {
  interface Window {
    /**
     * Present once the Turnstile script in `index.html` has run. Undefined
     * before that — always, in a server render — so every read must check.
     */
    turnstile?: TurnstileApi
  }
}

/** Same URL, and same explicit-render mode, as the tag in `index.html`. */
export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** How long to wait for the script before telling the Guest it did not load. */
export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000

/** The API, if the script has already run in this browser. */
export function getTurnstile(): TurnstileApi | undefined {
  if (typeof window === 'undefined') return undefined
  return window.turnstile
}

function findTurnstileScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="challenges.cloudflare.com/turnstile"]',
  )
}

function injectTurnstileScript(): void {
  const script = document.createElement('script')
  script.src = TURNSTILE_SCRIPT_URL
  script.async = true
  script.defer = true
  script.dataset.hdlTurnstile = '1'
  document.head.appendChild(script)
}

let pendingLoad: Promise<TurnstileApi> | null = null

/**
 * Resolve with the Turnstile API, waiting for its script if it is still on the
 * way.
 *
 * The tag in `index.html` is `defer`, so on a first paint of `/login` the API
 * can legitimately be missing when the form mounts. Waiting — rather than
 * reading `window.turnstile` once and giving up — is what turns "the widget
 * never appeared, so the Guest could never submit" into a CAPTCHA.
 *
 * Rejects if the script does not produce the API within `timeoutMs`. It never
 * resolves to a stub, so a caller cannot mistake "Turnstile is blocked" for
 * "Turnstile says this Guest is fine".
 */
export function loadTurnstile(timeoutMs = TURNSTILE_LOAD_TIMEOUT_MS): Promise<TurnstileApi> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Turnstile can only load in a browser.'))
  }

  const ready = getTurnstile()
  if (ready) return Promise.resolve(ready)
  if (pendingLoad) return pendingLoad

  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    // Reuse the tag `index.html` ships; add one only if a page has lost it.
    if (!findTurnstileScript()) injectTurnstileScript()

    let timer = 0
    let poll = 0

    const settle = (finish: () => void) => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      finish()
    }

    const check = () => {
      const api = getTurnstile()
      if (api) settle(() => resolve(api))
    }

    timer = window.setTimeout(() => {
      // A tag that never produced the API is dead (blocked, offline, missing).
      // Drop it so the form's Retry can fetch a fresh one instead of polling a
      // request the browser has already given up on.
      findTurnstileScript()?.remove()
      settle(() => reject(new Error('The Turnstile script did not load.')))
    }, timeoutMs)

    poll = window.setInterval(check, 200)
    check()
  })

  // Only an in-flight attempt is shared. Once it settles, the next call reads
  // the window again, so a failed load is never replayed at a Guest who has
  // since allowed the script.
  pendingLoad = attempt
  const forget = () => {
    if (pendingLoad === attempt) pendingLoad = null
  }
  attempt.then(forget, forget)
  return attempt
}
