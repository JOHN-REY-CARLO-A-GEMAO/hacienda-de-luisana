/**
 * The client-side schema — the browser's courtesy check before a request is
 * spent.
 *
 * It is not the security boundary (the worker is), so what is asserted here is
 * that it is *honest*: it normalises before measuring, it refuses rather than
 * repairing, and its numbers are the worker's numbers. The agreement with the
 * worker is checked separately, by importing the worker's own schema, in
 * `contact-worker-contract.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTACT_LIMITS,
  HONEYPOT_FIELD,
  contactFieldErrors,
  contactInquirySchema,
  contactInquirySchemaWithoutTurnstile,
  firstContactError,
  normalizeContactText,
} from '../../src/lib/security/contactInquiry'
import { NAME_MAX, PHONE_MAX_INPUT_LENGTH } from '../../src/lib/validation'

const valid = {
  name: 'Ana Reyes',
  email: 'ana@example.com',
  subject: 'Wedding photoshoot inquiry',
  phone: '09171234567',
  message: 'We would like to ask about a weekend shoot for twelve people.',
  turnstileToken: 'token-abc',
  [HONEYPOT_FIELD]: '',
}

describe('the inquiry schema', () => {
  it('accepts a complete inquiry and normalises it', () => {
    const parsed = contactInquirySchema.safeParse({
      ...valid,
      name: '  Ana   Reyes ',
      email: '  ANA@Example.COM ',
      subject: '  Wedding   shoot  ',
      message: '  Line one.\n\n\n\nLine two.  ',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.name).toBe('Ana Reyes')
    expect(parsed.data.email).toBe('ana@example.com')
    expect(parsed.data.subject).toBe('Wedding shoot')
    // More than two blank lines collapse; the list the Guest chose lines for is
    // still a list.
    expect(parsed.data.message).toBe('Line one.\n\nLine two.')
  })

  it('refuses an empty form with a sentence per field', () => {
    const parsed = contactInquirySchema.safeParse({})
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const fields = contactFieldErrors(parsed.error)
    expect(fields.name).toBe('Please enter your full name')
    expect(fields.email).toBe('Please enter an email')
    expect(fields.subject).toBe('Please enter a subject')
    expect(fields.message).toBe('Message cannot be empty')
    expect(firstContactError(parsed.error)).toBe('Please enter your full name')
  })

  it('refuses markup in every free-text field', () => {
    for (const field of ['name', 'subject', 'message'] as const) {
      const parsed = contactInquirySchema.safeParse({ ...valid, [field]: '<script>alert(1)</script>' })
      expect(parsed.success, field).toBe(false)
    }
  })

  it('strips control characters before measuring, so a padded value is not over the line', () => {
    const atLimit = 'a'.repeat(CONTACT_LIMITS.message.max)
    expect(contactInquirySchema.safeParse({ ...valid, message: `${atLimit}\u0000\u0007` }).success).toBe(true)
    expect(contactInquirySchema.safeParse({ ...valid, message: `${atLimit}b` }).success).toBe(false)
  })

  it('refuses a name with digits and a phone that is not a phone', () => {
    expect(contactInquirySchema.safeParse({ ...valid, name: 'Juan 123' }).success).toBe(false)
    expect(contactInquirySchema.safeParse({ ...valid, phone: 'call me maybe' }).success).toBe(false)
    expect(contactInquirySchema.safeParse({ ...valid, phone: '' }).success).toBe(true)
    expect(contactInquirySchema.safeParse({ ...valid, phone: '+63 (917) 123-4567' }).success).toBe(true)
  })

  it('refuses a key the worker does not know — including the old form’s timer', () => {
    // `form_started_at` was sent when the endpoint was a Cloud Function; the
    // worker's schema is strict, so sending it now would be a 400 on every send.
    const parsed = contactInquirySchema.safeParse({ ...valid, form_started_at: Date.now() })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(contactFieldErrors(parsed.error)._form).toBeTruthy()
  })

  it('requires the bot check token when the widget is configured', () => {
    const withoutToken = contactInquirySchema.safeParse({ ...valid, turnstileToken: '' })
    expect(withoutToken.success).toBe(false)
    if (withoutToken.success) return
    expect(contactFieldErrors(withoutToken.error).turnstileToken).toContain('bot check')

    // …and does not require one in a build that has no widget at all, because
    // there is nothing that could produce it.
    expect(contactInquirySchemaWithoutTurnstile.safeParse({ ...valid, turnstileToken: '' }).success).toBe(true)
  })

  it('never judges the honeypot — that is the worker’s decision', () => {
    // A populated trap has to reach the endpoint: the endpoint is what answers it
    // with a fake success, and blocking here would lose a real inquiry filled in
    // by a password manager without telling anybody.
    expect(contactInquirySchema.safeParse({ ...valid, [HONEYPOT_FIELD]: 'https://spam' }).success).toBe(true)
  })
})

describe('the numbers', () => {
  it('matches the worker’s ceilings', () => {
    expect(CONTACT_LIMITS.name).toEqual({ min: 2, max: 80 })
    expect(CONTACT_LIMITS.email.max).toBe(100)
    expect(CONTACT_LIMITS.message).toEqual({ min: 10, max: 2000 })
    expect(CONTACT_LIMITS.subject.max).toBe(120)
    expect(CONTACT_LIMITS.phone.max).toBe(20)
  })

  it('does not exceed the site-wide limits the rest of the website enforces', () => {
    // A contact field must never be wider than the shared constant it overlaps
    // with, or a Guest could type something one page accepts and another refuses.
    expect(CONTACT_LIMITS.name.max).toBe(NAME_MAX)
    expect(CONTACT_LIMITS.phone.max).toBe(PHONE_MAX_INPUT_LENGTH)
    // The email ceiling is *narrower* than the site-wide 120 on purpose: Resend
    // and the worker set the real limit, and a box that allowed more would be a
    // dead end.
    expect(CONTACT_LIMITS.email.max).toBeLessThan(120)
  })
})

describe('normalisation', () => {
  it('keeps one script’s worth of letters equal to another', () => {
    expect(normalizeContactText('Jose\u0301')).toBe('José')
    expect(normalizeContactText('  Ana\tReyes\n')).toBe('Ana Reyes')
    expect(normalizeContactText('\u0000\u0001')).toBe('')
  })
})
