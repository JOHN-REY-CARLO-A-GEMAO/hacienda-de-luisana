import { useState } from 'react'
import { describeAuthError } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)
    setLoading(true)

    try {
      const rateLimit = checkRateLimit('reset', LIMITS.reset)
      if (!rateLimit.ok) {
        onError(rateLimit.message)
        setLoading(false)
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
      <label className="block">
        <span className="label">Email</span>
        <input
          className="field"
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
          spellCheck={false}
        />
      </label>

      <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
        {loading ? 'Please wait…' : 'Send Reset Link'}
      </button>
    </form>
  )
}
