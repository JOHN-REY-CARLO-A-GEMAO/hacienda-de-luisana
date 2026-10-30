import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTurnstile, type TurnstileApi } from '../lib/turnstile'

/**
 * - `disabled` — no site key is configured, so no widget is asked for.
 * - `loading`  — the script is on its way, or the widget is being drawn.
 * - `ready`    — the widget is on screen, waiting for the Guest.
 * - `error`    — the script or the challenge failed. The form must stay closed.
 */
export type TurnstileStatus = 'disabled' | 'loading' | 'ready' | 'error'

export interface TurnstileState {
  /** Attach to the element Turnstile should fill. */
  containerRef: React.RefObject<HTMLDivElement>
  /** The verification token, or null until the Guest passes the challenge. */
  token: string | null
  status: TurnstileStatus
  /** Why the widget is unavailable, when `status` is `error`. */
  error: string | null
  /** Load and draw the widget again — for a Guest who just allowed the script. */
  retry: () => void
}

export const TURNSTILE_UNAVAILABLE =
  'The verification could not load. Check your connection or any content blocker, then choose Retry.'

/**
 * One CAPTCHA widget, tied to the component that renders it.
 *
 * The hook owns the lifecycle the two auth forms used to duplicate: wait for
 * the script, render into the container, clear the token when Cloudflare
 * expires it, and remove the widget on unmount. It never invents a token — if
 * Turnstile is not available the status is `error` and the token stays null, so
 * a form that requires verification stays closed.
 */
export function useTurnstile(siteKey: string | undefined): TurnstileState {
  const containerRef = useRef<HTMLDivElement>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<TurnstileStatus>(siteKey ? 'loading' : 'disabled')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  useEffect(() => {
    if (!siteKey) {
      setStatus('disabled')
      setToken(null)
      setError(null)
      return
    }

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let api: TurnstileApi | undefined
    let widgetId: string | undefined

    setStatus('loading')
    setToken(null)
    setError(null)

    loadTurnstile()
      .then((loaded) => {
        if (cancelled) return
        api = loaded

        // Development re-runs an effect on the same container; drop whatever an
        // earlier run drew so the Guest does not see two widgets.
        container.replaceChildren()

        widgetId = loaded.render(container, {
          sitekey: siteKey,
          callback: (value) => {
            if (cancelled) return
            setToken(value)
            setStatus('ready')
          },
          'expired-callback': () => {
            if (!cancelled) setToken(null)
          },
          'timeout-callback': () => {
            if (!cancelled) setToken(null)
          },
          'error-callback': () => {
            if (cancelled) return
            setToken(null)
            setStatus('error')
            setError(TURNSTILE_UNAVAILABLE)
          },
        })

        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setToken(null)
        setStatus('error')
        setError(TURNSTILE_UNAVAILABLE)
      })

    return () => {
      cancelled = true
      if (api && widgetId) {
        try {
          api.remove(widgetId)
        } catch {
          // The widget was already gone with its container — nothing to undo.
        }
      }
    }
  }, [siteKey, attempt])

  return { containerRef, token, status, error, retry }
}
