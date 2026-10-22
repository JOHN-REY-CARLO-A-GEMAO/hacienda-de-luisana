import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LoginForm } from '../components/Auth/LoginForm'
import { AuthLayout } from '../components/Auth/AuthShell'
import { TurnedAway } from '../components/Auth/ProtectedRoute'
import { LoadingPanel } from '../components/ui'

/**
 * The Guest's sign-in page, `/guest/auth`.
 *
 * It is public — a person with no session must be able to open it — and uses
 * the one `LoginForm`, so email and Google arrive through the same session.
 * Google's button appears whenever Firebase is configured; with no keys the
 * page runs in demo mode like every other sign-in surface.
 *
 * The page supplies the frame and the photograph; the form supplies its own
 * heading, which changes with the mode (sign in, create account, reset). There
 * is deliberately no second page title above it.
 *
 * Once a Guest is signed in there is nothing left to do here: they are sent
 * straight to `/book`. An Admin who signs in on the website is turned away with
 * the same notice every gated page gives, pointing at the mobile app that is
 * theirs (ADR-0007). There is no Admin sign-in page on the website.
 */
export function GuestAuthPage() {
  const { user, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-50 px-5 pt-28">
        <LoadingPanel label="Checking authentication…" className="max-w-sm" />
      </div>
    )
  }

  if (user && role === 'guest') {
    return <Navigate to="/book" replace />
  }

  if (user) {
    return <TurnedAway path="/guest/auth" allowed={['guest']} />
  }

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  )
}
