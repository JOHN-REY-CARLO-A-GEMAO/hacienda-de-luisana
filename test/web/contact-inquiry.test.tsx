import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContactInquiryForm } from '../../src/components/ContactInquiryForm'

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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
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
})
