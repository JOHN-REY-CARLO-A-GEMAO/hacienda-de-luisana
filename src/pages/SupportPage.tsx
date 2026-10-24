import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential, linkWithPopup } from 'firebase/auth'
import { useAuth } from '../hooks/useAuth'
import { auth, googleProvider } from '../lib/firebase'
import { EMAIL_MAX } from '../lib/validation'
import { Alert, Card, Container, Field, Input, Page, PageHeader } from '../components/ui'
import { MessageCircle } from '../lib/icons'

/**
 * /support — account recovery and ways to reach the Hacienda.
 *
 * Booking and stay questions belong in the existing private Guest–Admin
 * conversation. Keeping account linking here preserves the original anonymous
 * Booking identity without inventing an email/reference ownership shortcut.
 */
export function SupportPage() {
  const { user, role, refresh } = useAuth()
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

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
    <Page>
      <Container width="narrow">
        <PageHeader
          eyebrow="Support"
          title="How can we help?"
          lead={
            <p>
              Ask about a Booking, payment, access, or your stay through a private Guest–Admin
              conversation. For urgent assistance use the{' '}
              <Link className="text-link" to="/contact">
                official contact channels
              </Link>
              . Messaging is not an emergency-response channel.
            </p>
          }
          actions={
            <Link to="/messages" className="btn-primary">
              <MessageCircle size={16} />
              Message the Admin
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
            <h2 className="h3">Sign in to start a private conversation</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
              Use the same account you booked with so your Booking details and messages stay with
              the right Guest identity.
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
            <h2 className="h3">Guest messages are in the Admin app</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
              Open the Admin app&rsquo;s Guest messages inbox to read and reply to private
              conversations and image attachments.
            </p>
          </Card>
        )}

        {user && role !== 'admin' && user.isAnonymous && (
          <Card className="mt-8" padding="lg">
            <h2 className="h3">Secure this booking identity</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
              Link the identity already attached to your booking. This keeps the same UID. If your
              email is already used by another account, stop and request verified recovery through
              official support; do not sign out expecting the booking to transfer.
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
          <Card className="mt-8" padding="lg" as="section" aria-label="Private Guest support">
            <h2 className="h3">Your Booking, your conversation</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
              Send a message on its own or attach a JPEG, PNG, or WebP image up to 5 MB with an
              optional caption. Only you and authorized Admins can read the conversation.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/messages" className="btn-primary">
                <MessageCircle size={16} />
                Open messages
              </Link>
              <Link to="/account" className="btn-quiet">
                View My Bookings
              </Link>
            </div>
          </Card>
        )}
      </Container>
    </Page>
  )
}
