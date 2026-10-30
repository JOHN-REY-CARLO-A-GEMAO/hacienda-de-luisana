import { useEffect, useRef, useState } from 'react'
import { MIN_PASSWORD_LENGTH, describeAuthError } from '../../lib/auth'
import { EMAIL_MAX, validateEmail } from '../../lib/validation'
import { useAuth } from '../../hooks/useAuth'
import { LIMITS, checkRateLimit, resetRateLimit } from '../../lib/rateLimit'
import { Field, Input } from '../ui'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement | string, options: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback': () => void
      }) => number
      remove: (widgetId: number) => void
    }
  }
}

interface LoginFormOnlyProps {
  email: string
  onEmailChange: (email: string) => void
  onSuccess?: () => void
  onError: (error: string | null) => void
  onInfo: (info: string | null) => void
  onSwitchToReset: () => void
  onSwitchToRegister: () => void
}

/**
 * Email/password login form.
 *
 * Handles:
 * - Email and password input
 * - Client-side validation
 * - Rate limiting
 * - Error handling via describeAuthError
 * - Google sign-in button
 * - Cloudflare Turnstile CAPTCHA (when VITE_CLOUDFLARE_TURNSTILE_SITE_KEY is set)
 */
export function LoginFormOnly({
  email,
  onEmailChange,
  onSuccess,
  onError,
  onInfo,
  onSwitchToReset,
  onSwitchToRegister,
}: LoginFormOnlyProps) {
  const { login, loginWithGoogle, isConfigured } = useAuth()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<number | null>(null)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)

  const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY

  // Render the Turnstile widget explicitly when the script and container are ready.
  useEffect(() => {
    if (!siteKey || !turnstileContainerRef.current || !window.turnstile) return
    const id = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
    })
    setTurnstileWidgetId(id)
    return () => {
      if (turnstileWidgetId !== null) {
        window.turnstile.remove(turnstileWidgetId)
      }
    }
  }, [siteKey])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)

    const errs: { email?: string; password?: string } = {}
    const emailRes = validateEmail(email)
    if (!emailRes.ok) errs.email = emailRes.message
    if (!password) {
      errs.password = 'Password is required'
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errs.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      onError('Please correct the highlighted errors before signing in.')
      return
    }

    // Turnstile is enforced only when a site key is configured.
    if (siteKey && !turnstileToken) {
      onError('Please complete the verification before signing in.')
      return
    }

    setLoading(true)

    try {
      const rateLimit = checkRateLimit('login', LIMITS.login)
      if (!rateLimit.ok) {
        onError(rateLimit.message)
        return
      }

      await login(email, password)
      // Successful sign-in is not an attack. Refund the attempt so five
      // genuine sign-ins in a minute (a demo, a reviewer) cannot lock the Guest out.
      resetRateLimit('login')
      onSuccess?.()
    } catch (err) {
      const described = describeAuthError(err)
      onError(described.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    onError(null)
    onInfo(null)
    setLoading(true)
    try {
      await loginWithGoogle()
      onSuccess?.()
    } catch (err) {
      onError(describeAuthError(err).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email" error={fieldErrors.email} required>
          <Input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(event) => {
              onEmailChange(event.target.value)
              if (fieldErrors.email) {
                setFieldErrors((previous) => {
                  const next = { ...previous }
                  delete next.email
                  return next
                })
              }
            }}
            required
            maxLength={EMAIL_MAX}
            autoComplete="email"
            spellCheck={false}
            invalid={Boolean(fieldErrors.email)}
          />
        </Field>

        <div>
          <Field label="Password" error={fieldErrors.password} required>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (fieldErrors.password) {
                  setFieldErrors((previous) => {
                    const next = { ...previous }
                    delete next.password
                    return next
                  })
                }
              }}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={200}
              autoComplete="current-password"
              invalid={Boolean(fieldErrors.password)}
            />
          </Field>
          <div className="mt-1 text-right">
            <button type="button" onClick={onSwitchToReset} className="text-xs text-link text-forest-600 dark:text-cream-100">
              Forgot password?
            </button>
          </div>
        </div>

        {siteKey && (
          <div className="space-y-3">
            <div ref={turnstileContainerRef} className="turnstile-widget" />
            <span className="text-xs text-forest-500 dark:text-sage-400 leading-relaxed">
              Completing the verification helps keep this form free of spam.
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full justify-center"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      {isConfigured && (
        <>
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-forest-900/10 dark:bg-cream-100/20" />
            <span className="text-[11px] uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">or continue with</span>
            <div className="h-px flex-1 bg-forest-900/10 dark:bg-cream-100/20" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="btn-quiet w-full justify-center"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </>
      )}
    </>
  )
}
