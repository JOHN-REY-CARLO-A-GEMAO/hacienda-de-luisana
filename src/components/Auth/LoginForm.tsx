import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type Mode = 'login' | 'register' | 'reset'

export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const { login, register, loginWithGoogle, resetPassword, isConfigured } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // If Firebase not configured, show setup instructions
  if (!isConfigured) {
    return (
      <div className="bg-white rounded-[28px] border border-amber-200 shadow-card p-8 sm:p-10">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">⚙️</div>
        <h2 className="font-serif text-2xl text-forest-900">Firebase Setup Required</h2>
        <p className="mt-3 text-sm text-forest-800/80 leading-relaxed">
          Firebase is not configured. Authentication and cloud bookings are disabled and the app is using local fallback.
        </p>
        <div className="mt-6 rounded-2xl bg-cream-100 p-4 text-xs font-mono leading-relaxed text-forest-800">
          <div className="font-semibold mb-2 font-sans text-[11px] uppercase tracking-eyebrow">Steps to enable:</div>
          <ol className="list-decimal list-inside space-y-1">
            <li>Copy <code>.env.example</code> → <code>.env.local</code></li>
            <li>Fill in your Firebase project keys from console.firebase.google.com</li>
            <li>Restart dev server</li>
          </ol>
          <div className="mt-3 text-[11px] text-forest-600">
            See README or PR description for full guide.
          </div>
        </div>
        <div className="mt-6 rounded-xl bg-forest-50 border border-forest-100 p-3 text-xs text-forest-700">
          You can still browse the site and test bookings — they will be stored locally in this browser.
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)

    try {
      if (mode === 'login') {
        await login(email, password)
        onSuccess?.()
      } else if (mode === 'register') {
        if (password.length < 6) throw new Error('Password must be at least 6 characters')
        await register(email, password, displayName || undefined)
        onSuccess?.()
      } else if (mode === 'reset') {
        await resetPassword(email)
        setInfo('Password reset email sent! Check your inbox.')
      }
    } catch (err: any) {
      // Map Firebase errors to friendly messages
      const code = err?.code || ''
      if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
        setError('Invalid email or password. Please try again.')
      } else if (code.includes('auth/user-not-found')) {
        setError('No account found with this email.')
      } else if (code.includes('auth/email-already-in-use')) {
        setError('An account with this email already exists. Try logging in.')
      } else if (code.includes('auth/invalid-email')) {
        setError('Please enter a valid email address.')
      } else if (code.includes('auth/too-many-requests')) {
        setError('Too many attempts. Please try again later.')
      } else if (code.includes('auth/popup-closed-by-user')) {
        setError('Google sign-in was cancelled.')
      } else {
        setError(err?.message || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      await loginWithGoogle()
      onSuccess?.()
    } catch (err: any) {
      const code = err?.code || ''
      if (code.includes('popup-closed')) setError('Google sign-in was cancelled.')
      else setError(err?.message || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8 lg:p-10 w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="eyebrow">
          {mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create account' : 'Reset password'}
        </div>
        <h2 className="font-serif text-3xl mt-2 text-forest-900">
          {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Join Hacienda' : 'Forgot password?'}
        </h2>
        <p className="mt-2 text-sm text-forest-700/70">
          {mode === 'login'
            ? 'Access your owner dashboard and bookings.'
            : mode === 'register'
            ? 'Create an owner account to manage bookings.'
            : 'Enter your email to receive a reset link.'}
        </p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm px-4 py-3">
          {info}
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
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && (
              <span className="text-[11px] text-forest-600 mt-1 block">At least 6 characters</span>
            )}
          </label>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full justify-center disabled:opacity-60"
        >
          {loading
            ? 'Please wait…'
            : mode === 'login'
            ? 'Sign In'
            : mode === 'register'
            ? 'Create Account'
            : 'Send Reset Link'}
        </button>
      </form>

      {mode !== 'reset' && (
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
              <button onClick={() => setMode('reset')} className="underline underline-offset-4 hover:text-forest-900">
                Forgot password?
              </button>
            </div>
            <div>
              Don't have an account?{' '}
              <button onClick={() => setMode('register')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
                Create one
              </button>
            </div>
          </>
        )}
        {mode === 'register' && (
          <div>
            Already have an account?{' '}
            <button onClick={() => setMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Sign in
            </button>
          </div>
        )}
        {mode === 'reset' && (
          <div>
            Remember your password?{' '}
            <button onClick={() => setMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Back to login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
