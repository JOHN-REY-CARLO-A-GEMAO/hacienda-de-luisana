import { useState } from 'react'
import { MIN_PASSWORD_LENGTH, describeAuthError } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { LIMITS, checkRateLimit } from '../../lib/rateLimit'
import type { AuthIntro } from './AuthShell'

interface LoginFormOnlyProps {
  intro: AuthIntro
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
 */
export function LoginFormOnly({
  intro,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)
    setLoading(true)

    try {
      const rateLimit = checkRateLimit('login', LIMITS.login)
      if (!rateLimit.ok) {
        onError(rateLimit.message)
        setLoading(false)
        return
      }

      await login(email, password)
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <input
            className="field"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
            spellCheck={false}
          />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <input
            className="field"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={200}
            autoComplete="current-password"
          />
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={onSwitchToReset}
              className="text-xs text-forest-600 hover:text-forest-900 underline underline-offset-2"
            >
              Forgot password?
            </button>
          </div>
        </label>

        <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
          {loading ? 'Please wait…' : 'Sign In'}
        </button>
      </form>

      {isConfigured && (
        <>
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-forest-900/10" />
            <span className="text-[11px] uppercase tracking-eyebrow text-forest-600">or continue with</span>
            <div className="h-px flex-1 bg-forest-900/10" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full rounded-xl border border-forest-800/15 bg-white px-5 py-3 text-sm font-medium text-forest-800 hover:bg-forest-50 hover:border-forest-800/25 flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google
          </button>
        </>
      )}
    </>
  )
}
