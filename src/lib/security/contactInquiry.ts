/**
 * The contact inquiry, as the browser checks it — before it is sent.
 * Hacienda de LuisAna
 * ----------------------------------------------------------------------------
 * The **authority** for this form is the Cloudflare Worker
 * (`workers/contact-inquiry/src/schema.ts`), not this file: whatever the browser
 * thinks, the worker parses the request again and refuses anything it does not
 * like. This schema exists so a Guest is told about a two-character name before
 * a request is spent, not because the browser can be trusted.
 *
 * Its numbers are therefore the worker's numbers, and
 * `test/web/contact-worker-contract.test.ts` imports the worker's own `LIMITS`
 * and asserts the two agree. That test is the reason the constants are duplicated
 * rather than derived: this module is bundled for the browser, importing a file
 * from `workers/` into the app would drag a server contract into the client
 * bundle, and a comment saying "keep these in sync" is not a mechanism.
 *
 * What changed when the form moved off Cloud Functions (ADR-0024): the field set
 * and the ceilings are the worker's (`message` is 2,000 rather than the site-wide
 * 1,000 that chat uses), and there is no `form_started_at` — the worker's bot
 * defence is Turnstile, and its schema is `.strict()`, so an extra key is a 400.
 */
import { z } from 'zod'

/**
 * The contract, field by field. Mirrors `LIMITS` in the worker.
 *
 * `email` is 100, not the site-wide `EMAIL_MAX` of 120: the worker's Resend call
 * sets the real ceiling, and a browser that allowed 120 would let a Guest type an
 * address the endpoint then refuses.
 */
export const CONTACT_LIMITS = {
  name: { min: 2, max: 80 },
  email: { max: 100 },
  message: { min: 10, max: 2000 },
  subject: { max: 120 },
  phone: { max: 20 },
  honeypot: { max: 0 },
  turnstileToken: { max: 4096 },
} as const

/** The trap field's name. Deliberately not `website`/`company`/`bot`: password
 * managers autofill those, and a false positive loses a real inquiry. */
export const HONEYPOT_FIELD = 'hdl_extra' as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_SHAPE_RE = /^[0-9+\-()\s]{7,20}$/
/** Control characters: never text, and a paste can carry them. */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
const MARKUP_RE = /[<>]/

/** NFC, controls out, whitespace collapsed, trimmed — in that order, because
 * removing a control character can leave two spaces that were not there. */
export function normalizeContactText(value: string): string {
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Does a value contain the two characters a tag begins with? */
export function containsMarkup(value: string): boolean {
  return MARKUP_RE.test(value)
}

const nameField = z
  .string({ required_error: 'Please enter your full name', invalid_type_error: 'Name must be text' })
  .transform(normalizeContactText)
  .refine((value) => value !== '', 'Please enter your full name')
  .refine((value) => value.length >= CONTACT_LIMITS.name.min, 'Name looks too short')
  .refine((value) => value.length <= CONTACT_LIMITS.name.max, `Name must be at most ${CONTACT_LIMITS.name.max} characters`)
  .refine((value) => !/\d/.test(value), 'Name cannot contain numbers')
  .refine((value) => !containsMarkup(value), 'Name cannot contain < or >')

const emailField = z
  .string({ required_error: 'Please enter an email', invalid_type_error: 'Email must be text' })
  .transform((value) => normalizeContactText(value).toLowerCase())
  .refine((value) => value !== '', 'Please enter an email')
  .refine((value) => value.length <= CONTACT_LIMITS.email.max, `Email must be at most ${CONTACT_LIMITS.email.max} characters`)
  .refine((value) => EMAIL_RE.test(value), "That doesn't look like a valid email")

/** Multi-line, so it keeps its line breaks: a list of dates is a real inquiry. */
const messageField = z
  .string({ required_error: 'Message cannot be empty', invalid_type_error: 'Message must be text' })
  .transform((value) =>
    value
      .normalize('NFC')
      .replace(CONTROL_CHARS_RE, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
  .refine((value) => value !== '', 'Message cannot be empty')
  .refine((value) => value.length >= CONTACT_LIMITS.message.min, `Message must be at least ${CONTACT_LIMITS.message.min} characters — tell us a little more`)
  .refine((value) => value.length <= CONTACT_LIMITS.message.max, `Message must be at most ${CONTACT_LIMITS.message.max} characters`)
  .refine((value) => !containsMarkup(value), 'Message cannot contain < or >')

const subjectField = z
  .string({ required_error: 'Please enter a subject', invalid_type_error: 'Subject must be text' })
  .transform(normalizeContactText)
  .refine((value) => value !== '', 'Please enter a subject')
  .refine((value) => value.length >= 3, 'Subject must be at least 3 characters — say what it is about')
  .refine((value) => value.length <= CONTACT_LIMITS.subject.max, `Subject must be at most ${CONTACT_LIMITS.subject.max} characters`)
  .refine((value) => !containsMarkup(value), 'Subject cannot contain < or >')

const phoneField = z
  .string({ invalid_type_error: 'Mobile number must be text' })
  .transform(normalizeContactText)
  .refine((value) => value === '' || PHONE_SHAPE_RE.test(value), 'Mobile number may only contain digits and separators')

/** The body the worker receives. `.strict()`, exactly as the worker's is: if the
 * browser sent a key the worker does not know, the request would be a 400 that
 * looks like a bug in the form. */
function buildSchema(options: { turnstileRequired: boolean }) {
  return z
    .object({
      name: nameField,
      email: emailField,
      subject: subjectField,
      phone: phoneField,
      message: messageField,
      turnstileToken: z
        .string()
        .max(CONTACT_LIMITS.turnstileToken.max, 'The bot check token is too long')
        .refine(
          (value) => (options.turnstileRequired ? value.trim() !== '' : true),
          'Please complete the bot check before sending',
        ),
      [HONEYPOT_FIELD]: z.string(),
    })
    .strict()
}

/** The schema when Turnstile is configured — which is the only state a deployed
 * form should be in. */
export const contactInquirySchema = buildSchema({ turnstileRequired: true })

/** The schema for a build or a page with no Turnstile site key: the token is not
 * required, because there is no widget that could produce one. Only demo mode
 * sends anything in that state, and it sends it nowhere. */
export const contactInquirySchemaWithoutTurnstile = buildSchema({ turnstileRequired: false })

export type ContactInquiry = z.infer<typeof contactInquirySchema>

/** The fields a Guest can be told about. */
export type ContactInquiryField = keyof ContactInquiry

/** The first message per field, plus `_form` for issues that belong to none. */
export type ContactFieldErrors = Partial<Record<ContactInquiryField, string>> & { _form?: string }

export function contactFieldErrors(error: z.ZodError): ContactFieldErrors {
  const errors: ContactFieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form'
    if (errors[key as keyof ContactFieldErrors] === undefined) {
      errors[key as keyof ContactFieldErrors] = issue.message
    }
  }
  return errors
}

export function firstContactError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again.'
}
