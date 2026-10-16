import { useState } from 'react'
import { AuthShell, type AuthIntro, type RegisterIntro } from './AuthShell'
import { LoginFormOnly } from './LoginFormOnly'
import { RegisterForm } from './RegisterForm'
import { ResetPasswordForm } from './ResetPasswordForm'

type Mode = 'login' | 'register' | 'reset'

const DEFAULT_REGISTER_INTRO: RegisterIntro = {
  eyebrow: 'Create account',
  title: 'Join Hacienda',
  body: 'Make a Guest account to follow your own Booking, send your ID and keep your dates.',
  submitLabel: 'Create Guest Account',
  successMessage: 'Your Guest account is ready — your Bookings are now tied to it.',
}

/**
 * The Guest's sign-in form container.
 *
 * This component now serves as a thin wrapper that:
 * - Manages mode switching (login/register/reset)
 * - Manages shared state (email) across mode switches
 * - Delegates to focused form components
 * - Preserves the existing API for backward compatibility
 *
 * Signing up makes a Guest — there is no role to pick, because a role picked in a
 * browser is a role anybody could pick. The Admin is the address the Firestore
 * rules already allowlist, and signs into the mobile app, not here (ADR-0005,
 * ADR-0007).
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
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [suggestLogin, setSuggestLogin] = useState(false)
  // Preserve email across mode switches for the one-click login switch feature
  const [email, setEmail] = useState('')

  const copy = {
    login: intro ?? {
      eyebrow: 'Welcome back',
      title: 'Sign in',
      body: 'Sign in to follow your own Booking, send your ID and keep your dates.',
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

  return (
    <AuthShell
      mode={mode}
      intro={copy}
      error={error}
      info={info}
      suggestLogin={suggestLogin}
      onSwitchMode={switchMode}
      onSwitchToLogin={() => switchMode('login')}
    >
      {mode === 'login' && (
        <LoginFormOnly
          intro={copy}
          email={email}
          onEmailChange={setEmail}
          onSuccess={onSuccess}
          onError={setError}
          onInfo={setInfo}
          onSwitchToReset={() => switchMode('reset')}
          onSwitchToRegister={() => switchMode('register')}
        />
      )}
      {mode === 'register' && (
        <RegisterForm
          intro={registerIntro}
          email={email}
          onEmailChange={setEmail}
          onSuccess={onSuccess}
          onError={setError}
          onInfo={setInfo}
          onSuggestLogin={setSuggestLogin}
          onSwitchToLogin={() => switchMode('login')}
        />
      )}
      {mode === 'reset' && (
        <ResetPasswordForm
          intro={copy}
          email={email}
          onEmailChange={setEmail}
          onSuccess={onSuccess}
          onError={setError}
          onInfo={setInfo}
        />
      )}
    </AuthShell>
  )
}

// Re-export types for backward compatibility with existing imports
export type { AuthIntro, RegisterIntro } from './AuthShell'
