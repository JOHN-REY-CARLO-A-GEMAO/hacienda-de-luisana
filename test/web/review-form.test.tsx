// ----------------------------------------------------------------------------
// The Guest's review form, driven the way a Guest drives it.
//
// Rendered into a real DOM root and driven by clicks and typing, the way
// `payment-step.test.tsx` drives the Booking form — so what is asserted is what
// a Guest without Firebase credentials sees, which is the case where honesty
// matters most: a submit that cannot happen must say so rather than look done.
//
// Three things are under test, and each is a decision that could be quietly
// undone: the star control is a labelled radio group a screen reader can read
// and a keyboard can drive; a double press cannot file two reviews; and what
// the Guest typed survives a refusal, because losing a paragraph to a dropped
// connection is the kind of thing a Guest only discovers once.
// ----------------------------------------------------------------------------
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ReviewForm } from '../../src/components/ReviewForm'
import { getReviewForBooking } from '../../src/lib/reviewsCloud'
import { REVIEW_CATEGORIES, STAR_LABELS } from '../../src/lib/reviewPolicy'
import { REVIEW_MAX } from '../../src/lib/validation'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PUMP_MS = 10

async function pump(turns = 3) {
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

const mounted: Root[] = []
let container: HTMLDivElement

const BOOKING = 'booking-1'
const UID = 'guest-uid-1'

function render(ui: React.ReactElement) {
  const root = createRoot(container)
  mounted.push(root)
  act(() => root.render(ui))
  return root
}

const form = (bookingId = BOOKING, bookingStatus = 'Completed') => (
  <ReviewForm bookingId={bookingId} uid={UID} bookingStatus={bookingStatus} />
)

const q = <T extends Element>(selector: string): T => {
  const found = container.querySelector<T>(selector)
  if (!found) throw new Error(`no element for ${selector}\n${container.innerHTML.slice(0, 900)}`)
  return found
}
const maybe = (selector: string) => container.querySelector(selector)
const all = (selector: string) => [...container.querySelectorAll(selector)]
const text = () => container.textContent ?? ''

/** The overall rating's five stars, which are the first radio group on the form. */
const overallStars = () => [...q('[role="radiogroup"]').querySelectorAll<HTMLInputElement>('input[type="radio"]')]

async function type(selector: string, value: string) {
  const node = q<HTMLTextAreaElement>(selector)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(node: Element | null | undefined) {
  if (!node) throw new Error('nothing to click')
  await act(async () => {
    ;(node as HTMLElement).click()
  })
}

beforeEach(() => {
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  container.remove()
})

afterAll(() => {
  document.body.innerHTML = ''
})

describe('the star control', () => {
  it('is a radio group a screen reader can read, and the value is in words', async () => {
    render(form())
    await pump()
    const group = q('[role="radiogroup"]')
    expect(group.getAttribute('aria-label')).toMatch(/how was your stay/i)
    // Scoped to the overall rating, because the four categories have rows of
    // their own — and each control is ONE radio: the <input> carries the role,
    // and the gold star beside it is aria-hidden, so a screen reader announces
    // each star once.
    const stars = [...group.querySelectorAll('input[type="radio"]')]
    expect(stars).toHaveLength(5)
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(0)
    expect(group.querySelectorAll('span:not([aria-hidden="true"])')).toHaveLength(0)
    // Colour and shape are not the only channel: each star says what it means.
    expect(stars.map((s) => s.getAttribute('aria-label'))).toEqual([
      '1 star — Very poor',
      '2 stars — Poor',
      '3 stars — Average',
      '4 stars — Good',
      '5 stars — Excellent',
    ])
    expect(STAR_LABELS).toHaveLength(5)
  })

  it('is operable from the keyboard, because the stars are real radio inputs', async () => {
    render(form())
    await pump()
    const inputs = [...q('[role="radiogroup"]').querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(inputs).toHaveLength(5)
    // A radio group is one tab stop, and the arrow keys move within it.
    expect(inputs.every((i) => i.type === 'radio')).toBe(true)
    await click(inputs[0])
    await pump()
    expect(inputs[0].checked).toBe(true)
    await click(inputs[3])
    await pump()
    expect(inputs[3].checked).toBe(true)
    expect(inputs[0].checked).toBe(false)
  })

  it('shows the chosen rating in text, not only as a colour', async () => {
    render(form())
    await pump()
    await click(overallStars()[4])
    await pump()
    expect(text()).toMatch(/5 stars/i)
    expect(text()).toMatch(/excellent/i)
  })
})

describe('writing a review', () => {
  it('cannot be sent twice by an impatient thumb', async () => {
    render(form())
    await pump()
    const send = q<HTMLButtonElement>('button[type="submit"]')
    // Two presses in the same breath: the first disables the button, so the
    // second finds nothing to press.
    await act(async () => {
      send.click()
      send.click()
    })
    await pump(4)
    const stored = await getReviewForBooking(BOOKING, UID)
    expect(stored?.stars).toBe(5)
    expect(text()).toMatch(/thank you/i)
    // And the form is gone: there is no second submit to press.
    expect(maybe('button[type="submit"]')).toBeNull()
  })

  it('shows the review they already wrote, and says it is theirs', async () => {
    // A Review written a month ago: outside the fortnight, so the Guest can
    // read what they said and the Admin's reply, but the form is gone. The
    // words are now a record, not a draft.
    const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString()
    localStorage.setItem(`hdl:review:${BOOKING}`, JSON.stringify({
      booking_id: BOOKING, uid: UID, stars: 4, text: 'Mine.', created_at: longAgo,
      status: 'published', edit_until: longAgo,
      admin_response: 'Thank you for staying with us!',
    }))
    render(form())
    await pump()
    expect(maybe('textarea')).toBeNull()
    expect(text()).toMatch(/4 stars/i)
    expect(text()).toContain('Mine.')
    // The Admin's reply is visibly the Admin's, not the Guest's.
    expect(text()).toMatch(/reply from the admin/i)
    expect(text()).toContain('Thank you for staying with us!')
  })

  it('lets the Guest correct a review they wrote inside the window', async () => {
    localStorage.setItem(`hdl:review:${BOOKING}`, JSON.stringify({ booking_id: BOOKING, uid: UID, stars: 4, text: 'Mine.', created_at: new Date().toISOString(), status: 'pending', edit_until: new Date().toISOString() }))
    render(form())
    await pump()
    expect(text()).toMatch(/change/i)
    const send = q<HTMLButtonElement>('button[type="submit"]')
    await click(overallStars()[1])
    await type('textarea', 'On reflection, quieter than I remember.')
    await click(send)
    await pump(4)
    const stored = await getReviewForBooking(BOOKING, UID)
    expect(stored?.stars).toBe(2)
    expect(stored?.text).toBe('On reflection, quieter than I remember.')
  })

  it('offers the categories but never demands them', async () => {
    render(form())
    await pump()
    // Four, each named, and the overall rating is the one that is asked for.
    for (const category of REVIEW_CATEGORIES) {
      expect(text()).toContain(category.label)
    }
    const send = q<HTMLButtonElement>('button[type="submit"]')
    await click(send)
    await pump(4)
    const stored = await getReviewForBooking(BOOKING, UID)
    // Submitted with no category answered at all — which is allowed.
    expect(stored?.stars).toBe(5)
    expect(stored?.cleanliness).toBeUndefined()
  })
})

describe('what the Guest is told', () => {
  it('counts the characters as they type, against the limit the rules enforce', async () => {
    render(form())
    await pump()
    await type('textarea', 'Nice')
    expect(text()).toMatch(/4 \/ 1000/)
    await type('textarea', 'x'.repeat(REVIEW_MAX + 1))
    expect(text()).toMatch(/1000/)
  })

  it('refuses feedback past the limit, keeps what was typed, and does not file it', async () => {
    render(form())
    await pump()
    await type('textarea', 'x'.repeat(REVIEW_MAX + 1))
    await click(q('button[type="submit"]'))
    await pump(3)
    expect(text()).toMatch(/at most 1000/i)
    // The Guest does not lose the paragraph to a validation error.
    expect(q<HTMLTextAreaElement>('textarea').value).toHaveLength(REVIEW_MAX + 1)
    expect(await getReviewForBooking(BOOKING, UID)).toBeNull()
  })

  it('shows nothing to a Guest whose stay is not over', async () => {
    render(form('booking-1', 'Staying'))
    await pump()
    expect(maybe('textarea')).toBeNull()
    expect(maybe('[role="radiogroup"]')).toBeNull()
  })
})
