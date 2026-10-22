import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential, linkWithPopup } from 'firebase/auth'
import { useAuth } from '../hooks/useAuth'
import { auth, googleProvider } from '../lib/firebase'
import { DisputeForm } from '../components/DisputeForm'
import { EMAIL_MAX } from '../lib/validation'
import { caseInbox, readCaseNotification, caseDate, type CaseNotification } from '../lib/disputes'
import { Alert, Card, Container, EmptyState, Field, Input, PageHeader } from '../components/ui'
import { Bell, MessageCircle } from '../lib/icons'

/**
 * /support — the Hacienda's issue and dispute desk.
 *
 * Three jobs on one page: secure a booking identity that was made before the
 * Guest had an account, read the decisions the Admin has recorded against a
 * case, and open a new one. They are ordered by what blocks what — an unsecured
 * identity is why a Guest cannot see their own case, so it comes first.
 */
export function SupportPage() {
  const { user, role, refresh } = useAuth()
  const [inbox, setInbox] = useState<CaseNotification[]>([])
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || user.isAnonymous || role !== 'guest') return
    let alive = true
    const load = () =>
      void caseInbox()
        .then((rows) => {
          if (alive) setInbox(rows)
        })
        .catch((e) => {
          if (alive) setError(e.message)
        })
    load()
    const timer = window.setInterval(load, 60000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [user?.uid, user?.isAnonymous, role])

  async function link(google: boolean) {
    setBusy(true)
    setError('')
    try {
      if (!auth?.currentUser?.isAnonymous) throw new Error('The original anonymous booking session must still be present.')
      if (google && googleProvider) await linkWithPopup(auth.currentUser, googleProvider)
      else await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password))
      await auth.currentUser?.getIdToken(true)
      await refresh()
      setPassword('')
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Linking failed. Contact official support; never infer ownership from email alone.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream-50 pb-24 pt-28">
      <Container width="narrow">
        <PageHeader
          eyebrow="Support"
          title="Support &amp; Disputes"
          lead={
            <p>
              Report a booking concern from{' '}
              <Link className="text-link" to="/account">
                My Bookings
              </Link>
              , or submit a general concern below. For urgent assistance use the{' '}
              <Link className="text-link" to="/contact">
                official contact channels
              </Link>
              . This is not an emergency-response channel.
            </p>
          }
          actions={
            <Link to="/contact" className="btn-quiet">
              <MessageCircle size={16} />
              Contact the Hacienda
            </Link>
          }
        />

        {error && (
          <Alert tone="danger" className="mt-6">
            {error}
          </Alert>
        )}

        {!user && (
          <Card className="mt-8" padding="lg">
            <h2 className="h3">Sign in to report or track a case</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85">
              A case belongs to the identity that opened it. Sign in with the same account you booked
              with, and your cases appear here.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/guest/auth" className="btn-primary">
                Sign in
              </Link>
              <Link to="/contact" className="btn-ghost">
                Contact instead
              </Link>
            </div>
          </Card>
        )}

        {user && role === 'admin' && (
          <Card className="mt-8" padding="lg">
            <h2 className="h3">Manage cases in the Admin app</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85">
              Case review, evidence and resolutions live in the Hacienda de LuisAna Admin mobile app. This
              website is the Guest&rsquo;s side of the same records.
            </p>
          </Card>
        )}

        {user && role !== 'admin' && user.isAnonymous && (
          <Card className="mt-8" padding="lg">
            <h2 className="h3">Secure this booking identity</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85">
              Link the identity already attached to your booking. This keeps the same UID. If your email
              is already used by another account, stop and request verified recovery through official
              support; do not sign out expecting the booking to transfer.
            </p>
            <form
              className="mt-6 max-w-md space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void link(false)
              }}
            >
              <Field label="Email" required>
                <Input
                  type="email"
                  required
                  maxLength={EMAIL_MAX}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (error) setError('')
                  }}
                  autoComplete="email"
                />
              </Field>
              <Field label="New account password" hint="At least 12 characters." required>
                <Input
                  type="password"
                  required
                  minLength={12}
                  maxLength={200}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (error) setError('')
                  }}
                  autoComplete="new-password"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || !email.trim() || password.length < 12 || Boolean(error)}
                  className="btn-primary"
                >
                  {busy ? 'Linking…' : 'Link with email'}
                </button>
                <button type="button" disabled={busy} className="btn-quiet" onClick={() => void link(true)}>
                  Link with Google
                </button>
              </div>
            </form>
          </Card>
        )}

        {user && role !== 'admin' && !user.isAnonymous && (
          <div className="mt-8 space-y-6">
            <Card padding="lg" as="section" aria-label="Case notifications">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="h3">Case notifications</h2>
                  <p className="mt-1 text-xs text-forest-700/80">
                    In-app delivery only. Opening a notification does not accept a resolution.
                  </p>
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-100 text-forest-700">
                  <Bell size={16} />
                </span>
              </div>

              {!inbox.length ? (
                <EmptyState compact icon={Bell} title="No notifications yet" body="Updates on a case you open appear here." />
              ) : (
                <ul className="mt-4 divide-y divide-forest-900/5">
                  {inbox
                    .filter((n) => n.user_id === user.uid)
                    .map((n) => (
                      <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <strong className="text-sm text-forest-900">{n.title}</strong>
                          <p className="mt-0.5 text-sm leading-relaxed text-forest-800">{n.message}</p>
                          <p className="mt-1 text-[11px] text-forest-600">{caseDate(n.created_at)}</p>
                        </div>
                        <button
                          type="button"
                          className="btn-quiet btn-sm shrink-0"
                          disabled={n.read}
                          onClick={() =>
                            void readCaseNotification(n.id)
                              .then(() =>
                                setInbox((rows) =>
                                  rows.map((row) => (row.id === n.id ? { ...row, read: true } : row)),
                                ),
                              )
                              .catch((e) => setError(e.message))
                          }
                        >
                          {n.read ? 'Read' : 'Mark read'}
                        </button>
                      </li>
                    ))}
                </ul>
              )}

              {inbox.length >= 50 && (
                <button
                  type="button"
                  className="btn-ghost btn-sm mt-3"
                  onClick={() =>
                    void caseInbox(inbox.at(-1)?.id)
                      .then((rows) => setInbox((prev) => [...new Map([...prev, ...rows].map((n) => [n.id, n])).values()]))
                      .catch((e) => setError(e.message))
                  }
                >
                  Load older notifications
                </button>
              )}
            </Card>

            <DisputeForm key={user.uid} guestId={user.uid} />
          </div>
        )}
      </Container>
    </div>
  )
}
