import React, { useState } from 'react'
import {
  EMAIL_MAX,
  NAME_MAX,
  SUBJECT_MAX_LENGTH,
  MESSAGE_MAX,
  sanitizeNameInput,
  sanitizePhoneInput,
  validateEmail,
  validateName,
  validatePhMobile,
  validateSubject,
  validateMessage,
} from '../lib/validation'
import { ArrowRight, CheckCircle, MessageCircle } from '../lib/icons'

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

    const messageRes = validateMessage(message)
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
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8 text-center text-emerald-950">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 mb-3">
          <CheckCircle size={28} />
        </div>
        <h3 className="font-serif text-2xl text-emerald-900">Inquiry Sent</h3>
        <p className="mt-2 text-sm text-emerald-800/80 max-w-md mx-auto leading-relaxed">
          Thank you for reaching out to Hacienda de LuisAna. Our concierge will review your message and reply via email or phone within the day.
        </p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="btn-secondary mt-5 text-xs inline-flex"
        >
          Send another inquiry
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-3xl border border-forest-900/10 bg-white p-6 sm:p-8 shadow-card">
      <div className="flex items-center gap-3 text-forest-900 mb-2">
        <div className="w-9 h-9 rounded-xl bg-forest-50 text-forest-700 flex items-center justify-center">
          <MessageCircle size={18} />
        </div>
        <div>
          <div className="eyebrow text-forest-600">Online Message</div>
          <h3 className="font-serif text-2xl text-forest-900">Send an Inquiry</h3>
        </div>
      </div>
      <p className="text-sm text-forest-700/80 mb-6">
        Have specific questions about event bookings, accommodation details, or special arrangements? Leave a note and we will get back to you promptly.
      </p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Full Name */}
        <label className="block">
          <span className="label">Full Name *</span>
          <input
            className="field"
            placeholder="Juan Dela Cruz"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              const clean = sanitizeNameInput(e.target.value)
              setName(clean)
              if (errors.name) setErrors((prev) => ({ ...prev, name: '' }))
            }}
            onKeyDown={(e) => {
              if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
              }
            }}
            autoComplete="name"
          />
          {errors.name && <span className="mt-1 block text-xs text-red-600">{errors.name}</span>}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Email Address */}
          <label className="block">
            <span className="label">Email Address *</span>
            <input
              className="field"
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
            />
            {errors.email && <span className="mt-1 block text-xs text-red-600">{errors.email}</span>}
          </label>

          {/* Mobile Phone */}
          <label className="block">
            <span className="label">Mobile Phone (optional)</span>
            <input
              className="field"
              type="tel"
              inputMode="tel"
              placeholder="09171234567"
              value={phone}
              maxLength={20}
              onChange={(e) => {
                const clean = sanitizePhoneInput(e.target.value)
                setPhone(clean)
                if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }))
              }}
              onKeyDown={(e) => {
                if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault()
                }
              }}
              autoComplete="tel"
            />
            {errors.phone && <span className="mt-1 block text-xs text-red-600">{errors.phone}</span>}
          </label>
        </div>

        {/* Subject */}
        <label className="block">
          <span className="label">Subject *</span>
          <input
            className="field"
            placeholder="e.g. Wedding photoshoot inquiry, Weekend booking"
            value={subject}
            maxLength={SUBJECT_MAX_LENGTH}
            onChange={(e) => {
              setSubject(e.target.value.slice(0, SUBJECT_MAX_LENGTH))
              if (errors.subject) setErrors((prev) => ({ ...prev, subject: '' }))
            }}
          />
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-forest-600/70">At least 3 characters</span>
            <span
              className={`font-mono tabular-nums ${
                subject.length >= SUBJECT_MAX_LENGTH ? 'text-amber-700 font-semibold' : 'text-forest-600/70'
              }`}
            >
              {subject.length} / {SUBJECT_MAX_LENGTH} characters
            </span>
          </div>
          {errors.subject && <span className="mt-1 block text-xs text-red-600">{errors.subject}</span>}
        </label>

        {/* Message */}
        <label className="block">
          <span className="label">Message *</span>
          <textarea
            className="field min-h-[110px] resize-y text-sm"
            placeholder="Describe your inquiry, planned dates, number of attendees, or special requests…"
            value={message}
            maxLength={MESSAGE_MAX}
            onChange={(e) => {
              setMessage(e.target.value.slice(0, MESSAGE_MAX))
              if (errors.message) setErrors((prev) => ({ ...prev, message: '' }))
            }}
          />
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-forest-600/70">Minimum 10 characters</span>
            <span
              className={`font-mono tabular-nums transition-colors ${
                message.length >= MESSAGE_MAX
                  ? 'text-amber-700 font-semibold'
                  : message.length >= MESSAGE_MAX * 0.9
                    ? 'text-amber-600 font-medium'
                    : 'text-forest-600/70'
              }`}
              aria-live="polite"
            >
              {message.length} / {MESSAGE_MAX} characters
            </span>
          </div>
          {errors.message && <span className="mt-1 block text-xs text-red-600">{errors.message}</span>}
        </label>

        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || Object.keys(errors).some((k) => Boolean(errors[k]))}
          className="btn-primary text-xs w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Sending inquiry…' : 'Send Inquiry'}
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  )
}
