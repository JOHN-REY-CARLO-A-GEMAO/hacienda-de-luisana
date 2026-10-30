import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ContactPage } from '../../src/pages/ContactPage'
import { BUSINESS, LISTINGS } from '../../src/config/site'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('contact page', () => {
  it('labels contact actions accurately and links to both listings', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => root.render(<MemoryRouter><ContactPage /></MemoryRouter>))
      const links = [...container.querySelectorAll('a')]
      expect(links.find((a) => a.textContent?.includes('View our Airbnb listing'))?.href).toBe(LISTINGS.airbnb.url)
      expect(links.find((a) => a.textContent?.includes('View our Agoda listing'))?.href).toBe(LISTINGS.agoda.url)
      expect(links.find((a) => a.textContent?.includes(BUSINESS.contact.phoneDisplay) && a.textContent?.includes('Call'))?.getAttribute('href')).toMatch(/^tel:/)
      expect(container.textContent).not.toContain('Call / Message')
      expect(container.textContent).not.toMatch(/usually (the same day|reply within the day)/i)
      expect(container.textContent).toContain('map pin is approximate')
      expect(container.textContent).toContain('open in a new tab')
      expect(container.querySelector('.dark\\:bg-forest-950')).not.toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
