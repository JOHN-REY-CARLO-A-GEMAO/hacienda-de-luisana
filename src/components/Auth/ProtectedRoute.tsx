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
      <div className="guest-ground flex min-h-screen items-center justify-center px-5 pt-28">
        <LoadingPanel label="Checking authentication…" className="guest-panel max-w-sm" />
      </div>
    )
  }

  const allowed = pageRoles(location.pathname) ?? []

  if (!user) {
    return (
      <div className="guest-ground flex min-h-screen flex-col items-center px-5 pb-24 pt-28">
        {/* One panel, and the Hacienda's own photograph across its head: the
            gate is the first thing a Guest sees of their own side of the site,
            and it should look like the place they booked rather than like a
            form that fell off a template. */}
        <div className="guest-panel w-full max-w-md overflow-hidden">
          <div className="relative h-28 overflow-hidden bg-forest-950">
            <img
              src="/images/gmaps/img-01.jpg"
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
              decoding="async"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-forest-950/90 via-forest-950/35 to-forest-950/10"
              aria-hidden="true"
            />
            <p className="absolute inset-x-0 bottom-0 px-5 pb-3 text-[11px] font-medium tracking-eyebrow text-cream-100/85">
              Your stay at the Hacienda
            </p>
          </div>

          <div className="px-5 py-6 sm:px-7">
            {sessionEnded && (
              <Alert tone="warning" className="mb-5">
                Your session has ended. Please sign in again to continue — nothing on your bookings
                was changed.
              </Alert>
            )}
            <LoginForm />
          </div>
        </div>
        <p className="mt-5 max-w-sm text-center text-xs leading-relaxed text-forest-700/70 dark:text-cream-100/60">
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
        <div className="local-mode-strip mx-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-amber-300/70 bg-amber-100/80 px-4 py-2 text-xs text-amber-900 sm:mx-auto sm:max-w-5xl lg:max-w-7xl">
          <span className="text-[11px] font-semibold uppercase tracking-eyebrow">Local Mode Active</span>
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
