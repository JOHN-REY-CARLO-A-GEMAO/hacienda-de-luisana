import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { homeForRole } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from '../Logo'
import { Alert, Field, Input } from '../ui'

type Mode = 'login' | 'register' | 'reset'

export type AuthIntro = { eyebrow: string; title: string; body: string }
export type RegisterIntro = AuthIntro & { submitLabel: string; successMessage: string }

/**
 * The frame the Guest sign-in page wears: the Hacienda's photograph on one
 * side, one column of controls on the other.
 *
 * The heading lives *inside* the form panel (`AuthFormPanel`), because it
 * changes with the mode — sign in, create account, reset password. The layout
 * deliberately has no heading of its own: it used to add a second ("Sign in as
 * Guest") above the form's own ("Welcome back / Sign in"), so the page said the
 * same thing three times before the first field.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream-50 pt-20 lg:pt-0">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        {/* Photograph. Decorative on the desktop split; the heading below is what
            carries the page for a screen reader. */}
        <div className="relative lg:sticky lg:top-0 lg:h-screen lg:w-[52%]">
          <div className="relative h-40 overflow-hidden lg:h-full">
            <img
              src="/images/gmaps/img-01.jpg"
              alt=""
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-forest-950/80 via-forest-950/20 to-forest-950/10" />
            <div className="absolute inset-x-0 bottom-0 hidden p-10 text-cream-50 lg:block">
              <div className="eyebrow text-cream-100/70">Luisiana · Laguna</div>
              <p className="mt-3 max-w-sm font-serif text-3xl leading-tight">
                A private countryside stay, booked directly with the Hacienda.
              </p>
              <p className="mt-4 max-w-sm text-xs leading-relaxed text-cream-100/70">
                Official channels only. The Hacienda never asks for a password, a PIN or a one-time
                code.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col bg-cream-50 px-6 pb-12 pt-8 lg:px-14 lg:pb-16 lg:pt-10">
          <Link to="/" aria-label="Hacienda de LuisAna — home">
            <Logo tone="dark" />
          </Link>
          <div className="flex flex-1 items-center py-10">
            <div className="w-full max-w-md">{children}</div>
          </div>
          <p className="text-xs leading-relaxed text-forest-700/70">
            Running the hacienda? The Admin signs in on the Hacienda de LuisAna Admin mobile app, not on
            this website.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * The form column: one heading, the messages that belong to the current mode,
 * the fields, and the mode-switching links.
 *
 * It is a panel rather than a page so the same component works on `/guest/auth`
 * and inside the gate in front of `/account` — one sign-in surface, not two.
 */
export function AuthFormPanel({
  mode,
  intro,
  children,
  error,
  info,
  suggestLogin = false,
  onSwitchMode,
  onSwitchToLogin,
}: {
  mode: Mode
  intro: AuthIntro
  children: ReactNode
  error: string | null
  info: string | null
  suggestLogin?: boolean
  onSwitchMode: (mode: Mode) => void
  onSwitchToLogin?: () => void
}) {
  const { isConfigured, role } = useAuth()

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="eyebrow">{intro.eyebrow}</div>
        <h1 className="h2 mt-2">{intro.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-forest-700/85">{intro.body}</p>
      </div>

      {error && (
        <Alert
          tone="danger"
          className="mb-5"
          actions={
            suggestLogin && onSwitchToLogin ? (
              <button type="button" onClick={onSwitchToLogin} className="text-xs font-semibold underline underline-offset-4">
                Sign in instead — your email stays filled in
              </button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}
      {info && (
        <Alert tone="success" className="mb-5">
          {info}
        </Alert>
      )}

      {!isConfigured && (
        <Alert tone="warning" title="Demo mode — no Firebase configured" className="mb-6">
          <p className="text-xs leading-relaxed">
            Accounts and Bookings stay in this browser. Sign up as a Guest to walk the flow through. Copy{' '}
            <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> with real
            Firebase keys for cloud sign-in, or read{' '}
            <Link to="/status" className="text-link">
              deployment status
            </Link>{' '}
            for why this build has none.
          </p>
        </Alert>
      )}

      {children}

      <div className="mt-6 space-y-2 text-center text-xs text-forest-700">
        {mode === 'login' && (
          <div>
            Don&rsquo;t have an account?{' '}
            <button onClick={() => onSwitchMode('register')} className="font-semibold text-link">
              Create one
            </button>
          </div>
        )}
        {mode === 'register' && (
          <div>
            Already have an account?{' '}
            <button onClick={() => onSwitchMode('login')} className="font-semibold text-link">
              Sign in
            </button>
          </div>
        )}
        {mode === 'reset' && (
          <div>
            Remember your password?{' '}
            <button onClick={() => onSwitchMode('login')} className="font-semibold text-link">
              Back to sign in
            </button>
          </div>
        )}
        <div>
          <Link to={homeForRole(role)} className="text-link text-forest-600">
            {role === 'guest' ? 'Go to my bookings' : 'Continue browsing the Hacienda'}
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Email + password field pair used by more than one auth mode. */
export function AuthEmailField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Field label="Email" error={error}>
      <Input
        type="email"
        placeholder="you@email.com"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        autoComplete="email"
        spellCheck={false}
        invalid={Boolean(error)}
      />
    </Field>
  )
}
