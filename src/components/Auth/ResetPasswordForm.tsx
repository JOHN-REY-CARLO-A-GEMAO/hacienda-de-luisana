import { useState } from 'react'
import { describeAuthError } from '../../lib/auth'
import { EMAIL_MAX, validateEmail } from '../../lib/validation'
import { useAuth } from '../../hooks/useAuth'
import { Field, Input } from '../ui'
import { LIMITS, checkRateLimit } from '../../lib/rateLimit'
import type { AuthIntro } from './AuthShell'

interface ResetPasswordFormProps {
  intro: AuthIntro
  email: string
  onEmailChange: (email: string) => void
  onSuccess?: () => void
  onError: (error: string | null) => void
  onInfo: (info: string | null) => void
}

/**
 * Password reset form.
 *
 * Handles:
 * - Email input
 * - Rate limiting
 * - Error handling via describeAuthError
 */
export function ResetPasswordForm({
  intro,
  email,
  onEmailChange,
  onSuccess,
  onError,
  onInfo,
}: ResetPasswordFormProps) {
  const { resetPassword } = useAuth()
  const [loading, setLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)

    const emailRes = validateEmail(email)
    if (!emailRes.ok) {
      setEmailError(emailRes.message)
      onError(emailRes.message)
      return
    }

    setLoading(true)

    try {
      const rateLimit = checkRateLimit('reset', LIMITS.reset)
      if (!rateLimit.ok) {
        onError(rateLimit.message)
        return
      }

      await resetPassword(email)
      onInfo('Password reset email sent! Check your inbox.')
      onSuccess?.()
    } catch (err) {
      const described = describeAuthError(err)
      onError(described.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Email" required error={emailError}>
        <Input
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            onEmailChange(e.target.value)
            if (emailError) setEmailError(null)
          }}
          required
          maxLength={EMAIL_MAX}
          autoComplete="email"
          spellCheck={false}
          invalid={Boolean(emailError)}
        />
      </Field>

      <button
        type="submit"
        disabled={loading || Boolean(emailError)}
        className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Please wait…' : 'Send Reset Link'}
      </button>
    </form>
  )
}
