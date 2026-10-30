import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LEGAL_VERSION } from '../../src/lib/legal'

vi.mock('../../src/hooks/usePublishedRates', () => ({
  usePublishedRates: () => ({ refund: { refund_percent: 50 } }),
}))

import { LegalPage } from '../../src/pages/LegalPage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('legal page', () => {
  it('shows its version, house rules, payment guidance and policy distinction', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => root.render(<MemoryRouter><LegalPage /></MemoryRouter>))
      const text = container.textContent ?? ''
      expect(text).toContain(`Terms version: ${LEGAL_VERSION}`)
      expect(text).toContain('Stays are 1–20 nights.')
      expect(container.querySelector('a[href="/house-rules"]')).not.toBeNull()
      expect(text).toContain('official payment methods shown on the payment step')
      expect(text).toContain('not necessarily the one stamped on an existing booking')
      expect(container.querySelector('.dark\\:bg-forest-950')).not.toBeNull()
      expect(container.querySelector('.dark\\:text-cream-100\\/85')).not.toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
