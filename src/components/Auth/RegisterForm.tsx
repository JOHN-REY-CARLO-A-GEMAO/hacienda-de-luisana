import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MIN_PASSWORD_LENGTH, describeAuthError } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import {
  EMAIL_MAX,
  NAME_MAX,
  PHONE_MAX_INPUT_LENGTH,
  composeFullName,
  sanitizeNameInput,
  sanitizePhoneInput,
  todayIso,
  validateBirthdate,
  validateEmail,
  validateNamePart,
  validatePhMobile,
} from '../../lib/validation'
import { LIMITS, checkRateLimit } from '../../lib/rateLimit'
import { LEGAL_VERSION } from '../../lib/legal'
import type { RegisterIntro } from './AuthShell'
import { CheckboxRow, Field, Input } from '../ui'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement | string, options: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback': () => void
      }) => number
      remove: (widgetId: number) => void
    }
  }
}

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
  const emailId = useId()
  const passwordId = useId()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<number | null>(null)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)

  const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY

  // Render the Turnstile widget explicitly when the script and container are ready.
  useEffect(() => {
    if (!siteKey || !turnstileContainerRef.current || !window.turnstile) return
    const id = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
    })
    setTurnstileWidgetId(id)
    return () => {
      if (turnstileWidgetId !== null) {
        window.turnstile.remove(turnstileWidgetId)
      }
    }
  }, [siteKey])

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

    const rateLimit = checkRateLimit('register', LIMITS.register)
    if (!rateLimit.ok) {
      onError(rateLimit.message)
      return
    }

    // Turnstile is enforced only when a site key is configured.
    if (siteKey && !turnstileToken) {
      onError('Please complete the verification before creating an account.')
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
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-forest-900/5 px-2 py-1 text-xs font-medium text-forest-600 transition hover:bg-forest-900/10 hover:text-forest-900 dark:bg-cream-100/10 dark:text-cream-100 dark:hover:bg-cream-100/20"
      >
        Clear
      </button>
    ) : null

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* One group heading per question the form asks, not per field. */}
      <fieldset className="space-y-4">
        <legend className="mb-3 w-full border-b border-forest-900/10 pb-2 text-xs font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">
          Your name
        </legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName}>
            <Input
              placeholder="Juan"
              value={firstName}
              onChange={(e) => edit('firstName', () => setFirstName(sanitizeNameInput(e.target.value)))}
              onBlur={() => checkOnBlur('firstName')}
              autoComplete="given-name"
              maxLength={NAME_MAX}
              aria-required="true"
              invalid={Boolean(fieldErrors.firstName)}
            />
          </Field>

          <Field label="Last name" required error={fieldErrors.lastName}>
            <Input
              placeholder="Dela Cruz"
              value={lastName}
              onChange={(e) => edit('lastName', () => setLastName(sanitizeNameInput(e.target.value)))}
              onBlur={() => checkOnBlur('lastName')}
              autoComplete="family-name"
              maxLength={NAME_MAX}
              aria-required="true"
              invalid={Boolean(fieldErrors.lastName)}
            />
          </Field>
        </div>

        <Field label="Middle name" hint="Optional — an initial is enough." error={fieldErrors.middleName}>
          <Input
            placeholder="Santos"
            value={middleName}
            onChange={(e) => edit('middleName', () => setMiddleName(sanitizeNameInput(e.target.value)))}
            onBlur={() => checkOnBlur('middleName')}
            autoComplete="additional-name"
            maxLength={NAME_MAX}
            invalid={Boolean(fieldErrors.middleName)}
          />
        </Field>

        {composeFullName({ first: firstName, middle: middleName, last: lastName }) && (
          <p className="text-[11px] text-forest-600 dark:text-sage-400">
            Your name will appear as:{' '}
            <strong className="font-semibold text-forest-800 dark:text-cream-100">
              {composeFullName({ first: firstName, middle: middleName, last: lastName })}
            </strong>
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 w-full border-b border-forest-900/10 pb-2 text-xs font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">
          How the Hacienda reaches you
        </legend>

        <Field label="Email" required error={fieldErrors.email} controlId={emailId}>
          <div className="relative">
            <Input
              id={emailId}
              aria-describedby={fieldErrors.email ? `${emailId}-message` : undefined}
              className="pr-16"
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => {
                onEmailChange(e.target.value)
                setFieldErrors((current) => (current.email ? { ...current, email: undefined } : current))
              }}
              onBlur={() => checkOnBlur('email')}
              maxLength={EMAIL_MAX}
              autoComplete="email"
              spellCheck={false}
              aria-required="true"
              invalid={Boolean(fieldErrors.email)}
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
        </Field>

        <Field
          label="Mobile phone"
          required
          error={fieldErrors.phone}
          hint="Philippine format: 09XX XXX XXXX. The booking form fills this in for you."
        >
          <Input
            type="tel"
            inputMode="tel"
            placeholder="09171234567"
            value={phone}
            onChange={(e) => edit('phone', () => setPhone(sanitizePhoneInput(e.target.value)))}
            onBlur={() => checkOnBlur('phone')}
            autoComplete="tel"
            maxLength={PHONE_MAX_INPUT_LENGTH}
            aria-required="true"
            invalid={Boolean(fieldErrors.phone)}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 w-full border-b border-forest-900/10 pb-2 text-xs font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">
          Securing your account
        </legend>

        <Field
          label="Password"
          required
          controlId={passwordId}
          error={fieldErrors.password}
          hint={
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                password.length >= MIN_PASSWORD_LENGTH ? 'bg-emerald-50 text-emerald-700' : 'bg-forest-100 text-forest-600'
              }`}
            >
              {password.length >= MIN_PASSWORD_LENGTH ? '✓' : '○'} {MIN_PASSWORD_LENGTH}+ characters
            </span>
          }
        >
          <div className="relative">
            <Input
              id={passwordId}
              aria-describedby={`${passwordId}-message`}
              className="pr-32"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => edit('password', () => setPassword(e.target.value))}
              onBlur={() => checkOnBlur('password')}
              maxLength={PASSWORD_MAX}
              autoComplete="new-password"
              aria-required="true"
              invalid={Boolean(fieldErrors.password)}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="rounded-md bg-forest-900/5 px-2 py-1 text-xs font-medium text-forest-600 transition hover:bg-forest-900/10 hover:text-forest-900 dark:bg-cream-100/10 dark:text-cream-100 dark:hover:bg-cream-100/20"
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
                  className="rounded-md bg-forest-900/5 px-2 py-1 text-xs font-medium text-forest-600 transition hover:bg-forest-900/10 hover:text-forest-900 dark:bg-cream-100/10 dark:text-cream-100 dark:hover:bg-cream-100/20"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </Field>

        <Field label="Date of birth" required error={fieldErrors.birthdate} hint="You must be at least 10 years old.">
          <Input
            type="date"
            value={birthdate}
            max={todayIso()}
            onChange={(e) => edit('birthdate', () => setBirthdate(e.target.value))}
            onBlur={() => checkOnBlur('birthdate')}
            aria-required="true"
            invalid={Boolean(fieldErrors.birthdate)}
          />
        </Field>
      </fieldset>

      <div className="space-y-3">
        <CheckboxRow className="dark:text-cream-100" checked={acceptTerms} onChange={(checked) => edit('acceptTerms', () => setAcceptTerms(checked))}>
          I have read and accept the{' '}
          <Link to="/legal" className="text-link">
            Terms and Conditions
          </Link>{' '}
          (version {LEGAL_VERSION}).
        </CheckboxRow>
        {fieldErrors.acceptTerms && (
          <span className="field-error" role="alert">
            {fieldErrors.acceptTerms}
          </span>
        )}
      </div>

      {siteKey && (
        <div className="space-y-3">
          <div ref={turnstileContainerRef} className="turnstile-widget" />
          <span className="text-xs text-forest-500 dark:text-sage-400 leading-relaxed">
            Completing the verification helps keep this form free of spam.
          </span>
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
        {loading ? 'Please wait…' : intro.submitLabel}
      </button>
    </form>
  )
}
