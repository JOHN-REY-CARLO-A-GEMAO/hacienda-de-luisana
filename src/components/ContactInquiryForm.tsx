import React, { useState } from 'react'
import { Alert, Field, Input, Textarea } from './ui'
import {
  EMAIL_MAX,
  INQUIRY_MESSAGE_MIN,
  NAME_MAX,
  PHONE_MAX_INPUT_LENGTH,
  SUBJECT_MAX_LENGTH,
  MESSAGE_MAX,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateEmail,
  validateInquiryMessage,
  validateName,
  validatePhMobile,
  validateSubject,
} from '../lib/validation'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { ArrowRight, MessageCircle } from '../lib/icons'

export function ContactInquiryForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}

    const nameRes = validateName(name)
    if (!nameRes.ok) errs.name = nameRes.message

    const emailRes = validateEmail(email)
    if (!emailRes.ok) errs.email = emailRes.message

    if (phone.trim()) {
      const phoneRes = validatePhMobile(phone)
      if (!phoneRes.ok) errs.phone = phoneRes.message
    }

    const subjectRes = validateSubject(subject)
    if (!subjectRes.ok) errs.subject = subjectRes.message

    const messageRes = validateInquiryMessage(message)
    if (!messageRes.ok) errs.message = messageRes.message

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (!validate()) {
      setSubmitError('Please correct the highlighted form errors before sending your inquiry.')
      return
    }

    const limited = checkRateLimit('inquiry', LIMITS.inquiry)
    if (!limited.ok) {
      setSubmitError(limited.message)
      return
    }

    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setSubmitted(true)
      setName('')
      setEmail('')
      setPhone('')
      setSubject('')
      setMessage('')
      setErrors({})
      setSubmitError(null)
    }, 400)
  }

  if (submitted) {
    return (
      <Alert tone="success" title="Inquiry sent." className="p-6 sm:p-8">
        <p className="max-w-md text-sm leading-relaxed">
          Thank you for reaching out to Hacienda de LuisAna. The Hacienda will review your message and
          reply by email or phone within the day.
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

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Full name" required error={errors.name}>
          <Input
            placeholder="Juan Dela Cruz"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              const clean = sanitizeNameInput(e.target.value)
              setName(clean)
              if (errors.name) setErrors((prev) => ({ ...prev, name: '' }))
            }}
            onKeyDown={(e) => {
              if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
            }}
            autoComplete="name"
            invalid={Boolean(errors.name)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email address" required error={errors.email}>
            <Input
              type="email"
              placeholder="you@email.com"
              value={email}
              maxLength={EMAIL_MAX}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errors.email) setErrors((prev) => ({ ...prev, email: '' }))
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
              maxLength={PHONE_MAX_INPUT_LENGTH}
              onChange={(e) => {
                const clean = sanitizePhoneInput(e.target.value)
                setPhone(clean)
                if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }))
              }}
              onKeyDown={(e) => {
                if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
              }}
              autoComplete="tel"
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
              <span className={`font-mono tabular-nums ${subject.length >= SUBJECT_MAX_LENGTH ? 'font-semibold text-amber-700' : ''}`}>
                {subject.length} / {SUBJECT_MAX_LENGTH} characters
              </span>
            </span>
          }
        >
          <Input
            placeholder="e.g. Wedding photoshoot inquiry, Weekend booking"
            value={subject}
            maxLength={SUBJECT_MAX_LENGTH}
            onChange={(e) => {
              setSubject(e.target.value.slice(0, SUBJECT_MAX_LENGTH))
              if (errors.subject) setErrors((prev) => ({ ...prev, subject: '' }))
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
              <span>Minimum {INQUIRY_MESSAGE_MIN} characters</span>
              <span
                className={`font-mono tabular-nums ${message.length >= MESSAGE_MAX ? 'font-semibold text-amber-700' : ''}`}
                aria-live="polite"
              >
                {message.length} / {MESSAGE_MAX} characters
              </span>
            </span>
          }
        >
          <Textarea
            className="min-h-[110px] resize-y"
            placeholder="Describe your inquiry, planned dates, number of attendees, or special requests…"
            value={message}
            maxLength={MESSAGE_MAX}
            onChange={(e) => {
              setMessage(e.target.value.slice(0, MESSAGE_MAX))
              if (errors.message) setErrors((prev) => ({ ...prev, message: '' }))
            }}
            invalid={Boolean(errors.message)}
          />
        </Field>

        {submitError && (
          <Alert tone="danger" className="text-xs">
            {submitError}
          </Alert>
        )}

        <button
          type="submit"
          disabled={loading || Object.keys(errors).some((k) => Boolean(errors[k]))}
          className="btn-primary w-full sm:w-auto"
        >
          {loading ? 'Sending inquiry…' : 'Send inquiry'}
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  )
}
