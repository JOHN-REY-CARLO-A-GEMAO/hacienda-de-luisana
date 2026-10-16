import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoginForm, type AuthIntro } from '../components/Auth/LoginForm'
import { TurnedAway } from '../components/Auth/ProtectedRoute'
import { Logo } from '../components/Logo'

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
    <div className="min-h-screen flex flex-col lg:flex-row bg-cream-50">
      {/* Left: Property photograph (desktop 60%, mobile header) */}
      <div className="lg:w-[60%] lg:h-screen lg:sticky lg:top-0 relative">
        <div className="h-[30vh] lg:h-full">
          <img
            src="/images/gmaps/img-01.jpg"
            alt="Hacienda de LuisAna main house at golden hour"
            className="w-full h-full object-cover"
          />
          {/* Dark overlay for text legibility on mobile */}
          <div className="lg:hidden absolute inset-0 bg-gradient-to-b from-forest-950/40 via-transparent to-forest-950/60" />
        </div>
      </div>

      {/* Right: White panel with form (desktop 40%, mobile below photo) */}
      <div className="lg:w-[40%] flex flex-col bg-white min-h-[70vh] lg:min-h-screen">
        {/* Logo positioned at top */}
        <div className="px-6 lg:px-10 pt-8 lg:pt-12">
          <Logo tone="dark" />
        </div>

        {/* Form content */}
        <div className="flex-1 px-6 lg:px-10 py-6 lg:py-8 flex flex-col justify-center">
          <div className="mb-8">
            <div className="eyebrow text-sage-500">{intro.eyebrow}</div>
            <h1 className="font-serif text-3xl lg:text-4xl mt-3 text-forest-900">{intro.title}</h1>
            <p className="mt-3 text-sm lg:text-base text-forest-700/85 leading-relaxed">{intro.body}</p>
          </div>
          {children}
        </div>
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
