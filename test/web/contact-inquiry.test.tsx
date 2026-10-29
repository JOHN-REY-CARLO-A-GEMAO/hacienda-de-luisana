import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInquiryForm } from '../../src/components/ContactInquiryForm'
import { LIMITS, resetRateLimit } from '../../src/lib/rateLimit'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ContactInquiryForm strict validation and live counters', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    resetRateLimit()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => {
      root?.unmount()
    })
    container.remove()
  })

  it('renders with strict input rules, counter at 0, and strips numbers from name input', () => {
    act(() => {
      root?.render(<ContactInquiryForm />)
    })

    const nameInput = container.querySelector('input[placeholder="Juan Dela Cruz"]') as HTMLInputElement
    const subjectInput = container.querySelector('input[placeholder*="Wedding photoshoot"]') as HTMLInputElement
    const messageInput = container.querySelector('textarea') as HTMLTextAreaElement

    expect(nameInput).not.toBeNull()
    expect(subjectInput).not.toBeNull()
    expect(messageInput).not.toBeNull()

    // Verify initial character counters
    expect(container.textContent).toContain('0 / 120 characters')
    expect(container.textContent).toContain('0 / 1000 characters')

    // Test typing numbers into name gets sanitized
    act(() => {
      setInputValue(nameInput, 'Juan123 Dela456 Cruz')
    })
    expect(nameInput.value).toBe('Juan Dela Cruz')

    // Test live counter updates for subject
    act(() => {
      setInputValue(subjectInput, 'Wedding reception inquiry')
    })
    expect(container.textContent).toContain('25 / 120 characters')

    // Test live counter updates for message
    act(() => {
      setInputValue(messageInput, 'We would like to inquire about booking the whole villa.')
    })
    expect(container.textContent).toContain('55 / 1000 characters')
  })

  it('rejects submission with invalid data and displays inline error messages', () => {
    act(() => {
      root?.render(<ContactInquiryForm />)
    })

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()

    act(() => {
      submitBtn.click()
    })

    // Should display validation error messages
    expect(container.textContent).toContain('Please enter your full name')
    expect(container.textContent).toContain('Please enter an email')
    expect(container.textContent).toContain('Please enter a subject')
    expect(container.textContent).toContain('Message cannot be empty')
  })

  it('rejects short (< 10 chars) and markup-containing inquiry messages, and enforces LIMITS.inquiry cooldown', () => {
    vi.useFakeTimers()
    act(() => {
      root?.render(<ContactInquiryForm />)
    })

    const fillForm = (msgText: string) => {
      const nameInput = container.querySelector('input[placeholder="Juan Dela Cruz"]') as HTMLInputElement
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement
      const subjectInput = container.querySelector('input[placeholder*="Wedding photoshoot"]') as HTMLInputElement
      const messageInput = container.querySelector('textarea') as HTMLTextAreaElement
      act(() => {
        setInputValue(nameInput, 'Juan Dela Cruz')
        setInputValue(emailInput, 'juan@example.com')
        setInputValue(subjectInput, 'Weekend venue inquiry')
        setInputValue(messageInput, msgText)
      })
    }

    // 1. Short message refused without consuming rate-limit budget
    fillForm('Too short')
    act(() => {
      ;(container.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    })
    expect(container.textContent).toContain('Message must be at least 10 characters')

    // 2. Angle brackets refused
    fillForm('Inquiry with <script>alert(1)</script>')
    act(() => {
      ;(container.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    })
    expect(container.textContent).toContain('Message cannot contain < or >')

    // 3. Up to LIMITS.inquiry.max valid inquiries succeed, then the next one hits cooldown
    for (let i = 0; i < LIMITS.inquiry.max; i++) {
      fillForm(`We would like to ask about December availability (${i + 1}).`)
      act(() => {
        ;(container.querySelector('button[type="submit"]') as HTMLButtonElement).click()
      })
      act(() => {
        vi.advanceTimersByTime(450)
      })
      expect(container.textContent).toContain('Inquiry sent.')
      const sendAnother = [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Send another inquiry'),
      ) as HTMLButtonElement
      act(() => {
        sendAnother.click()
      })
    }

    fillForm('One more inquiry right away within the same minute.')
    act(() => {
      ;(container.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    })
    expect(container.textContent).toMatch(/Too many attempts/i)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'One more inquiry right away within the same minute.',
    )
  })
})
