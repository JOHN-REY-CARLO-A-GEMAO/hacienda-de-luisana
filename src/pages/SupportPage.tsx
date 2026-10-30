import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential, linkWithPopup } from 'firebase/auth'
import { useAuth } from '../hooks/useAuth'
import { auth, googleProvider } from '../lib/firebase'
import { EMAIL_MAX } from '../lib/validation'
import { MIN_PASSWORD_LENGTH } from '../lib/auth'
import { Alert, Card, Container, Field, Input, Page, PageHeader } from '../components/ui'
import { MessageCircle } from '../lib/icons'

/**
 * /support — account recovery and ways to reach the Hacienda.
 *
 * Booking and stay questions belong in the existing private Guest–Admin
 * conversation. Keeping account linking here preserves the original anonymous
 * Booking identity without inventing an email/reference ownership shortcut.
 */
function linkingError(error: unknown): string {
  const code = (error && typeof error === 'object' && 'code' in error) ? String(error.code) : ''
  if (['auth/email-already-in-use', 'auth/credential-already-in-use', 'auth/mybookings-exists-with-different-credential'].includes(code)) {
    return 'This credential is already linked to another account. Do not sign out; contact the Hacienda through its official channels for verified recovery.'
  }
  if (code === 'auth/invalid-email') return 'Please enter a valid email address.'
  if (code === 'auth/weak-password') return 'The password does not meet the account requirements. Please choose a stronger password.'
  if (code === 'auth/network-request-failed') return 'Could not reach the server. Check your connection and try again.'
  if (code === 'auth/popup-blocked') return 'The Google popup was blocked. Allow popups and try again.'
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Google linking was cancelled. You can try again.'
  if (code === 'auth/operation-not-allowed') return 'This sign-in method is not enabled. Contact the Hacienda for help.'
  return 'Could not link this identity. Please try again or contact the Hacienda without signing out.'
}

export function SupportPage() {
  const { user, role, refresh, loading } = useAuth()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function link(google: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const current = auth?.currentUser
      if (!current?.isAnonymous || current.uid !== user?.uid) {
        setError('The original anonymous booking session must still be present. Contact the Hacienda for help without signing out.')
        return
      }
      if (google) {
        if (!googleProvider) {
          setError('Google linking is not configured. Use email or contact the Hacienda for help.')
          return
        }
        await linkWithPopup(current, googleProvider)
      } else {
        await linkWithCredential(current, EmailAuthProvider.credential(email.trim(), password))
      }
      setPassword('')
      setNotice('Your booking identity was linked successfully. Your booking keeps the same UID.')
      // Linking is already complete even if the token or session refresh fails.
      try {
        await current.getIdToken(true)
        await refresh()
      } catch {
        setNotice('Your identity was linked, but the session could not be refreshed. Reload this page; do not try to link it again.')
      }
    } catch (e) {
      setError(linkingError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page className="dark:bg-forest-950 dark:text-cream-50">
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
          actions={!loading && role !== 'admin' ? (
            <Link to="/messages" className="btn-primary">
              <MessageCircle size={16} />
              Message the Admin
            </Link>
          ) : undefined}
        />

        {loading && <p role="status" className="mt-8 text-forest-700 dark:text-cream-100/80">Checking your session…</p>}

        {notice && <Alert tone="success" className="mt-6">{notice}</Alert>}

        {error && (
          <Alert tone="danger" className="mt-6">
            {error}
          </Alert>
        )}

        {!loading && !user && (
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

        {!loading && user && role === 'admin' && (
          <Card className="mt-8" padding="lg">
            <h2 className="h3">Guest messages are in the Admin app</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700/85 dark:text-cream-100/75">
              Open the Admin app&rsquo;s Guest messages inbox to read and reply to private
              conversations and image attachments.
            </p>
          </Card>
        )}

        {!loading && user && role !== 'admin' && user.isAnonymous && !notice && (
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
              <Field label="New account password" hint={`At least ${MIN_PASSWORD_LENGTH} characters, as for a Guest account.`} required>
                <Input
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
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
                  disabled={busy || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
                  className="btn-primary"
                >
                  {busy ? 'Linking…' : 'Link with email'}
                </button>
                <button type="button" disabled={busy || !googleProvider} className="btn-quiet" onClick={() => void link(true)}>
                  Link with Google
                </button>
              </div>
              {!googleProvider && (
                <p className="text-sm text-forest-700 dark:text-cream-100/75">Google linking is not configured. Use email or contact the Hacienda for help.</p>
              )}
            </form>
          </Card>
        )}

        {!loading && user && role !== 'admin' && !user.isAnonymous && (
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
              <Link to="/mybookings" className="btn-quiet">
                View My Bookings
              </Link>
            </div>
          </Card>
        )}
      </Container>
    </Page>
  )
}
