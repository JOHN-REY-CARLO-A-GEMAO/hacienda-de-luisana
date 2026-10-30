import { useState } from 'react'
import { AuthFormPanel, type AuthIntro, type RegisterIntro } from './AuthShell'
import { LoginFormOnly } from './LoginFormOnly'
import { RegisterForm } from './RegisterForm'
import { ResetPasswordForm } from './ResetPasswordForm'

type Mode = 'login' | 'register' | 'reset'

const DEFAULT_REGISTER_INTRO: RegisterIntro = {
  eyebrow: 'Create account',
  title: 'Make a Guest account',
  body: 'Sign in before booking to keep your future bookings, payment proofs and dates in one place. Earlier bookings are not automatically linked.',
  submitLabel: 'Create Guest Account',
  successMessage: 'Your Guest account is ready. Bookings made while signed in can be linked to your account; earlier bookings are not automatically linked.',
}

/**
 * The Guest's sign-in surface: one panel, three modes.
 *
 * It owns the mode (sign in / create account / reset) and the email shared
 * across them, so switching modes never re-types an address. The heading comes
 * from the current mode — a page that wraps this must not add one of its own.
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
  // Preserved across mode switches so "sign in instead" keeps the address typed.
  const [email, setEmail] = useState('')

  const copy = {
    login: intro ?? {
      eyebrow: 'Welcome back',
      title: 'Sign in as Guest',
      body: 'Follow your own Bookings, send your payment proof and keep your dates.',
    },
    register: registerIntro,
    reset: {
      eyebrow: 'Reset password',
      title: 'Forgot your password?',
      body: 'Enter your email to request a password reset link.',
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
    <AuthFormPanel
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
    </AuthFormPanel>
  )
}

export type { AuthIntro, RegisterIntro } from './AuthShell'
