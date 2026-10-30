import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn() }))
vi.mock('../../src/lib/reviewsCloud', () => ({
  listPublicReviews: api.list,
  getPublicReviewSummary: api.summary,
}))

import { Reviews } from '../../src/sections/Reviews'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.resetAllMocks()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const review = {
  review_id: 'review-1', stars: 5, excerpt: 'A lovely stay', display_name: 'Guest',
  month: 'October 2026', published_at: '2026-10-01',
}

describe('on-site reviews', () => {
  it('shows loaded reviews without relying on scroll reveal even if the summary fails', async () => {
    api.list.mockResolvedValue([review])
    api.summary.mockRejectedValue(new Error('offline'))
    await act(async () => { root.render(<Reviews />) })
    const block = container.querySelector('[data-testid="stay-reviews"]')!
    expect(block.textContent).toContain('A lovely stay')
    expect(block.classList.contains('reveal')).toBe(false)
    expect(block.textContent).toContain('rating summary is temporarily unavailable')
    expect(container.textContent).toContain('Showing 6 of 9 reviews')
  })

  it('reports a failed review fetch while keeping a successful summary', async () => {
    api.list.mockRejectedValue(new Error('offline'))
    api.summary.mockResolvedValue({ average: 4.5, count: 2 })
    await act(async () => { root.render(<Reviews />) })
    expect(container.textContent).toContain('On-site reviews could not be loaded')
    expect(container.textContent).toContain('4.5')
    expect(container.textContent).toContain('2 reviews')
  })
})
