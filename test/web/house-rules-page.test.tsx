import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HouseRulesPage } from '../../src/pages/HouseRulesPage'
import { HOUSE_RULES } from '../../src/config/site'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('house rules page', () => {
  it('separates rules and guest accounts and points to pricing and terms', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => root.render(<MemoryRouter><HouseRulesPage /></MemoryRouter>))
      expect([...container.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Before you arrive'])
      expect([...container.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual(['House rules', 'What recent guests mention'])
      expect(container.querySelector('a[href="/rates"]')).not.toBeNull()
      expect(container.querySelector('a[href="/legal"]')?.textContent).toContain('booking and payment terms')
      expect(container.querySelector('a[target="_blank"]')?.textContent).toContain('opens in a new tab')
      expect(container.querySelector('.dark\\:bg-forest-950')).not.toBeNull()
      expect(HOUSE_RULES.every((rule) => !rule.body.includes('₱'))).toBe(true)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
