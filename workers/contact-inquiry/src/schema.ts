/**
 * The request's shape — one schema, and it is the only thing that decides what
 * the worker will act on.
 * ----------------------------------------------------------------------------
 * Three rules this file encodes, each of which is a way form handlers usually
 * go wrong:
 *
 *   • **Trim before measuring.** `.trim()` runs before `.min()`, so `"  Ana  "`
 *     is a two-character name and not a seven-character one, and a message of
 *     spaces is empty. Measuring first and trimming after is how a form accepts
 *     a blank message.
 *   • **Refuse, never repair.** `.strict()` rejects an unknown key instead of
 *     ignoring it, and nothing here truncates. A request carrying `to`, `from`
 *     or `reply_to` is a request trying to choose where an email goes; it gets a
 *     400, not a silently rewritten inquiry.
 *   • **The honeypot is parsed, not judged.** `hdl_extra` has `max(0)`, so a
 *     populated trap fails the schema — but the handler reads the trap *before*
 *     validating, so a bot gets a fake success rather than a 400 that names the
 *     field it should have left alone. The `max(0)` is the second line of
 *     defence, for a future caller that forgets the first.
 */
import { z } from 'zod'

/** The ceilings, in one place, for the tests and the README. */
export const LIMITS = {
  name: { min: 2, max: 80 },
  email: { max: 100 },
  message: { min: 10, max: 2000 },
  /** The trap. Its only legal value is "" — see `honeypotTripped`. */
  honeypot: { max: 0 },
  /**
   * Two fields the website's form already has, kept as **optional additions** to
   * the brief's five. A request without them is valid, which is what makes them
   * additive rather than a change of contract; delete these two entries (and the
   * two lines in `src/resend.ts`) to run the strict five-field schema.
   */
  subject: { max: 120 },
  phone: { max: 20 },
} as const

/** The field the trap is called. Never `website`, `company` or `bot`: those are
 * autofilled by password managers, and a false positive loses a Guest's inquiry. */
export const HONEYPOT_FIELD = 'hdl_extra' as const

/** The largest body the worker will read. The fields cannot approach it; the
 * ceiling is here so a 20 MB POST is refused before it is parsed or buffered. */
export const MAX_BODY_BYTES = 8 * 1024

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_SHAPE_RE = /^[0-9+\-()\s]{7,20}$/

/**
 * The accepted body.
 *
 * `turnstileToken` is required and non-empty: the endpoint's whole bot defence
 * depends on a token Cloudflare will vouch for, and a request without one is not
 * a request this worker can accept.
 */
export const inquirySchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required', invalid_type_error: 'Name must be text' })
      .trim()
      .min(LIMITS.name.min, `Name must be at least ${LIMITS.name.min} characters`)
      .max(LIMITS.name.max, `Name must be at most ${LIMITS.name.max} characters`),
    email: z
      .string({ required_error: 'Email is required', invalid_type_error: 'Email must be text' })
      .trim()
      .min(1, 'Email is required')
      .max(LIMITS.email.max, `Email must be at most ${LIMITS.email.max} characters`)
      .refine((value) => EMAIL_RE.test(value), "That doesn't look like a valid email"),
    message: z
      .string({ required_error: 'Message is required', invalid_type_error: 'Message must be text' })
      .trim()
      .min(LIMITS.message.min, `Message must be at least ${LIMITS.message.min} characters`)
      .max(LIMITS.message.max, `Message must be at most ${LIMITS.message.max} characters`),
    turnstileToken: z
      .string({ required_error: 'The bot check has not been completed', invalid_type_error: 'The bot check token must be text' })
      .min(1, 'The bot check has not been completed'),
    [HONEYPOT_FIELD]: z.string().max(LIMITS.honeypot.max, 'This field must be empty'),
    // Optional additions to the brief — see LIMITS above.
    subject: z.string().trim().max(LIMITS.subject.max, `Subject must be at most ${LIMITS.subject.max} characters`).optional(),
    phone: z
      .string()
      .trim()
      .max(LIMITS.phone.max, `Phone must be at most ${LIMITS.phone.max} characters`)
      .refine((value) => value === '' || PHONE_SHAPE_RE.test(value), 'Mobile number may only contain digits and separators')
      .optional(),
  })
  .strict()

export type Inquiry = z.infer<typeof inquirySchema>

/** A field-keyed map of the first message for each field. `_form` collects the
 * issues that belong to no field (an unknown key). */
export type FieldErrors = Record<string, string>

export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form'
    if (errors[key] === undefined) errors[key] = issue.message
  }
  return errors
}

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again.'
}

/**
 * Did something fall into the trap?
 *
 * Read from the raw body, not from a parsed value, because this question is
 * asked before validation and because a bot's extra key may be any type — a
 * number, an object, an array. Anything present and non-empty counts.
 */
export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD]
  if (typeof value === 'string') return value.trim() !== ''
  return value !== undefined && value !== null
}
