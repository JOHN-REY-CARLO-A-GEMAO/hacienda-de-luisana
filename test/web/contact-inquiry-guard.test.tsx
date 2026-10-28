/**
 * The contact form when the *worker* answers — and when there is no worker.
 *
 * `contact-inquiry.test.tsx` covers the browser's own validation. This file
 * covers the outcomes only a real endpoint produces: a 429 with a wait, a field
 * error the worker named, a failed bot check, a dropped connection — plus the two
 * configuration states that decide whether the button may work at all (a worker
 * URL with no Turnstile site key, and no worker URL at all).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ submitInquiry: vi.fn(), endpoint: 'https://worker.example' as string | null }))

vi.mock('../../src/lib/inquiryApi', () => ({
  submitInquiry: mocks.submitInquiry,
  contactEndpoint: () => mocks.endpoint,
  parseInquiryReply: vi.fn(),
  DEMO_INQUIRY_KEY: 'hdl:inquiries',
  RATE_LIMITED_MESSAGE: 'rate limited',
}))

vi.mock('../../src/components/security/TurnstileWidget', () => ({
  // Stands in for a solved challenge: a real page gets this token from
  // Cloudflare's script, which jsdom cannot load. `configurable` mirrors the real
  // component, which reads its site key at call time.
  isTurnstileConfigured: () => (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim() !== '',
  turnstileSiteKey: () => import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
  TurnstileWidget: ({ onToken, resetSignal }: { onToken: (token: string) => void; resetSignal?: number }) => {
    const { useEffect } = require('react') as typeof import('react')
    useEffect(() => {
      onToken(resetSignal ? '' : 'test-turnstile-token')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetSignal])
    return null
  },
}))

import { ContactInquiryForm } from '../../src/components/ContactInquiryForm'
import { resetRateLimit } from '../../src/lib/rateLimit'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function fill(container: HTMLElement) {
  const name = container.querySelector('input[placeholder="Juan Dela Cruz"]') as HTMLInputElement
  const email = container.querySelector('input[type="email"]') as HTMLInputElement
  const subject = container.querySelector('input[placeholder*="Wedding photoshoot"]') as HTMLInputElement
  const message = container.querySelector('textarea') as HTMLTextAreaElement
  act(() => {
    setValue(name, 'Juan Dela Cruz')
    setValue(email, 'juan@example.com')
    setValue(subject, 'Wedding photoshoot inquiry')
    setValue(message, 'We would like to ask about a weekend shoot for twelve people.')
  })
  return { name, email, subject, message }
}

async function submit(container: HTMLElement) {
  const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
  await act(async () => {
    button.click()
  })
  return button
}

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ContactInquiryForm />)
  })
  return { container, root }
}

describe('ContactInquiryForm with the Turnstile widget configured', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    resetRateLimit()
    mocks.submitInquiry.mockReset()
    mocks.endpoint = 'https://worker.example'
    ;({ container, root } = render())
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllEnvs()
  })

  it('shows the worker’s 429 sentence and disables the button for the stated wait', async () => {
    mocks.submitInquiry.mockResolvedValue({
      ok: false,
      kind: 'rate_limited',
      message: "You've submitted too many times. Please wait a few minutes before trying again.",
      retryAfterSeconds: 600,
    })
    fill(container)
    const button = await submit(container)

    expect(container.textContent).toContain('too many times')
    expect(container.textContent).toContain('You can send another in')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Try again in 600s')
  })

  it('puts a field error the worker named under that field', async () => {
    mocks.submitInquiry.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'Message must be at least 10 characters',
      fields: { message: 'Message must be at least 10 characters' },
    })
    fill(container)
    await submit(container)

    expect(container.textContent).toContain('Message must be at least 10 characters')
    expect(container.textContent).toContain('Please correct the highlighted form errors')
  })

  it('shows a failed bot check and keeps what the Guest typed', async () => {
    mocks.submitInquiry.mockResolvedValue({
      ok: false,
      kind: 'bot',
      message: 'The bot check could not be completed. Please refresh the page and try again.',
    })
    const fields = fill(container)
    await submit(container)

    expect(container.textContent).toContain('bot check could not be completed')
    expect(fields.message.value).toContain('weekend shoot')
    expect(container.textContent).not.toContain('Inquiry sent.')
  })

  it('says the connection failed instead of pretending it was sent', async () => {
    mocks.submitInquiry.mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      message: "We couldn't reach the Hacienda. Check your connection and try again.",
    })
    fill(container)
    await submit(container)
    expect(container.textContent).toContain("couldn't reach the Hacienda")
    expect(container.textContent).not.toContain('Inquiry sent.')
  })

  it('sends the exact body the worker’s strict schema accepts', async () => {
    mocks.submitInquiry.mockResolvedValue({ ok: true, id: 'email-1', receivedAt: 'now', demo: false })
    fill(container)
    await submit(container)

    const payload = mocks.submitInquiry.mock.calls[0][0] as Record<string, unknown>
    expect(payload.turnstileToken).toBe('test-turnstile-token')
    expect(Object.keys(payload).sort()).toEqual(
      ['email', 'hdl_extra', 'message', 'name', 'phone', 'subject', 'turnstileToken'].sort(),
    )
    // No `form_started_at`: the worker's schema is strict, and the old timer would
    // now be an unknown key.
    expect(payload).not.toHaveProperty('form_started_at')
    expect(payload.hdl_extra).toBe('')
  })

  it('does not block a human on the honeypot — the worker decides', async () => {
    mocks.submitInquiry.mockResolvedValue({ ok: true, id: 'email-1', receivedAt: 'now', demo: false })
    const honeypot = container.querySelector('[data-testid="contact-honeypot"]') as HTMLInputElement
    expect(honeypot).not.toBeNull()
    expect(honeypot.tabIndex).toBe(-1)
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull()

    fill(container)
    act(() => setValue(honeypot, 'https://spam.example'))
    await submit(container)

    expect(mocks.submitInquiry).toHaveBeenCalledTimes(1)
    expect((mocks.submitInquiry.mock.calls[0][0] as Record<string, unknown>).hdl_extra).toBe('https://spam.example')
    expect(container.textContent).toContain('Inquiry sent.')
  })

  it('sends the token the widget minted, and clears the fields after a send', async () => {
    mocks.submitInquiry.mockImplementation(async (payload: { turnstileToken: string }) => {
      expect(payload.turnstileToken).toBe('test-turnstile-token')
      return { ok: true, id: 'email-1', receivedAt: 'now', demo: false }
    })
    fill(container)
    await submit(container)
    expect(container.textContent).toContain('Inquiry sent.')

    // The form is replaced by the confirmation, so "cleared" is proved the way a
    // Guest would see it: opening a fresh form shows empty fields.
    const again = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Send another inquiry'),
    ) as HTMLButtonElement
    act(() => again.click())

    const name = container.querySelector('input[placeholder="Juan Dela Cruz"]') as HTMLInputElement
    const message = container.querySelector('textarea') as HTMLTextAreaElement
    expect(name.value).toBe('')
    expect(message.value).toBe('')
  })

  it('labels a demo send instead of claiming the estate received it', async () => {
    mocks.submitInquiry.mockResolvedValue({ ok: true, id: 'demo-1', receivedAt: 'now', demo: true })
    fill(container)
    await submit(container)

    expect(container.textContent).toContain('demo mode')
    expect(container.textContent).toContain('has not reached the estate')
  })
})

describe('ContactInquiryForm without a Turnstile site key', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.unstubAllEnvs()
  })

  it('says the bot check is missing, and will not pretend to send', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    resetRateLimit()
    mocks.submitInquiry.mockReset()
    mocks.endpoint = 'https://worker.example'
    ;({ container, root } = render())

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(container.textContent).toContain('bot check is not configured')
    expect(button.disabled).toBe(true)

    fill(container)
    await submit(container)
    // Nothing was posted: the worker would refuse it for a missing token.
    expect(mocks.submitInquiry).not.toHaveBeenCalled()
  })

  it('keeps a demo build usable, because it sends nothing anywhere', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    resetRateLimit()
    mocks.submitInquiry.mockReset()
    mocks.endpoint = null
    ;({ container, root } = render())

    expect(container.textContent).not.toContain('bot check is not configured')
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    mocks.submitInquiry.mockResolvedValue({ ok: true, id: 'demo-1', receivedAt: 'now', demo: true })
    fill(container)
    await submit(container)
    expect(container.textContent).toContain('demo mode')
  })
})
