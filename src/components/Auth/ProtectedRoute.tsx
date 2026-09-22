import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ROLE_LABELS, canOpenPage, homeForRole, pageRoles, type Role } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { LoginForm } from './LoginForm'

/**
 * The gate in front of every page that is not public.
 *
 * Three answers, in the order they can be given:
 *
 * 1. **Still finding out who you are** — a spinner, and no role, so nothing on
 *    the page behind it can be reached while the Profile is being read.
 * 2. **Nobody signed in** — the sign-in form, saying which roles this page is for.
 * 3. **Somebody signed in as the wrong role** — turned away, and told who they
 *    are, rather than shown a page whose every write Firestore would refuse.
 *
 * The gate reads the path it is standing on, so a route cannot forget to say
 * which roles it takes: a page's roles come from the same catalogue the Firestore
 * rules come from. Turning somebody away here is a courtesy — the refusal that
 * matters is the one `firestore.rules` gives the same request.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading, isConfigured } = useAuth()
  const location = useLocation()
  const [showDemo, setShowDemo] = useState(false)

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
  const wanted = allowed.map((openTo) => ROLE_LABELS[openTo]).join(' or ')

  if (!user) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex flex-col items-center">
        <div className="w-full max-w-md px-5">
          <LoginForm />
        </div>
        <p className="mt-6 text-xs text-forest-700/60 text-center max-w-sm px-5">
          {wanted ? `${wanted} access only.` : 'Authorized accounts only.'} Signing up here makes you a Guest — the
          Host is the one who gives somebody the Staff role.
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
        <div className="bg-amber-100/90 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-eyebrow text-[10px]">Local Mode Active:</span>
            <span>
              Signed in as {role ? ROLE_LABELS[role] : 'Guest'} · simulated smart lock &amp; local bookings database.
            </span>
          </div>
          <button onClick={() => setShowDemo(!showDemo)} className="underline hover:text-amber-950 font-medium shrink-0">
            {showDemo ? 'Hide Role Switcher' : 'Switch Role'}
          </button>
        </div>
      )}
      {!isConfigured && showDemo && <DemoRoleSwitcher />}
      {children}
    </>
  )
}

/** Signed in, but not as somebody this page is for. */
export function TurnedAway({ path, allowed }: { path: string; allowed: Role[] }) {
  const { role, user, logout } = useAuth()
  const labels = allowed.map((openTo) => ROLE_LABELS[openTo]).join(' or ')

  return (
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex items-center">
      <div className="mx-auto max-w-lg text-center px-5">
        <div className="eyebrow">403</div>
        <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">This page isn't yours</h1>
        <p className="mt-4 text-forest-800/80 text-sm leading-relaxed">
          <code className="font-mono text-xs bg-cream-100 px-1.5 py-0.5 rounded">{path}</code> is for{' '}
          {labels || 'another role'}. You are signed in as{' '}
          <strong>
            {role ? ROLE_LABELS[role] : 'a Guest'}
            {user?.email ? ` (${user.email})` : ''}
          </strong>
          . Roles are given by the Host, not chosen in this browser.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to={homeForRole(role)} className="btn-primary text-xs">
            Go to my page
          </Link>
          <Link to="/" className="btn-ghost text-xs">
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

/**
 * Demo mode's role switcher.
 *
 * Only where there is no Firebase: with no cloud there is no Host to promote
 * anybody, so the three roles are stepped into directly to walk the flows
 * through. Every account it makes lives in this browser's storage, and the
 * switcher is not rendered at all once the project has real keys.
 */
export function DemoRoleSwitcher() {
  const { signInAsRole, role } = useAuth()
  const [busy, setBusy] = useState<Role | null>(null)

  const step = async (next: Role) => {
    setBusy(next)
    try {
      await signInAsRole(next)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs text-amber-900">
      <span className="font-semibold uppercase tracking-eyebrow text-[10px]">Demo roles:</span>
      {(['host', 'staff', 'guest'] as Role[]).map((option) => (
        <button
          key={option}
          onClick={() => void step(option)}
          disabled={busy !== null || role === option}
          className={`px-3 py-1 rounded-full border transition disabled:opacity-50 ${
            role === option ? 'bg-amber-900 text-amber-50 border-amber-900' : 'bg-white border-amber-300 hover:bg-amber-100'
          }`}
        >
          {busy === option ? 'Signing in…' : ROLE_LABELS[option]}
        </button>
      ))}
      <span className="text-[11px] text-amber-800/80 ml-auto">Accounts stay in this browser.</span>
    </div>
  )
}
