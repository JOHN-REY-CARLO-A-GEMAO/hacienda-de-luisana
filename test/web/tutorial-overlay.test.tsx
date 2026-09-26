// The tour overlay's geometry and hit-testing rules — the part a jsdom
// walkthrough cannot see, found by driving the real tour in a real browser:
//
//  * a full-viewport overlay root that takes pointer events swallows every
//    tap inside the spotlight window, however open the panels leave it, so
//    the root must be pointer-events: none and only the panels and the card
//    may take events;
//  * the card must never sit on the control it is asking the Guest to use —
//    it goes below, above, right or left, whichever fits, and when nothing
//    fits the page is nudged until the control is clear.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TourProvider } from '../../src/tutorial/TourEngine'
import { TourOverlay, nudgeDelta, placeCard } from '../../src/tutorial/TourOverlay'
import type { Rect, TourStep } from '../../src/tutorial/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const VW = 1366
const VH = 850
const TIP_H = 470

const rect = (top: number, left: number, width: number, height: number): Rect => ({ top, left, width, height })
const bottomOf = (p: { top: number }) => p.top + TIP_H
const rightOf = (p: { left: number; width: number }) => p.left + p.width

describe('where the tour card goes on a wide screen', () => {
  it('sits below the highlight when there is room', () => {
    const target = rect(120, 400, 220, 44)
    const p = placeCard(target, TIP_H, VW, VH)
    expect(p.side).toBe('below')
    expect(p.top).toBeGreaterThanOrEqual(target.top + target.height)
    expect(bottomOf(p)).toBeLessThanOrEqual(VH - 12)
  })

  it('moves above when below would run off the bottom', () => {
    const target = rect(600, 400, 220, 44)
    const p = placeCard(target, TIP_H, VW, VH)
    expect(p.side).toBe('above')
    expect(bottomOf(p)).toBeLessThanOrEqual(target.top)
    expect(p.top).toBeGreaterThanOrEqual(12)
  })

  it('floats beside a mid-screen highlight instead of covering it', () => {
    // A button at 45 % of the height: neither below nor above has 470 px.
    const target = rect(380, 415, 215, 44)
    const p = placeCard(target, TIP_H, VW, VH)
    expect(p.side).toBe('right')
    expect(p.left).toBeGreaterThanOrEqual(target.left + target.width)
    expect(rightOf(p)).toBeLessThanOrEqual(VW - 12)
    expect(p.top).toBeGreaterThanOrEqual(12)
    expect(bottomOf(p)).toBeLessThanOrEqual(VH - 12)
  })

  it('slims down to fit beside a wide highlight rather than sit on it', () => {
    // The booking-success panel: 704 px wide, taller than the screen.
    const target = rect(102, 331, 704, 1314)
    const p = placeCard(target, TIP_H, VW, VH)
    expect(p.side).toBe('right')
    expect(p.width).toBeGreaterThanOrEqual(280)
    expect(p.width).toBeLessThan(400)
    expect(p.left).toBeGreaterThanOrEqual(target.left + target.width)
    expect(rightOf(p)).toBeLessThanOrEqual(VW - 12)
  })

  it('never leaves the viewport, even when nothing fits', () => {
    // A panel that fills a small laptop screen edge to edge.
    const target = rect(60, 20, 984, 900)
    const p = placeCard(target, TIP_H, 1024, 700)
    expect(p.side).toBe('fallback')
    expect(p.left).toBeGreaterThanOrEqual(12)
    expect(rightOf(p)).toBeLessThanOrEqual(1024 - 12)
    expect(p.top).toBeGreaterThanOrEqual(12)
    expect(bottomOf(p)).toBeLessThanOrEqual(700 - 12)
  })
})

describe('nudging the page so the card never covers the control', () => {
  const dockedCard = rect(349, 12, 366, 483) // the phone bottom sheet on an 844 px screen

  it('does nothing when the card and the control are apart', () => {
    expect(nudgeDelta(rect(150, 49, 215, 44), dockedCard, 844)).toBe(0)
    expect(nudgeDelta(rect(400, 800, 100, 40), rect(100, 100, 400, 470), 850)).toBe(0)
  })

  it('scrolls a covered control up into the strip above a docked sheet', () => {
    const control = rect(376, 49, 215, 44) // centred by the engine, under the sheet
    const delta = nudgeDelta(control, dockedCard, 844)
    expect(delta).toBeGreaterThan(0)
    const after = control.top + control.height - delta
    expect(after).toBeLessThanOrEqual(dockedCard.top)
    expect(control.top - delta).toBeGreaterThanOrEqual(96) // and clear of the fixed header
  })

  it('will not push a control under the fixed header to clear it', () => {
    const tall = rect(120, 40, 310, 600) // a form block taller than the free strip
    const delta = nudgeDelta(tall, dockedCard, 844)
    expect(tall.top - delta).toBeGreaterThanOrEqual(96)
  })

  it('scrolls the other way when the room is below the card', () => {
    const highCard = rect(12, 400, 400, 300)
    const control = rect(250, 450, 200, 40) // under the card, with plenty of screen below
    const delta = nudgeDelta(control, highCard, 850)
    expect(delta).toBeLessThan(0)
    expect(control.top - delta).toBeGreaterThanOrEqual(highCard.top + highCard.height)
  })
})

describe('the overlay lets taps through the spotlight window', () => {
  const mounted: Root[] = []
  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
    document.body.innerHTML = ''
  })

  it('takes no pointer events on its root — only the dim panels and the card do', async () => {
    const steps: TourStep[] = [
      { id: 'one', title: 'Look here', body: 'A highlighted control.', targets: ['thing'], await: { type: 'click' } },
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    // A visible anchor for the step (jsdom has no layout, so size it by hand).
    const anchor = document.createElement('button')
    anchor.setAttribute('data-tour', 'thing')
    anchor.getBoundingClientRect = () => ({ top: 100, left: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}) })
    anchor.getClientRects = () => [anchor.getBoundingClientRect()] as unknown as DOMRectList
    document.body.appendChild(anchor)

    const root = createRoot(container)
    mounted.push(root)
    act(() => {
      root.render(
        <MemoryRouter>
          <TourProvider steps={steps} autoOpen onDone={() => {}} onExit={() => {}}>
            <TourOverlay />
          </TourProvider>
        </MemoryRouter>,
      )
    })
    // let the spotlight loop find the anchor
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })

    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    expect(dialog.className).toContain('pointer-events-none')

    const panels = [...dialog.children].filter((c) => c.className.includes('bg-forest-950/55'))
    expect(panels.length).toBe(4) // four panels frame a window around the anchor
    for (const p of panels) expect(p.className).toContain('pointer-events-auto')

    const ring = dialog.querySelector('.tour-ring')!
    expect(ring.className).toContain('pointer-events-none')

    const card = dialog.querySelector('[data-tour-card]')!
    expect(card.className).toContain('pointer-events-auto')
    expect(card.textContent).toContain('Look here')
  })
})

describe('a step whose control arrives late (slow page load)', () => {
  const mounted: Root[] = []
  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
    document.body.innerHTML = ''
  })

  const laidOut = (el: HTMLElement, top: number) => {
    el.getBoundingClientRect = () => ({ top, left: 40, width: 300, height: 120, right: 340, bottom: top + 120, x: 40, y: top, toJSON: () => ({}) })
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
  }

  it(
    'lifts the fallback once the anchor appears and then honours the Guest\'s already-typed values',
    async () => {
      // Seen in a real phone-sized Chromium under load: /book took longer than the
      // missing-anchor grace to render, the dates step degraded to "read along",
      // and typing the dates afterwards did nothing — `missing` was never cleared.
      const steps: TourStep[] = [
        {
          id: 'dates',
          title: 'Pick your dates first',
          body: 'Real body.',
          fallbackBody: 'Fallback body.',
          targets: ['stay-details'],
          actionHint: 'Choose both dates.',
          await: {
            type: 'fields',
            fields: [
              { field: 'check-in', ok: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) },
              { field: 'check-out', ok: (v, all) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v > all['check-in'] },
            ],
          },
        },
        { id: 'party', title: 'Tell us who is coming', body: 'Second step.', await: { type: 'none' } },
      ]
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      mounted.push(root)
      act(() => {
        root.render(
          <MemoryRouter>
            <TourProvider steps={steps} autoOpen onDone={() => {}} onExit={() => {}}>
              <TourOverlay />
            </TourProvider>
          </MemoryRouter>,
        )
      })
      const text = () => (container.textContent ?? '').replace(/\s+/g, ' ')

      // No anchor for longer than the grace period → the step degrades to the fallback.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 2700))
      })
      expect(text()).toContain('Fallback body.')
      expect(text()).toContain('isn’t on screen right now')

      // The page finishes loading: the anchor and its fields appear, already filled
      // (the Guest typed while the card was still in fallback mode).
      const anchor = document.createElement('div')
      anchor.setAttribute('data-tour', 'stay-details')
      laidOut(anchor, 200)
      const checkIn = document.createElement('input')
      checkIn.setAttribute('data-tour-field', 'check-in')
      checkIn.value = '2026-11-10'
      const checkOut = document.createElement('input')
      checkOut.setAttribute('data-tour-field', 'check-out')
      checkOut.value = '2026-11-12'
      anchor.append(checkIn, checkOut)
      document.body.appendChild(anchor)

      // The spotlight loop notices the anchor, the fallback lifts …
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120))
      })
      expect(text()).toContain('Real body.')
      expect(text()).not.toContain('isn’t on screen right now')

      // … and the re-evaluation advances on the values that are already there.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 900))
      })
      expect(text()).toContain('Tell us who is coming')
    },
    15_000,
  )

  it('keeps reacting to typing after the anchor turned up late', async () => {
    const steps: TourStep[] = [
      {
        id: 'name',
        title: 'Your name',
        body: 'Real body.',
        fallbackBody: 'Fallback body.',
        targets: ['guest-details'],
        await: { type: 'fields', fields: [{ field: 'guest-name', ok: (v) => v.trim().length >= 2 }] },
      },
      { id: 'after', title: 'All done here', body: 'Second step.', await: { type: 'none' } },
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push(root)
    act(() => {
      root.render(
        <MemoryRouter>
          <TourProvider steps={steps} autoOpen onDone={() => {}} onExit={() => {}}>
            <TourOverlay />
          </TourProvider>
        </MemoryRouter>,
      )
    })
    const text = () => (container.textContent ?? '').replace(/\s+/g, ' ')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2700))
    })
    expect(text()).toContain('Fallback body.')

    const anchor = document.createElement('div')
    anchor.setAttribute('data-tour', 'guest-details')
    laidOut(anchor, 160)
    const name = document.createElement('input')
    name.setAttribute('data-tour-field', 'guest-name')
    anchor.append(name)
    document.body.appendChild(anchor)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120))
    })
    expect(text()).toContain('Real body.')

    // A real keystroke now counts again.
    name.value = 'Maria'
    await act(async () => {
      name.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(text()).toContain('All done here')
  }, 15_000)
})
