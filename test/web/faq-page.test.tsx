import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FaqPage } from '../../src/pages/FaqPage'
import { FAQS } from '../../src/config/site'
import { faqJsonLd } from '../../src/lib/seo'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('FAQ page', () => {
  it('provides current-rate and directions links with accessible accordion states', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => root.render(<MemoryRouter><FaqPage /></MemoryRouter>))
      expect(container.querySelector('a[href="/contact"]')).not.toBeNull()
      expect(container.querySelector('a[href="/rates"]')).not.toBeNull()
      expect(container.querySelector('a[href="/location#getting-here"]')).not.toBeNull()
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
      expect(buttons[0].getAttribute('aria-expanded')).toBe('true')
      expect(buttons[1].getAttribute('aria-expanded')).toBe('false')
      act(() => buttons[1].click())
      expect(buttons[0].getAttribute('aria-expanded')).toBe('false')
      expect(buttons[1].getAttribute('aria-expanded')).toBe('true')
      expect(buttons[1].className).toContain('focus-visible:outline')
      expect(container.querySelector('.dark\\:bg-forest-950')).not.toBeNull()
      for (const faq of FAQS) expect(faq.a).not.toMatch(/₱/)
      const structured = faqJsonLd() as { mainEntity: Array<{ acceptedAnswer: { text: string } }> }
      expect(structured.mainEntity.map((entry) => entry.acceptedAnswer.text)).toEqual(FAQS.map((faq) => faq.a))
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
