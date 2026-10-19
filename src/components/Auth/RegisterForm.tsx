import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MIN_PASSWORD_LENGTH, describeAuthError } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import {
  EMAIL_MAX,
  NAME_MAX,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateBirthdate,
  validateName,
  validatePhMobile,
} from '../../lib/validation'
import { LEGAL_VERSION } from '../../lib/legal'
import type { AuthIntro, RegisterIntro } from './AuthShell'

interface RegisterFormProps {
  intro: RegisterIntro
  email: string
  onEmailChange: (email: string) => void
  onSuccess?: () => void
  onError: (error: string | null) => void
  onInfo: (info: string | null) => void
  onSuggestLogin: (suggest: boolean) => void
  onSwitchToLogin: () => void
}

/**
 * Guest registration form.
 *
 * Handles:
 * - Profile fields (display name, first/middle/last name, phone, birthdate)
 * - Terms acceptance
 * - Client-side validation
 * - Rate limiting
 * - Error handling via describeAuthError
 * - Duplicate email detection with suggestLogin
 *
 * Preserves the existing name field coupling behavior for backward compatibility.
 */
export function RegisterForm({
  intro,
  email,
  onEmailChange,
  onSuccess,
  onError,
  onInfo,
  onSuggestLogin,
  onSwitchToLogin,
}: RegisterFormProps) {
  const { register } = useAuth()
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function validateRegisterFields(): Record<string, string> {
    const problems: Record<string, string> = {}

    if (displayName.trim()) {
      const nameRes = validateName(displayName)
      if (!nameRes.ok) problems.displayName = nameRes.message
    }
    if (firstName.trim()) {
      const fnRes = validateName(firstName)
      if (!fnRes.ok) problems.firstName = fnRes.message
    }
    if (lastName.trim()) {
      const lnRes = validateName(lastName)
      if (!lnRes.ok) problems.lastName = lnRes.message
    }
    if (middleName.trim()) {
      const mnRes = validateName(middleName)
      if (!mnRes.ok) problems.middleName = mnRes.message
    }
    if (phone.trim()) {
      const phRes = validatePhMobile(phone)
      if (!phRes.ok) problems.phone = phRes.message
    }

    const birth = validateBirthdate(birthdate)
    if (!birth.ok) problems.birthdate = birth.message

    if (!acceptTerms) {
      problems.acceptTerms = 'Please accept the Terms and Conditions to create an account.'
    }

    return problems
  }

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)
    onSuggestLogin(false)

    const problems = validateRegisterFields()
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) {
      onError('Please correct the highlighted form errors before submitting.')
      return
    }

    setLoading(true)

    try {
      const constructedDisplayName = `${firstName.trim()} ${lastName.trim()}`.trim() || displayName
      await register(email, password, {
        firstName: firstName.trim(),
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim(),
        phone: phone.trim(),
        displayName: constructedDisplayName || undefined,
        birthdate: birthdate ? birthdate : undefined,
        acceptedTerms: acceptTerms,
      })
      onInfo(intro.successMessage)
      onSuccess?.()
    } catch (err) {
      const described = describeAuthError(err)
      onError(described.message)
      onSuggestLogin(described.code === 'auth/email-already-in-use')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Group 1: Your Name */}
      <div className="space-y-4">
        <div className="pb-2 border-b border-forest-900/10">
          <span className="text-xs font-semibold uppercase tracking-eyebrow text-forest-600">Your Name</span>
        </div>

        <label className="block">
          <span className="label">Full Name</span>
          <input
            className="field"
            placeholder="Juan Dela Cruz"
            value={displayName}
            onChange={(e) => {
              const clean = sanitizeNameInput(e.target.value)
              setDisplayName(clean)
              clearFieldError('displayName')
              const parts = clean.trim().split(' ')
              if (parts.length > 1) {
                setFirstName(parts[0])
                setLastName(parts.slice(1).join(' '))
                clearFieldError('firstName')
                clearFieldError('lastName')
              } else {
                setFirstName(clean)
              }
            }}
            onKeyDown={(e) => {
              if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
              }
            }}
            autoComplete="name"
            maxLength={NAME_MAX}
            aria-invalid={fieldErrors.displayName ? true : undefined}
          />
          {fieldErrors.displayName && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.displayName}</span>
          )}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">First Name</span>
            <input
              className="field"
              placeholder="Juan"
              value={firstName}
              onChange={(e) => {
                const clean = sanitizeNameInput(e.target.value)
                setFirstName(clean)
                setDisplayName(`${clean} ${lastName}`.trim())
                clearFieldError('firstName')
                clearFieldError('displayName')
              }}
              onKeyDown={(e) => {
                if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault()
                }
              }}
              maxLength={NAME_MAX}
              aria-invalid={fieldErrors.firstName ? true : undefined}
            />
            {fieldErrors.firstName && (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.firstName}</span>
            )}
          </label>

          <label className="block">
            <span className="label">Last Name</span>
            <input
              className="field"
              placeholder="Dela Cruz"
              value={lastName}
              onChange={(e) => {
                const clean = sanitizeNameInput(e.target.value)
                setLastName(clean)
                setDisplayName(`${firstName} ${clean}`.trim())
                clearFieldError('lastName')
                clearFieldError('displayName')
              }}
              onKeyDown={(e) => {
                if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault()
                }
              }}
              maxLength={NAME_MAX}
              aria-invalid={fieldErrors.lastName ? true : undefined}
            />
            {fieldErrors.lastName && (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.lastName}</span>
            )}
          </label>
        </div>

        <label className="block">
          <span className="label">Middle Name <span className="font-normal text-forest-500">(optional)</span></span>
          <input
            className="field"
            placeholder="Santos"
            value={middleName}
            onChange={(e) => {
              setMiddleName(sanitizeNameInput(e.target.value))
              clearFieldError('middleName')
            }}
            onKeyDown={(e) => {
              if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
              }
            }}
            maxLength={NAME_MAX}
            aria-invalid={fieldErrors.middleName ? true : undefined}
          />
          {fieldErrors.middleName && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.middleName}</span>
          )}
        </label>
      </div>

      {/* Group 2: Contact Information */}
      <div className="space-y-4">
        <div className="pb-2 border-b border-forest-900/10">
          <span className="text-xs font-semibold uppercase tracking-eyebrow text-forest-600">Contact Information</span>
        </div>

        <label className="block relative">
          <span className="label">Email</span>
          <div className="relative">
            <input
              className="field pr-16"
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => {
                onEmailChange(e.target.value)
                clearFieldError('email')
              }}
              required
              maxLength={EMAIL_MAX}
              autoComplete="email"
              spellCheck={false}
            />
            {email && (
              <button
                type="button"
                onClick={() => onEmailChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-forest-600 hover:text-forest-900 px-2 py-1 rounded bg-forest-900/5 hover:bg-forest-900/10 transition"
              >
                Clear
              </button>
            )}
          </div>
        </label>

        <label className="block">
          <span className="label">Mobile Phone <span className="font-normal text-forest-500">(optional)</span></span>
          <input
            className="field"
            placeholder="09171234567"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(sanitizePhoneInput(e.target.value))
              clearFieldError('phone')
            }}
            onKeyDown={(e) => {
              if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
              }
            }}
            maxLength={20}
            aria-invalid={fieldErrors.phone ? true : undefined}
          />
          <span className="text-[11px] text-forest-600 mt-1 block">Philippine format: 09XX XXX XXXX</span>
          {fieldErrors.phone && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.phone}</span>
          )}
        </label>
      </div>

      {/* Group 3: Account Security */}
      <div className="space-y-4">
        <div className="pb-2 border-b border-forest-900/10">
          <span className="text-xs font-semibold uppercase tracking-eyebrow text-forest-600">Account Security</span>
        </div>

        <label className="block relative">
          <span className="label">Password</span>
          <div className="relative">
            <input
              className="field pr-16"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearFieldError('password')
              }}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={200}
              autoComplete="new-password"
            />
            {password && (
              <button
                type="button"
                onClick={() => setPassword('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-forest-600 hover:text-forest-900 px-2 py-1 rounded bg-forest-900/5 hover:bg-forest-900/10 transition"
              >
                Clear
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full ${password.length >= MIN_PASSWORD_LENGTH ? 'bg-emerald-50 text-emerald-700' : 'bg-forest-100 text-forest-600'}`}>
              {password.length >= MIN_PASSWORD_LENGTH ? '✓' : '○'} {MIN_PASSWORD_LENGTH}+ characters
            </span>
          </div>
        </label>

        <label className="block">
          <span className="label">Date of Birth</span>
          <input
            className="field"
            type="date"
            value={birthdate}
            onChange={(e) => {
              setBirthdate(e.target.value)
              clearFieldError('birthdate')
            }}
            required
            aria-invalid={fieldErrors.birthdate ? true : undefined}
          />
          <span className="text-[11px] text-forest-600 mt-1 block">You must be at least 10 years old.</span>
          {fieldErrors.birthdate && (
            <span className="mt-1 block text-xs text-red-600">{fieldErrors.birthdate}</span>
          )}
        </label>
      </div>

      {/* Group 4: Terms */}
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm text-forest-800 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-5 h-5 rounded border-forest-300 text-forest-700 focus:ring-forest-600"
            checked={acceptTerms}
            onChange={(e) => {
              setAcceptTerms(e.target.checked)
              clearFieldError('acceptTerms')
            }}
          />
          <span className="leading-relaxed">
            I have read and accept the{' '}
            <Link to="/legal" className="underline underline-offset-2 hover:text-forest-900">Terms and Conditions</Link>{' '}
            (version {LEGAL_VERSION}).
          </span>
        </label>
        {fieldErrors.acceptTerms && (
          <span className="block text-xs text-red-600">{fieldErrors.acceptTerms}</span>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || Object.keys(fieldErrors).length > 0}
        className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Please wait…' : intro.submitLabel}
      </button>
    </form>
  )
}
