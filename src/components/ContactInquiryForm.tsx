import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Field, Input, Textarea } from './ui'
import { EMAIL_MAX, NAME_MAX, sanitizeNameInput, sanitizePhoneInput } from '../lib/validation'
import {
  CONTACT_LIMITS,
  HONEYPOT_FIELD,
  contactFieldErrors,
  contactInquirySchema,
  contactInquirySchemaWithoutTurnstile,
  type ContactFieldErrors,
} from '../lib/security/contactInquiry'
import { contactEndpoint, submitInquiry } from '../lib/inquiryApi'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { TurnstileWidget, isTurnstileConfigured } from './security/TurnstileWidget'
import { ArrowRight, CheckCircle, MessageCircle } from '../lib/icons'

/** The fields a Guest can see. The trap and the token are not among them. */
type VisibleField = 'name' | 'email' | 'phone' | 'subject' | 'message'
const VISIBLE_FIELDS: VisibleField[] = ['name', 'email', 'phone', 'subject', 'message']

/** Only the errors that belong under a visible input. */
function visibleErrors(errors: ContactFieldErrors): Partial<Record<VisibleField, string>> {
  const shown: Partial<Record<VisibleField, string>> = {}
  for (const key of VISIBLE_FIELDS) {
    const message = errors[key]
    if (message) shown[key] = message
  }
  return shown
}

/**
 * The public inquiry form — the one endpoint a stranger can reach.
 *
 * Where the request goes: a Cloudflare Worker (`workers/contact-inquiry/`), not
 * Firebase. The project is on the Spark plan, which cannot deploy Cloud Functions,
 * and a public form is the one thing here that genuinely needs a server. The
 * worker validates this body again with its own zod schema, verifies the
 * Turnstile token, counts the request against the IP and emails the Hacienda
 * through Resend.
 *
 * Three things this form is careful about:
 *
 *   - **It does not lie.** Success is shown only when the worker answered 200.
 *     A 429 shows the wait and disables the button for it; a field error goes
 *     under the field the worker named; a dropped connection says so and keeps
 *     every word the Guest typed.
 *   - **The trap is invisible and never judged here.** `hdl_extra` is off-screen,
 *     unlabelled and unfocusable. The browser sends it; the worker decides. If
 *     this component blocked on it, a password manager filling the hidden box
 *     would lose somebody's inquiry without telling them.
 *   - **A missing bot check is stated, not hidden.** With a worker URL but no
 *     Turnstile site key, the form cannot produce the token the worker requires,
 *     so it says that instead of letting every submission 400.
 */
export function ContactInquiryForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [errors, setErrors] = useState<Partial<Record<VisibleField, string>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** The trap. Never shown, never focusable, never read by a human. */
  const [honeypot, setHoneypot] = useState('')
  /** The Turnstile token. Cleared on expiry, on a refusal, and after a send. */
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)

  /** A worker 429 (or a local cooldown) becomes a wall clock, not a flag. */
  const [blockedUntil, setBlockedUntil] = useState(0)
  const [tick, setTick] = useState(() => Date.now())
  const blockedMs = Math.max(0, blockedUntil - tick)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  const endpoint = contactEndpoint()
  const turnstileReady = isTurnstileConfigured()
  const schema = turnstileReady ? contactInquirySchema : contactInquirySchemaWithoutTurnstile
  /** A real endpoint with no widget cannot satisfy the worker's token rule. */
  const botCheckMissing = endpoint !== null && !turnstileReady
  const isBlocked = blockedMs > 0
  const blockedSeconds = Math.ceil(blockedMs / 1000)

  useEffect(() => {
    if (blockedUntil === 0) return
    const timer = setInterval(() => setTick(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [blockedUntil])

  useEffect(() => {
    if (blockedUntil !== 0 && blockedMs === 0) setBlockedUntil(0)
  }, [blockedMs, blockedUntil])

  const payload = useMemo(
    () => ({
      name,
      email,
      subject,
      phone,
      message,
      turnstileToken,
      [HONEYPOT_FIELD]: honeypot,
    }),
    [name, email, subject, phone, message, turnstileToken, honeypot],
  )

  const clearError = (field: VisibleField) => {
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const focusFirst = (fields: Partial<Record<VisibleField, string>>) => {
    const first = VISIBLE_FIELDS.find((field) => fields[field])
    if (first === 'name') nameRef.current?.focus()
    if (first === 'email') emailRef.current?.focus()
    if (first === 'subject') subjectRef.current?.focus()
    if (first === 'message') messageRef.current?.focus()
  }

  const startCooldown = (seconds: number, message: string) => {
    setBlockedUntil(Date.now() + seconds * 1_000)
    setTick(Date.now())
    setSubmitError(message)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading || isBlocked || botCheckMissing) return
    setSubmitError(null)

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      const next = visibleErrors(contactFieldErrors(parsed.error))
      setErrors(next)
      const formLevel = contactFieldErrors(parsed.error)
      setSubmitError(
        Object.keys(next).length > 0
          ? 'Please correct the highlighted form errors before sending your inquiry.'
          : formLevel.turnstileToken ?? 'Please complete the bot check before sending.',
      )
      focusFirst(next)
      return
    }

    // The cooldown is spent only by a submission the browser would send: a typo
    // must not cost a Guest one of five attempts. The worker re-checks anyway.
    const cooldown = checkRateLimit('contact:inquiry', LIMITS.contact)
    if (!cooldown.ok) {
      startCooldown(Math.ceil(cooldown.retryAfterMs / 1000), cooldown.message)
      return
    }

    setErrors({})
    setLoading(true)
    try {
      const result = await submitInquiry(parsed.data)
      if (result.ok) {
        setDemo(result.demo)
        setSubmitted(true)
        setName('')
        setEmail('')
        setPhone('')
        setSubject('')
        setMessage('')
        setHoneypot('')
        setTurnstileToken('')
        setTurnstileReset((value) => value + 1)
        setErrors({})
        setSubmitError(null)
        return
      }

      if (result.kind === 'validation') {
        const next = visibleErrors(result.fields)
        setErrors(next)
        setSubmitError(Object.keys(next).length > 0
          ? 'Please correct the highlighted form errors before sending your inquiry.'
          : result.message)
        focusFirst(next)
      } else if (result.kind === 'rate_limited') {
        startCooldown(result.retryAfterSeconds, result.message)
      } else if (result.kind === 'bot') {
        setSubmitError(result.message)
        // A Turnstile token is single-use, and this one was spent on a refusal.
        setTurnstileToken('')
        setTurnstileReset((value) => value + 1)
      } else {
        setSubmitError(result.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <Alert
        tone={demo ? 'warning' : 'success'}
        title={demo ? 'Kept in this browser (demo mode).' : 'Inquiry sent.'}
        className="p-6 sm:p-8"
      >
        <p className="max-w-md text-sm leading-relaxed">
          {demo
            ? 'This build has no contact endpoint configured, so your inquiry was kept in this browser only and has not reached the estate. Set VITE_CONTACT_WORKER_URL (and deploy the worker) to send it for real.'
            : 'Thank you for reaching out to Hacienda de LuisAna. The Hacienda will review your message and reply by email or phone within the day.'}
        </p>
        <button type="button" onClick={() => setSubmitted(false)} className="btn-quiet btn-sm mt-4">
          Send another inquiry
        </button>
      </Alert>
    )
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest-50 text-forest-700" aria-hidden="true">
          <MessageCircle size={18} />
        </span>
        <h3 className="h3">Send an inquiry</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-forest-700/80">
        A question about an event, an accommodation, or a special arrangement? Leave a note and the
        Hacienda will get back to you.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4" aria-busy={loading}>
        {/*
          The honeypot. Off-screen rather than `display:none`, because some form
          fillers skip what is not laid out and fill everything else. `aria-hidden`
          and `tabIndex={-1}` keep it away from a screen reader and from the tab
          order; `autoComplete="off"` keeps a password manager out of it.
        */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label>
            Leave this field empty
            <input
              type="text"
              name={HONEYPOT_FIELD}
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
              data-testid="contact-honeypot"
            />
          </label>
        </div>

        <Field label="Full name" required error={errors.name}>
          <Input
            ref={nameRef}
            placeholder="Juan Dela Cruz"
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(sanitizeNameInput(event.target.value))
              clearError('name')
            }}
            onKeyDown={(event) => {
              if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault()
            }}
            autoComplete="name"
            invalid={Boolean(errors.name)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Email address"
            required
            error={errors.email}
            hint={`Up to ${CONTACT_LIMITS.email.max} characters.`}
          >
            <Input
              ref={emailRef}
              type="email"
              placeholder="you@email.com"
              value={email}
              // The worker's ceiling, not the site-wide EMAIL_MAX: an address this
              // box accepted and the endpoint refused would be a dead end.
              maxLength={Math.min(EMAIL_MAX, CONTACT_LIMITS.email.max)}
              onChange={(event) => {
                setEmail(event.target.value)
                clearError('email')
              }}
              autoComplete="email"
              spellCheck={false}
              invalid={Boolean(errors.email)}
            />
          </Field>

          <Field label="Mobile phone" hint="Optional." error={errors.phone}>
            <Input
              type="tel"
              inputMode="tel"
              placeholder="09171234567"
              value={phone}
              maxLength={CONTACT_LIMITS.phone.max}
              onChange={(event) => {
                setPhone(sanitizePhoneInput(event.target.value))
                clearError('phone')
              }}
              onKeyDown={(event) => {
                if (/^[a-zA-Z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault()
              }}
              autoComplete="tel"
              invalid={Boolean(errors.phone)}
            />
          </Field>
        </div>

        <Field
          label="Subject"
          required
          error={errors.subject}
          hint={
            <span className="flex items-center justify-between gap-3">
              <span>At least 3 characters</span>
              <span className={`font-mono tabular-nums ${subject.length >= CONTACT_LIMITS.subject.max ? 'font-semibold text-amber-700' : ''}`}>
                {subject.length} / {CONTACT_LIMITS.subject.max} characters
              </span>
            </span>
          }
        >
          <Input
            ref={subjectRef}
            placeholder="e.g. Wedding photoshoot inquiry, Weekend booking"
            value={subject}
            maxLength={CONTACT_LIMITS.subject.max}
            onChange={(event) => {
              setSubject(event.target.value.slice(0, CONTACT_LIMITS.subject.max))
              clearError('subject')
            }}
            invalid={Boolean(errors.subject)}
          />
        </Field>

        <Field
          label="Message"
          required
          error={errors.message}
          hint={
            <span className="flex items-center justify-between gap-3">
              <span>Minimum {CONTACT_LIMITS.message.min} characters</span>
              <span
                className={`font-mono tabular-nums ${message.length >= CONTACT_LIMITS.message.max ? 'font-semibold text-amber-700' : ''}`}
                aria-live="polite"
              >
                {message.length} / {CONTACT_LIMITS.message.max} characters
              </span>
            </span>
          }
        >
          <Textarea
            ref={messageRef}
            className="min-h-[110px] resize-y"
            placeholder="Describe your inquiry, planned dates, number of attendees, or special requests…"
            value={message}
            maxLength={CONTACT_LIMITS.message.max}
            onChange={(event) => {
              setMessage(event.target.value.slice(0, CONTACT_LIMITS.message.max))
              clearError('message')
            }}
            invalid={Boolean(errors.message)}
          />
        </Field>

        <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} action="contact-inquiry" />

        {botCheckMissing && (
          <Alert tone="warning" title="The bot check is not configured." className="text-sm">
            <p>
              This form cannot send until a Turnstile site key is set for the site
              (<code className="font-mono text-xs">VITE_TURNSTILE_SITE_KEY</code>), because the contact
              endpoint requires one. Please write to the Hacienda directly in the meantime.
            </p>
          </Alert>
        )}

        {isBlocked && (
          <Alert tone="warning" title="Please wait before trying again." className="text-sm">
            <p>{submitError ?? "You've submitted too many times."}</p>
            <p className="mt-1">
              You can send another in <strong className="tabular-nums">{blockedSeconds}s</strong>.
            </p>
          </Alert>
        )}

        {submitError && !isBlocked && !botCheckMissing && (
          <Alert tone="danger" className="text-xs">
            {submitError}
          </Alert>
        )}

        <button
          type="submit"
          disabled={loading || isBlocked || botCheckMissing}
          className="btn-primary w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Sending inquiry…' : isBlocked ? `Try again in ${blockedSeconds}s` : 'Send inquiry'}
          {!loading && !isBlocked && !botCheckMissing && <ArrowRight size={16} />}
        </button>

        <p className="text-xs leading-relaxed text-forest-700/60">
          <CheckCircle size={12} className="mr-1 inline align-[-1px]" aria-hidden="true" />
          Your details are used only to answer this inquiry.
        </p>
      </form>
    </div>
  )
}
