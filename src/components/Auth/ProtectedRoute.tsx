import { Link, useLocation } from 'react-router-dom'
import { ROLE_LABELS, canOpenPage, pageRoles, type Role } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { LoginForm } from './LoginForm'

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

  if (loading) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto w-10 h-10 border-2 border-forest-200 border-t-forest-700 rounded-full animate-spin" />
          <p className="mt-4 text-sm text-forest-700/70">Checking authentication…</p>
        </div>
      </div>
    )
  }

  const allowed = pageRoles(location.pathname) ?? []

  if (!user) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex flex-col items-center">
        <div className="w-full max-w-md px-5">
          <LoginForm />
        </div>
        <p className="mt-6 text-xs text-forest-700/60 text-center max-w-sm px-5">
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
        <div className="bg-amber-100/90 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center gap-2">
          <span className="font-semibold uppercase tracking-eyebrow text-[10px]">Local Mode Active:</span>
          <span>Signed in as {role ? ROLE_LABELS[role] : 'Guest'} · bookings are stored in this browser only.</span>
          <Link to="/status" className="ml-auto underline whitespace-nowrap">Why?</Link>
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
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex items-center">
      <div className="mx-auto max-w-lg text-center px-5">
        <div className="eyebrow">{isAdmin ? 'Admin account' : '403'}</div>
        <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">
          {isAdmin ? 'This website is for Guests' : "This page isn't yours"}
        </h1>
        <p className="mt-4 text-forest-800/80 text-sm leading-relaxed">
          <code className="font-mono text-xs bg-cream-100 px-1.5 py-0.5 rounded">{path}</code> is for{' '}
          {labels || 'another role'}. You are signed in as{' '}
          <strong>
            {role ? ROLE_LABELS[role] : 'a Guest'}
            {user?.email ? ` (${user.email})` : ''}
          </strong>
          .
          {isAdmin
            ? ' Bookings, KYC review, payments, stays, the smart lock and every other management task live in the Hacienda de LuisAna Admin mobile app — open it on your phone.'
            : ' Roles are stored in your Profile, not chosen in this browser.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to="/" className="btn-primary text-xs">
            Back to the Hacienda
          </Link>
          <button onClick={() => void logout()} className="btn-ghost text-xs">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
