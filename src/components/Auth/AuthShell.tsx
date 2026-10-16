import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { homeForRole } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'

type Mode = 'login' | 'register' | 'reset'

export type AuthIntro = { eyebrow: string; title: string; body: string }
export type RegisterIntro = AuthIntro & { submitLabel: string; successMessage: string }

interface AuthShellProps {
  mode: Mode
  intro: AuthIntro
  children: ReactNode
  error: string | null
  info: string | null
  suggestLogin?: boolean
  onSwitchMode: (mode: Mode) => void
  onSwitchToLogin?: () => void
}

/**
 * Shared shell for authentication forms.
 *
 * Provides:
 * - Error/info message display
 * - Demo mode banner
 * - Mode switching links
 *
 * Note: The layout (split screen with photograph) is now in AuthPage.tsx.
 * This component only handles the form container and messaging.
 */
export function AuthShell({
  mode,
  intro,
  children,
  error,
  info,
  suggestLogin = false,
  onSwitchMode,
  onSwitchToLogin,
}: AuthShellProps) {
  const { isConfigured, role } = useAuth()

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6">
        <div className="eyebrow text-forest-600">{intro.eyebrow}</div>
        <h2 className="font-serif text-2xl lg:text-3xl mt-2 text-forest-900">{intro.title}</h2>
        <p className="mt-2 text-xs lg:text-sm text-forest-700/85 leading-relaxed">{intro.body}</p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3" role="alert">
          {error}
          {suggestLogin && onSwitchToLogin && (
            <button
              type="button"
              onClick={onSwitchToLogin}
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
        <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-4">
          <div className="text-[11px] uppercase tracking-eyebrow text-amber-800 font-semibold">
            Demo mode — no Firebase configured
          </div>
          <p className="mt-1.5 text-xs text-amber-900/85 leading-relaxed">
            Accounts and Bookings stay in this browser. Sign up as a Guest to walk the flow through. Copy{' '}
            <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> with real
            Firebase keys for cloud sign-in, or read <Link to="/status" className="underline">deployment status</Link>{' '}
            for why this build has none.
          </p>
        </div>
      )}

      {children}

      <div className="mt-6 text-center text-xs text-forest-700 space-y-2">
        {mode === 'login' && (
          <div>
            Don't have an account?{' '}
            <button onClick={() => onSwitchMode('register')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Create one
            </button>
          </div>
        )}
        {mode === 'register' && (
          <div>
            Already have an account?{' '}
            <button onClick={() => onSwitchMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Sign in
            </button>
          </div>
        )}
        {mode === 'reset' && (
          <div>
            Remember your password?{' '}
            <button onClick={() => onSwitchMode('login')} className="font-semibold underline underline-offset-4 hover:text-forest-900">
              Back to login
            </button>
          </div>
        )}
        <div className="pt-1 text-forest-600">
          <Link to={homeForRole(role)} className="underline underline-offset-4 hover:text-forest-900">
            {role === 'guest' ? 'Go to my bookings' : 'Continue browsing the Hacienda'}
          </Link>
        </div>
      </div>
    </div>
  )
}
