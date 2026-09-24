import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoginForm, type AuthIntro } from '../components/Auth/LoginForm'
import { TurnedAway } from '../components/Auth/ProtectedRoute'

/**
 * The Guest's sign-in page, `/guest/auth`.
 *
 * It is public — a person with no session must be able to open it — and uses
 * the one `LoginForm`, so email and Google arrive through the same session.
 * Google's button appears whenever Firebase is configured; with no keys the
 * page runs in demo mode like every other sign-in surface.
 *
 * Once a Guest is signed in there is nothing left to do here: they are sent
 * straight to `/book`. An Admin who signs in on the website is turned away with
 * the same notice every gated page gives, pointing at the mobile app that is
 * theirs (ADR-0007). There is no Admin sign-in page on the website.
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
        Running the hacienda? The Admin signs in on the Hacienda de LuisAna Admin mobile app, not on this website.
      </p>
    </AuthShell>
  )
}
