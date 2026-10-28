/**
 * The browser and the Cloudflare Worker have to agree, or the form is a dead end.
 *
 * The two schemas are separate files — the client's is bundled for the browser,
 * the worker's runs on Cloudflare — so nothing at build time forces them to stay
 * in step. This test does: it imports the worker's schema and `LIMITS` directly
 * (`workers/contact-inquiry/src/schema.ts`, which imports nothing but `zod`, so it
 * loads in jsdom) and asks the questions that would otherwise be discovered by a
 * Guest whose inquiry was refused for a reason the form could not see:
 *
 *   • Are the numbers the same?
 *   • Is every body the browser builds accepted by the worker, through the
 *     worker's own `.strict()` parse?
 *   • Is every key the browser sends one the worker knows?
 */
import { describe, expect, it } from 'vitest'
import {
  CONTACT_LIMITS,
  HONEYPOT_FIELD,
  contactInquirySchema,
  contactInquirySchemaWithoutTurnstile,
} from '../../src/lib/security/contactInquiry'
import { LIMITS as WORKER_LIMITS, inquirySchema as workerSchema } from '../../workers/contact-inquiry/src/schema'

import { RATE_LIMIT as RATE_LIMIT_POLICY } from '../../workers/contact-inquiry/src/kvRateLimit'

const formAnswer = {
  name: 'Ana Reyes',
  email: 'ana@example.com',
  subject: 'Wedding photoshoot inquiry',
  phone: '09171234567',
  message: 'We would like to ask about a weekend shoot for twelve people.',
  turnstileToken: 'token-abc',
  [HONEYPOT_FIELD]: '',
}

describe('the two schemas are one contract', () => {
  it('publishes the same ceilings', () => {
    expect(CONTACT_LIMITS.name).toEqual(WORKER_LIMITS.name)
    expect(CONTACT_LIMITS.email).toEqual(WORKER_LIMITS.email)
    expect(CONTACT_LIMITS.message).toEqual(WORKER_LIMITS.message)
    expect(CONTACT_LIMITS.subject).toEqual(WORKER_LIMITS.subject)
    expect(CONTACT_LIMITS.phone).toEqual(WORKER_LIMITS.phone)
    expect(CONTACT_LIMITS.honeypot.max).toBe(WORKER_LIMITS.honeypot.max)
  })

  it('accepts, on the worker, every body the browser builds', () => {
    const built = contactInquirySchema.safeParse(formAnswer)
    expect(built.success).toBe(true)
    if (!built.success) return

    // The strongest form of the check: the browser's output, fed straight into the
    // worker's strict parse. A key either side added would fail this.
    const worker = workerSchema.safeParse(built.data)
    expect(worker.success, worker.success ? '' : JSON.stringify(worker.error.issues)).toBe(true)
    if (!worker.success) return
    expect(worker.data.name).toBe('Ana Reyes')
    expect(worker.data.email).toBe('ana@example.com')
  })

  it('accepts the same body with the optional fields left empty', () => {
    const built = contactInquirySchema.safeParse({ ...formAnswer, subject: 'A question', phone: '' })
    expect(built.success).toBe(true)
    if (!built.success) return
    expect(workerSchema.safeParse(built.data).success).toBe(true)
  })

  it('sends no key the worker refuses', () => {
    const built = contactInquirySchema.safeParse(formAnswer)
    if (!built.success) throw new Error('the form answer should be valid')
    expect(Object.keys(built.data).sort()).toEqual(
      ['email', 'hdl_extra', 'message', 'name', 'phone', 'subject', 'turnstileToken'].sort(),
    )
  })

  it('refuses the same way on both sides, for the values a Guest actually types', () => {
    const cases = [
      { name: 'A' },
      { name: 'x'.repeat(81) },
      { email: 'not-an-email' },
      { email: `${'a'.repeat(95)}@x.com` },
      { message: 'too short' },
      { message: 'x'.repeat(2001) },
      { turnstileToken: '' },
    ]
    for (const override of cases) {
      const client = contactInquirySchema.safeParse({ ...formAnswer, ...override })
      const worker = workerSchema.safeParse({ ...formAnswer, ...override })
      expect(client.success, `client: ${JSON.stringify(override).slice(0, 40)}`).toBe(false)
      expect(worker.success, `worker: ${JSON.stringify(override).slice(0, 40)}`).toBe(false)
    }
  })

  it('still lets a build with no widget check the form locally', () => {
    // Demo mode sends nothing anywhere, so the token rule is relaxed there; the
    // worker would refuse the same body, which is correct and is why a configured
    // endpoint with no site key disables the button instead of failing at send.
    const preview = contactInquirySchemaWithoutTurnstile.safeParse({ ...formAnswer, turnstileToken: '' })
    expect(preview.success).toBe(true)
    expect(workerSchema.safeParse({ ...formAnswer, turnstileToken: '' }).success).toBe(false)
  })

  it('states the pacing the worker enforces, in the numbers the brief gave', () => {
    expect(RATE_LIMIT_POLICY.max).toBe(5)
    expect(RATE_LIMIT_POLICY.windowSeconds).toBe(600)
  })
})
