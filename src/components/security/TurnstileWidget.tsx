/**
 * Cloudflare Turnstile, when — and only when — a site key is configured.
 * Hacienda de LuisAna
 * ----------------------------------------------------------------------------
 * This is the *visible* half of the bot mitigation. The half that matters is
 * `functions/src/security/bot.ts`: the token rendered here is verified against
 * Cloudflare by the endpoint before a document is written, because a widget on
 * the page proves nothing — a script can skip the widget and POST whatever it
 * likes.
 *
 * Three deliberate properties:
 *
 *   • **No site key, no widget, no request.** `VITE_TURNSTILE_SITE_KEY` is unset
 *     on most builds, and the form must not slow down or break because a third
 *     party was never configured. The endpoint then runs on the honeypot and the
 *     rate limit alone, which is a smaller but honest defence.
 *   • **A failed script is not a failed form.** If Cloudflare cannot be reached,
 *     the widget says so in one line and the submit stays enabled; the endpoint
 *     decides, and its own answer is what the Guest sees.
 *   • **Tokens are single-use.** After a successful send the widget is reset, so
 *     a second inquiry gets a fresh token instead of a replay the server refuses.
 */
import { useEffect, useRef, useState } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_ID = 'cloudflare-turnstile'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/**
 * The key this build was given, read at call time rather than at import.
 *
 * A module-level constant would freeze the answer when the bundle is first
 * evaluated, which makes "is the widget configured?" untestable and turns a
 * stubbed environment in the suite into a lie. Empty means Turnstile is simply
 * not in use on this build.
 */
export function turnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
}

export function isTurnstileConfigured(): boolean {
  return turnstileSiteKey() !== ''
}

/**
 * Load Cloudflare's script once per page.
 *
 * A module-level promise, not a state flag: two widgets mounting at once must
 * share one script tag, and a rejected load must not be cached as a success.
 */
let loader: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loader) return loader

  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('turnstile-not-available'))
    }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', finish, { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile-script-error')), { once: true })
      // The tag may have loaded before this effect ran.
      if (window.turnstile) finish()
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error('turnstile-script-error')), { once: true })
    document.head.appendChild(script)
  }).catch((error) => {
    loader = null
    throw error
  })

  return loader
}

export function TurnstileWidget({
  onToken,
  resetSignal = 0,
  action = 'contact',
}: {
  /** The token, or '' when the challenge expired, failed, or has been reset. */
  onToken: (token: string) => void
  /** Increment to clear the widget and demand a new token. */
  resetSignal?: number
  action?: string
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isTurnstileConfigured()) return
    let cancelled = false

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        widgetId.current = turnstile.render(container.current, {
          sitekey: turnstileSiteKey(),
          action,
          theme: 'light',
          language: 'en',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current)
        } catch {
          // The widget is already gone; nothing to clean up.
        }
      }
      widgetId.current = null
    }
    // `onToken` is intentionally not a dependency: callers pass an inline
    // function, and re-rendering the widget on every keystroke of the form would
    // throw away a solved challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  useEffect(() => {
    if (resetSignal === 0) return
    onToken('')
    if (widgetId.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetId.current)
      } catch {
        // A widget that has not rendered yet has nothing to reset.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  if (!isTurnstileConfigured()) return null

  return (
    <div className="space-y-1.5">
      <div ref={container} data-testid="turnstile-widget" />
      {failed && (
        <p className="text-xs leading-relaxed text-amber-800" role="status">
          The bot check could not load, so this form cannot send yet. Check your connection and{' '}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            reload the page
          </button>
          .
        </p>
      )}
    </div>
  )
}
