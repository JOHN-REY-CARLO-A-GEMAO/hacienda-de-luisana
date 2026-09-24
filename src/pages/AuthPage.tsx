import { Link, Navigate } from 'react-router-dom'
import { BOOTSTRAP_ROLES, ROLE_LABELS } from '../lib/auth'
import { useAuth } from '../hooks/useAuth'
import { LoginForm, type AuthIntro, type RegisterIntro } from '../components/Auth/LoginForm'
import { TurnedAway } from '../components/Auth/ProtectedRoute'

/**
 * The scoped sign-in pages: `/guest/auth` for Guests only, `/admin/auth` for
 * the Host only.
 *
 * Both are public — a person with no session must be able to open them — and
 * both use the one `LoginForm`, so email and Google arrive through the same
 * session either way. Google's button appears whenever Firebase is configured;
 * with no keys the page runs in demo mode like every other sign-in surface.
 *
 * Once somebody is signed in there is nothing left to do here: a Guest is sent
 * straight to `/book`, the Host to `/admin`. Anybody on the wrong page — Staff
 * or Host on the Guest page, anybody but the Host on the Host page — is turned
 * away with the same 403 every other page gives, rather than a form whose
 * every write Firestore would refuse.
 */
function AuthShell({ intro, children }: { intro: AuthIntro; children: React.ReactNode }) {
  return (
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex flex-col items-center">
      <div className="w-full max-w-md px-5">
        <div className="text-center mb-6">
          <div className="eyebrow">{intro.eyebrow}</div>
          <h1 className="font-serif text-3xl mt-2 text-forest-900">{intro.title}</h1>
          <p className="mt-2 text-sm text-forest-700/70">{intro.body}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

function AuthLoading() {
  return (
    <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-10 h-10 border-2 border-forest-200 border-t-forest-700 rounded-full animate-spin" />
        <p className="mt-4 text-sm text-forest-700/70">Checking authentication…</p>
      </div>
    </div>
  )
}
const GUEST_INTRO: AuthIntro = {
  eyebrow: 'Guest sign-in',
  title: 'Sign in as Guest',
  body: 'Follow your own Bookings, send your ID and keep your dates. New here? A sign-up makes a Guest account.',
}

const ADMIN_INTRO: AuthIntro = {
  eyebrow: 'Host sign-in',
  title: 'Sign in as Host',
  body: 'This page is for the Host — reviewing Bookings, reading IDs and verifying payments. Guests sign in on the Guest page.',
}

/**
 * Registering on the Host page: the only address worth typing here is the
 * owner's, which carries the Host role the moment it is created (ADR-0005).
 * Any other address still becomes a Guest — and meets the 403 below.
 */
function adminRegisterIntro(): RegisterIntro {
  const hostEmail = BOOTSTRAP_ROLES.find((entry) => entry.role === 'host')?.email
  return {
    eyebrow: 'First time here',
    title: 'Create the Host account',
    body: hostEmail
      ? `Register ${hostEmail} below — that address carries the Host role automatically. Any other address becomes a Guest.`
      : 'Register the owner address below — it carries the Host role automatically. Any other address becomes a Guest.',
    submitLabel: 'Create Host Account',
    successMessage: 'Host account ready — welcome to the Hacienda.',
  }
}

export function GuestAuthPage() {
  const { user, role, loading } = useAuth()

  if (loading) {
    return <AuthLoading />
  }

  if (user && role === 'guest') {
    return <Navigate to="/book" replace />
  }

  if (user) {
    return <TurnedAway path="/guest/auth" allowed={['guest']} />
  }

  return (
    <AuthShell intro={GUEST_INTRO}>
      <LoginForm
        intro={{
          eyebrow: 'Welcome back',
          title: 'Sign in',
          body: 'Guests sign in here with email or Google — you land straight on the booking form.',
        }}
      />
      <p className="mt-6 text-xs text-forest-700/60 text-center">
        Are you the Host?{' '}
        <Link to="/admin/auth" className="underline underline-offset-4 hover:text-forest-900">
          Sign in on the Host page
        </Link>
      </p>
    </AuthShell>
  )
}

export function AdminAuthPage() {
  const { user, role, loading, logout } = useAuth()

  if (loading) {
    return <AuthLoading />
  }

  if (user && role === 'host') {
    return <Navigate to="/admin" replace />
  }

  if (user) {
    return <TurnedAway path="/admin/auth" allowed={['host']} />
  }

  return (
    <AuthShell intro={ADMIN_INTRO}>
      <LoginForm
        intro={{
          eyebrow: 'Welcome back',
          title: 'Sign in',
          body: 'The Host signs in here with email or Google.',
        }}
        registerIntro={adminRegisterIntro()}
      />
      <div className="mt-6 text-xs text-forest-700/60 text-center space-y-2">
        <p>
          Staying as a Guest?{' '}
          <Link to="/guest/auth" className="underline underline-offset-4 hover:text-forest-900">
            Sign in on the Guest page
          </Link>
        </p>
        <p>
          Signed in as {role ? ROLE_LABELS[role] : 'a Guest'} by mistake?{' '}
          <button onClick={() => void logout()} className="underline underline-offset-4 hover:text-forest-900">
            Sign out
          </button>
        </p>
      </div>
    </AuthShell>
  )
}
