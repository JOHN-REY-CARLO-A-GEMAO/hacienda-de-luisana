import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ROLE_LABELS, canOpenPage, pageRoles, type Role } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { LoginForm } from './LoginForm'
import { Alert, LoadingPanel, MessageScreen } from '../ui'

/**
 * The gate in front of every page that is not public.
 *
 * Three answers, in the order they can be given:
 *
 * 1. **Still finding out who you are** — a spinner, and no role, so nothing on
 *    the page behind it can be reached while the Profile is being read.
 * 2. **Nobody signed in** — the sign-in form.
 * 3. **Somebody signed in who does not belong here** — on this website that is
 *    the Admin, whose application is the mobile app (ADR-0007). They are told
 *    where to go rather than shown a Guest's page that has nothing of theirs.
 *
 * The gate reads the path it is standing on, so a route cannot forget to say
 * which roles it takes: a page's roles come from the same catalogue the Firestore
 * rules come from. Turning somebody away here is a courtesy — the refusal that
 * matters is the one `firestore.rules` gives the same request.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading, isConfigured } = useAuth()
  const location = useLocation()
  // Somebody who was signed in a moment ago and is not now has lost their session
  // (expired, or ended elsewhere). Say so instead of showing a bare sign-in form.
  const hadUser = useRef(false)
  useEffect(() => {
    if (user) hadUser.current = true
  }, [user])
  const sessionEnded = !user && hadUser.current

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-50 px-5 pt-28">
        <LoadingPanel label="Checking authentication…" className="max-w-sm" />
      </div>
    )
  }

  const allowed = pageRoles(location.pathname) ?? []

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-cream-50 px-5 pb-24 pt-28">
        <div className="w-full max-w-md py-8">
          {sessionEnded && (
            <Alert tone="warning" className="mb-4">
              Your session has ended. Please sign in again to continue — nothing on your bookings was changed.
            </Alert>
          )}
          <LoginForm />
        </div>
        <p className="mt-4 max-w-sm text-center text-xs text-forest-700/60">
          Sign in to see your own bookings. Signing up here makes you a Guest.
        </p>
      </div>
    )
  }

  if (!canOpenPage(role, location.pathname)) {
    return <TurnedAway path={location.pathname} allowed={allowed} />
  }

  return (
    <>
      {!isConfigured && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-100/90 px-4 py-2 text-xs text-amber-900">
          <span className="text-[10px] font-semibold uppercase tracking-eyebrow">Local Mode Active</span>
          <span>Signed in as {role ? ROLE_LABELS[role] : 'Guest'} · bookings are stored in this browser only.</span>
          <Link to="/status" className="ml-auto whitespace-nowrap underline underline-offset-2">
            Why?
          </Link>
        </div>
      )}
      {children}
    </>
  )
}

/**
 * Signed in, but not as somebody this page is for.
 *
 * On the Guest website the only person this happens to is the Admin, so the
 * message points them at the application that is theirs.
 */
export function TurnedAway({ path, allowed }: { path: string; allowed: Role[] }) {
  const { role, user, logout } = useAuth()
  const labels = allowed.map((openTo) => ROLE_LABELS[openTo]).join(' or ')
  const isAdmin = role === 'admin'

  return (
    <MessageScreen
      eyebrow={isAdmin ? 'Admin account' : '403'}
      title={isAdmin ? 'This website is for Guests' : "This page isn't yours"}
      body={
        <p>
          <code className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-xs">{path}</code> is for{' '}
          {labels || 'another role'}. You are signed in as{' '}
          <strong>
            {role ? ROLE_LABELS[role] : 'a Guest'}
            {user?.email ? ` (${user.email})` : ''}
          </strong>
          .
          {isAdmin
            ? ' Bookings, payments, stays, the smart lock and every other management task live in the Hacienda de LuisAna Admin mobile app — open it on your phone.'
            : ' Roles are stored in your Profile, not chosen in this browser.'}
        </p>
      }
      actions={
        <>
          <Link to="/" className="btn-primary">
            Back to the Hacienda
          </Link>
          <button onClick={() => void logout()} className="btn-ghost">
            Sign out
          </button>
        </>
      }
    />
  )
}
