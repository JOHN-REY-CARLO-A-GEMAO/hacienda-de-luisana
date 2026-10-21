import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MIN_PASSWORD_LENGTH, describeAuthError } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import {
  composeFullName,
  todayIso,
  validateBirthdate,
  validateEmail,
  validateNamePart,
  validatePhMobile,
} from '../../lib/validation'
import { LEGAL_VERSION } from '../../lib/legal'
import type { RegisterIntro } from './AuthShell'

/** Matches `MAX_PASSWORD_LENGTH` in `src/lib/auth/credentials.ts`. */
const PASSWORD_MAX = 200

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

type FieldKey =
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'phone'
  | 'email'
  | 'password'
  | 'birthdate'
  | 'acceptTerms'

type FieldErrors = Partial<Record<FieldKey, string>>

/**
 * Guest registration form.
 *
 * Every field is checked, and every problem is shown at once — not one per
 * attempt — each under the field it belongs to. A message goes away the moment
 * its field is edited, and a field can also be checked as the person leaves it.
 *
 * - First name and last name are required; the middle name is optional and may
 *   be an initial. The full name is always built as "First Middle Last".
 * - A Philippine mobile number is required, because the booking form fills
 *   itself from the account and the Hacienda needs a number to reach the Guest.
 * - Email and password each have a Clear button; the password can be shown so a
 *   typo is visible before it becomes a locked-out account.
 */
export function RegisterForm({
  intro,
  email,
  onEmailChange,
  onSuccess,
  onError,
  onInfo,
  onSuggestLogin,
}: RegisterFormProps) {
  const { register } = useAuth()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  function passwordProblem(value: string): string | undefined {
    if (!value) return 'Password is required'
    if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    if (value.length > PASSWORD_MAX) return 'That password is too long to use'
    if (!value.trim()) return 'Password cannot be only spaces'
    return undefined
  }

  /** The problem with one field, or undefined when it is fine. */
  function problemWith(key: FieldKey): string | undefined {
    switch (key) {
      case 'firstName': {
        const res = validateNamePart(firstName, 'First name')
        return res.ok ? undefined : res.message
      }
      case 'middleName': {
        const res = validateNamePart(middleName, 'Middle name', { required: false, min: 1 })
        return res.ok ? undefined : res.message
      }
      case 'lastName': {
        const res = validateNamePart(lastName, 'Last name')
        return res.ok ? undefined : res.message
      }
      case 'phone': {
        const res = validatePhMobile(phone)
        return res.ok ? undefined : res.message
      }
      case 'email': {
        const res = validateEmail(email)
        return res.ok ? undefined : res.message
      }
      case 'password':
        return passwordProblem(password)
      case 'birthdate': {
        const res = validateBirthdate(birthdate)
        return res.ok ? undefined : res.message
      }
      case 'acceptTerms':
        return acceptTerms ? undefined : 'Please accept the Terms and Conditions to create an account.'
    }
  }

  const ALL_FIELDS: FieldKey[] = [
    'firstName',
    'middleName',
    'lastName',
    'phone',
    'email',
    'password',
    'birthdate',
    'acceptTerms',
  ]

  function validateRegisterFields(): FieldErrors {
    const problems: FieldErrors = {}
    for (const key of ALL_FIELDS) {
      const message = problemWith(key)
      if (message) problems[key] = message
    }
    return problems
  }

  /** Edit a field: store the value and drop that field's old message. */
  function edit(key: FieldKey, apply: () => void) {
    apply()
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))
  }

  /** Leave a field: say what is wrong with it now rather than at submit. */
  function checkOnBlur(key: FieldKey) {
    const message = problemWith(key)
    setFieldErrors((current) => ({ ...current, [key]: message }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    onInfo(null)
    onSuggestLogin(false)

    const problems = validateRegisterFields()
    setFieldErrors(problems)
    if (Object.values(problems).some(Boolean)) {
      // Say so above the form too, so a long form on a small screen does not
      // look like a button that did nothing.
      onError('Please fix the highlighted fields and try again.')
      return
    }

    setLoading(true)
    try {
      const first = validateNamePart(firstName, 'First name')
      const middle = validateNamePart(middleName, 'Middle name', { required: false, min: 1 })
      const last = validateNamePart(lastName, 'Last name')
      const mobile = validatePhMobile(phone)
      await register(email, password, {
        firstName: first.ok ? first.value : firstName.trim(),
        middleName: middle.ok && middle.value ? middle.value : undefined,
        lastName: last.ok ? last.value : lastName.trim(),
        phone: mobile.ok ? mobile.value : phone.trim(),
        displayName:
          composeFullName({
            first: first.ok ? first.value : firstName,
            middle: middle.ok ? middle.value : middleName,
            last: last.ok ? last.value : lastName,
          }) || undefined,
        birthdate: birthdate || undefined,
        acceptedTerms: acceptTerms,
      })
      onInfo(intro.successMessage)
      onSuccess?.()
    } catch (err) {
      const described = describeAuthError(err)
      onError(described.message)
      onSuggestLogin(described.code === 'auth/email-already-in-use')
      if (described.code === 'auth/email-already-in-use') {
        setFieldErrors((current) => ({ ...current, email: 'An account with this email already exists.' }))
      }
    } finally {
      setLoading(false)
    }
  }

  const clearButton = (visible: boolean, onClear: () => void, label: string) =>
    visible ? (
      <button
        type="button"
        onClick={onClear}
        aria-label={label}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-forest-600 hover:text-forest-900 px-2 py-1 rounded bg-forest-900/5 hover:bg-forest-900/10 transition"
      >
        Clear
      </button>
    ) : null

  const errorText = (key: FieldKey) =>
    fieldErrors[key] ? (
      <span className="mt-1 block text-xs text-red-600" role="alert">
        {fieldErrors[key]}
      </span>
    ) : null

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Group 1: Your Name */}
      <div className="space-y-4">
        <div className="pb-2 border-b border-forest-900/10">
          <span className="text-xs font-semibold uppercase tracking-eyebrow text-forest-600">Your Name</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">First Name</span>
            <input
              className="field"
              placeholder="Juan"
              value={firstName}
              onChange={(e) => edit('firstName', () => setFirstName(e.target.value))}
              onBlur={() => checkOnBlur('firstName')}
              autoComplete="given-name"
              maxLength={80}
              aria-required="true"
              aria-invalid={fieldErrors.firstName ? true : undefined}
            />
            {errorText('firstName')}
          </label>

          <label className="block">
            <span className="label">Last Name</span>
            <input
              className="field"
              placeholder="Dela Cruz"
              value={lastName}
              onChange={(e) => edit('lastName', () => setLastName(e.target.value))}
              onBlur={() => checkOnBlur('lastName')}
              autoComplete="family-name"
              maxLength={80}
              aria-required="true"
              aria-invalid={fieldErrors.lastName ? true : undefined}
            />
            {errorText('lastName')}
          </label>
        </div>

        <label className="block">
          <span className="label">
            Middle Name <span className="font-normal text-forest-500">(optional)</span>
          </span>
          <input
            className="field"
            placeholder="Santos"
            value={middleName}
            onChange={(e) => edit('middleName', () => setMiddleName(e.target.value))}
            onBlur={() => checkOnBlur('middleName')}
            autoComplete="additional-name"
            maxLength={80}
            aria-invalid={fieldErrors.middleName ? true : undefined}
          />
          {errorText('middleName')}
        </label>

        {composeFullName({ first: firstName, middle: middleName, last: lastName }) && (
          <p className="text-[11px] text-forest-600">
            Your name will appear as:{' '}
            <strong className="font-semibold text-forest-800">
              {composeFullName({ first: firstName, middle: middleName, last: lastName })}
            </strong>
          </p>
        )}
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
                setFieldErrors((current) => (current.email ? { ...current, email: undefined } : current))
              }}
              onBlur={() => checkOnBlur('email')}
              maxLength={254}
              autoComplete="email"
              spellCheck={false}
              aria-required="true"
              aria-invalid={fieldErrors.email ? true : undefined}
            />
            {clearButton(
              Boolean(email),
              () => {
                onEmailChange('')
                setFieldErrors((current) => ({ ...current, email: undefined }))
              },
              'Clear email',
            )}
          </div>
          {errorText('email')}
        </label>

        <label className="block">
          <span className="label">Mobile Phone</span>
          <input
            className="field"
            type="tel"
            inputMode="tel"
            placeholder="09171234567"
            value={phone}
            onChange={(e) => edit('phone', () => setPhone(e.target.value))}
            onBlur={() => checkOnBlur('phone')}
            autoComplete="tel"
            maxLength={16}
            aria-required="true"
            aria-invalid={fieldErrors.phone ? true : undefined}
          />
          <span className="text-[11px] text-forest-600 mt-1 block">
            Philippine format: 09XX XXX XXXX. The booking form fills this in for you.
          </span>
          {errorText('phone')}
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
              className="field pr-32"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => edit('password', () => setPassword(e.target.value))}
              onBlur={() => checkOnBlur('password')}
              maxLength={PASSWORD_MAX}
              autoComplete="new-password"
              aria-required="true"
              aria-invalid={fieldErrors.password ? true : undefined}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="text-xs font-medium text-forest-600 hover:text-forest-900 px-2 py-1 rounded bg-forest-900/5 hover:bg-forest-900/10 transition"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              {password && (
                <button
                  type="button"
                  onClick={() => {
                    setPassword('')
                    setFieldErrors((current) => ({ ...current, password: undefined }))
                  }}
                  aria-label="Clear password"
                  className="text-xs font-medium text-forest-600 hover:text-forest-900 px-2 py-1 rounded bg-forest-900/5 hover:bg-forest-900/10 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                password.length >= MIN_PASSWORD_LENGTH ? 'bg-emerald-50 text-emerald-700' : 'bg-forest-100 text-forest-600'
              }`}
            >
              {password.length >= MIN_PASSWORD_LENGTH ? '✓' : '○'} {MIN_PASSWORD_LENGTH}+ characters
            </span>
          </div>
          {errorText('password')}
        </label>

        <label className="block">
          <span className="label">Date of Birth</span>
          <input
            className="field"
            type="date"
            value={birthdate}
            max={todayIso()}
            onChange={(e) => edit('birthdate', () => setBirthdate(e.target.value))}
            onBlur={() => checkOnBlur('birthdate')}
            aria-required="true"
            aria-invalid={fieldErrors.birthdate ? true : undefined}
          />
          <span className="text-[11px] text-forest-600 mt-1 block">You must be at least 10 years old.</span>
          {errorText('birthdate')}
        </label>
      </div>

      {/* Group 4: Terms */}
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm text-forest-800 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-5 h-5 rounded border-forest-300 text-forest-700 focus:ring-forest-600"
            checked={acceptTerms}
            onChange={(e) => edit('acceptTerms', () => setAcceptTerms(e.target.checked))}
            aria-invalid={fieldErrors.acceptTerms ? true : undefined}
          />
          <span className="leading-relaxed">
            I have read and accept the{' '}
            <Link to="/legal" className="underline underline-offset-2 hover:text-forest-900">
              Terms and Conditions
            </Link>{' '}
            (version {LEGAL_VERSION}).
          </span>
        </label>
        {errorText('acceptTerms')}
      </div>

      <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
        {loading ? 'Please wait…' : intro.submitLabel}
      </button>
    </form>
  )
}
