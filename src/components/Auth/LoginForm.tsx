import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MIN_PASSWORD_LENGTH,
  ROLE_LABELS,
  describeAuthError,
  homeForRole,
  type Role,
} from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'

type Mode = 'login' | 'register' | 'reset'

/**
 * Scoped copy for a page that signs one role in: the form stays the same —
 * Google and email both arrive through the same session — only the heading a
 * person reads changes, so `/guest/auth` and `/admin/auth` do not look like
 * two different systems.
 */
export type AuthIntro = { eyebrow: string; title: string; body: string }

/**
 * Scoped copy for the register mode. The default says Guest because that is
 * all a sign-up can make — except on `/admin/auth`, where the only address
 * worth registering is the owner's, which arrives as the Host (ADR-0005).
 */
export type RegisterIntro = AuthIntro & { submitLabel: string; successMessage: string }

const DEFAULT_REGISTER_INTRO: RegisterIntro = {
  eyebrow: 'Create account',
  title: 'Join Hacienda',
  body: 'Make a Guest account to follow your own Booking, send your ID and keep your dates.',
  submitLabel: 'Create Guest Account',
  successMessage: 'Your Guest account is ready — your Bookings are now tied to it.',
}

/**
 * The one form every role signs in through.
 *
 * Signing up makes a Guest — there is no role to pick, because a role picked in a
 * browser is a role anybody could pick. The Host gives Staff their role from the
 * team panel on `/admin`, and the Host themselves is the address the Firestore
 * rules already allowlist (ADR-0005).
 *
 * Every failure arrives as an AuthError with a message for a person, so this form
 * has no list of provider codes of its own to keep in step.
 */
export function LoginForm({
  onSuccess,
  intro,
  registerIntro = DEFAULT_REGISTER_INTRO,
}: {
  onSuccess?: () => void
  intro?: AuthIntro
  registerIntro?: RegisterIntro
}) {
  const { login, register, loginWithGoogle, resetPassword, signInAsRole, isConfigured, role } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * Registering an address that already has an account is not a failure to
   * fix — it is a login wearing the wrong mode. Offer the one-click switch
   * instead of leaving the person to find the link below.
   */
  const [suggestLogin, setSuggestLogin] = useState(false)

  const copy = {
    login: intro ?? {
      eyebrow: 'Welcome back',
      title: 'Sign in',
      body: 'Guests, Staff and the Host all sign in here — the page you land on follows your role.',
    },
    register: registerIntro,
    reset: {
      eyebrow: 'Reset password',
      title: 'Forgot password?',
      body: 'Enter your email to receive a reset link.',
    },
  }[mode]

  /** A mode switch starts clean: an error from the last mode must not greet the next. */
  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
    setSuggestLogin(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSuggestLogin(false)
    setLoading(true)

    try {
      if (mode === 'login') {
        await login(email, password)
        onSuccess?.()
      } else if (mode === 'register') {
        await register(email, password, displayName || undefined)
        setInfo(registerIntro.successMessage)
        onSuccess?.()
      } else {
        await resetPassword(email)
        setInfo('Password reset email sent! Check your inbox.')
      }
    } catch (err) {
      const described = describeAuthError(err)
      setError(described.message)
      setSuggestLogin(mode === 'register' && described.code === 'auth/email-already-in-use')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    setInfo(null)
    setSuggestLogin(false)
    setLoading(true)
    try {
      await loginWithGoogle()
      onSuccess?.()
    } catch (err) {
      setError(describeAuthError(err).message)
    } finally {
      setLoading(false)
    }
  }

  const handleDemoRole = async (demoRole: Role) => {
    setError(null)
    setInfo(null)
    setSuggestLogin(false)
    setLoading(true)
    try {
      await signInAsRole(demoRole)
      onSuccess?.()
    } catch (err) {
      setError(describeAuthError(err).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8 lg:p-10 w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="eyebrow">{copy.eyebrow}</div>
        <h2 className="font-serif text-3xl mt-2 text-forest-900">{copy.title}</h2>
        <p className="mt-2 text-sm text-forest-700/70">{copy.body}</p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3" role="alert">
          {error}
          {suggestLogin && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="mt-2 block font-semibold underline underline-offset-4 hover:text-red-900"
            >
              Sign in instead — your email stays filled in
            </button>
          )}
        </div>
      )}
      {info && (
        <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm px-4 py-3">
          {info}
        </div>
      )}

      {!isConfigured && (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <div className="text-[11px] uppercase tracking-eyebrow text-amber-800 font-semibold">
            Demo mode — no Firebase configured
          </div>
          <p className="mt-1.5 text-xs text-amber-900/85 leading-relaxed">
            Accounts, roles and Bookings stay in this browser. Step into a role to walk the flows through, or sign up
            normally as a Guest. Copy <code className="font-mono">.env.example</code> to{' '}
            <code className="font-mono">.env.local</code> with real Firebase keys for cloud sign-in.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['host', 'staff', 'guest'] as Role[]).map((demoRole) => (
              <button
                key={demoRole}
                type="button"
                onClick={() => void handleDemoRole(demoRole)}
                disabled={loading || role === demoRole}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition disabled:opacity-60 ${
                  role === demoRole
                    ? 'bg-amber-900 text-amber-50 border-amber-900'
                    : 'bg-white border-amber-300 text-amber-900 hover:bg-amber-100'
                }`}
              >
                {role === demoRole ? `Signed in as ${ROLE_LABELS[demoRole]}` : `Continue as ${ROLE_LABELS[demoRole]}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <label className="block">
            <span className="label">Display Name (optional)</span>
            <input
              className="field"
              placeholder="Juan Dela Cruz"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              maxLength={80}
            />
          </label>
        )}

        <label className="block">
          <span className="label">Email</span>
          <input
            className="field"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>

        {mode !== 'reset' && (
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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && (
              <span className="text-[11px] text-forest-600 mt-1 block">
                At least {MIN_PASSWORD_LENGTH} characters
              </span>
            )}
          </label>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
          {loading
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign In'
              : mode === 'register'
                ? registerIntro.submitLabel
                : 'Send Reset Link'}
        </button>
      </form>

      {isConfigured && mode !== 'reset' && (
        <>
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-forest-900/10" />
            <span className="text-[11px] uppercase tracking-eyebrow text-forest-600">or</span>
            <div className="h-px flex-1 bg-forest-900/10" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full rounded-full border border-forest-900/10 bg-white px-5 py-3 text-sm font-medium text-forest-800 hover:bg-cream-50 flex items-center justify-center gap-2 disabled:opacity-60"
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

      <div className="mt-6 text-center text-xs text-forest-700 space-y-2">
        {mode === 'login' && (
          <>
            <div>
              <button onClick={() => switchMode('reset')} className="underline underline-offset-4 hover:text-forest-900">
                Forgot password?
              </button>
            </div>
            <div>
              Don't have an account?{' '}
              <button onClick={() => switchMode('register')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
                Create one
              </button>
            </div>
          </>
        )}
        {mode === 'register' && (
          <div>
            Already have an account?{' '}
            <button onClick={() => switchMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Sign in
            </button>
          </div>
        )}
        {mode === 'reset' && (
          <div>
            Remember your password?{' '}
            <button onClick={() => switchMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Back to login
            </button>
          </div>
        )}
        <div className="pt-1 text-forest-600">
          <Link to={homeForRole(role)} className="underline underline-offset-4 hover:text-forest-900">
            {role ? `Go to the ${ROLE_LABELS[role]} page` : 'Continue browsing the Hacienda'}
          </Link>
        </div>
      </div>
    </div>
  )
}
