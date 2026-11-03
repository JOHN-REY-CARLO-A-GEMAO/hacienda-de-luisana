import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Alert } from '../ui'

/**
 * A sign-up can redirect as soon as Firebase signs the Guest in, before the
 * email request finishes. This notice lives on the destination pages instead
 * of the registration form, and also gives existing unverified Guests a way
 * to retry or refresh their status after following the link.
 *
 * This is informational: it does not block sign-in, bookings or access.
 */
export function EmailVerificationNotice({ className = '' }: { className?: string }) {
  const {
    user, isCloud, isRegistering, verificationEmail,
    sendVerificationEmail, checkEmailVerification,
  } = useAuth()
  const [checking, setChecking] = useState(false)
  const [feedback, setFeedback] = useState<{ uid: string; text: string } | null>(null)
  const [verifiedHere, setVerifiedHere] = useState<{ uid: string; email: string } | null>(null)

  if (!isCloud || !user || user.isAnonymous || user.provider !== 'password' || !user.email) return null
  if (user.emailVerified === true) {
    return verifiedHere?.uid === user.uid && verifiedHere.email === user.email ? (
      <Alert tone="success" title="Email verified" className={className} actions={
        <button type="button" className="btn-quiet btn-sm" onClick={() => setVerifiedHere(null)}>
          Dismiss
        </button>
      }>
        Your email address has been verified. Thank you.
      </Alert>
    ) : null
  }
  if (user.emailVerified !== false) return null

  const delivery = verificationEmail.uid === user.uid && verificationEmail.email === user.email
    ? verificationEmail
    : { status: 'idle' as const, message: null }
  const sending = delivery.status === 'sending' || (isRegistering && delivery.status === 'idle')
  const busy = sending || checking || isRegistering

  async function resend() {
    if (!user || busy) return
    setFeedback(null)
    try {
      await sendVerificationEmail()
    } catch {
      // The session publishes a safe, actionable failure message. An identity
      // change can make the request unavailable before that state is written.
      setFeedback({ uid: user.uid, text: 'If the email was not sent, please try again.' })
    }
  }

  async function check() {
    if (!user?.email || busy) return
    const { uid, email } = user
    setChecking(true)
    setFeedback(null)
    try {
      if (await checkEmailVerification()) {
        setVerifiedHere({ uid, email })
      } else {
        setFeedback({ uid, text: 'Your email is not verified yet. Open the link in your email, then check again.' })
      }
    } catch {
      setFeedback({ uid, text: 'We could not check your verification status. Check your connection and try again.' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Alert
      tone={delivery.status === 'failed' ? 'warning' : 'info'}
      role="status"
      title="Verify your email"
      className={className}
      actions={
        <>
          <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void resend()}>
            {sending ? 'Sending email…' : delivery.status === 'sent' ? 'Resend verification email' : 'Send verification email'}
          </button>
          <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void check()}>
            {checking ? 'Checking…' : 'I have verified my email'}
          </button>
        </>
      }
    >
      {sending ? (
        <p>Preparing a verification email for <strong>{user.email}</strong>.</p>
      ) : delivery.status === 'sent' ? (
        <p>We requested a verification email for <strong>{user.email}</strong>. Check your inbox and spam folder, then follow the link.</p>
      ) : delivery.status === 'failed' ? (
        <p>We could not confirm a verification email was sent to <strong>{user.email}</strong>. Your account is still ready. Check your inbox or try again. {delivery.message}</p>
      ) : (
        <p>Your email <strong>{user.email}</strong> is not verified yet. Send a verification email and follow its link. You can continue using your account.</p>
      )}
      {feedback?.uid === user.uid && <p className="mt-2">{feedback.text}</p>}
    </Alert>
  )
}
