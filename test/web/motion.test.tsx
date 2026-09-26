// @vitest-environment jsdom
/**
 * The immersive layer is decorative and must switch itself off when the visitor
 * prefers reduced motion or is on a touch device. These tests pin that contract
 * and the pure geometry helper the scroll parallax relies on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TiltCard } from '../../src/components/TiltCard'
import { ParallaxImage } from '../../src/components/ParallaxImage'
import { Hero } from '../../src/sections/Hero'
import { clamp, viewportProgress, MAX_PARALLAX_RANGE } from '../../src/lib/motion'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []
function render(node: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
  return { container }
}
function cleanup() {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
}

/** jsdom has no PointerEvent — a MouseEvent carrying `pointerType` is what the hook reads. */
function pointer(type: string, init: { clientX?: number; clientY?: number; pointerType: string }) {
  const ev = new MouseEvent(type, { clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, bubbles: true })
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType })
  return ev
}

function mockMatchMedia(matches: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe('viewportProgress', () => {
  const rect = (top: number, height: number) => ({ top, height, bottom: top + height } as DOMRect)
  it('is 0 when the element is centred, ±1 at the edges of its travel', () => {
    expect(viewportProgress(rect(400, 200), 1000)).toBe(0)
    expect(viewportProgress(rect(1000, 200), 1000)).toBe(-1)
    expect(viewportProgress(rect(-200, 200), 1000)).toBe(1)
  })
  it('never leaves [-1, 1]', () => {
    expect(viewportProgress(rect(5000, 200), 1000)).toBe(-1)
    expect(viewportProgress(rect(-5000, 200), 1000)).toBe(1)
    expect(clamp(7, -1, 1)).toBe(1)
  })
  it('caps the parallax shift well inside the media bleed', () => {
    expect(MAX_PARALLAX_RANGE).toBeLessThan(0.16)
  })
})

describe('depth effects respect the visitor', () => {
  afterEach(() => {
    cleanup()
    // @ts-expect-error — restore jsdom's missing matchMedia
    delete window.matchMedia
  })

  it('TiltCard is flat when there is no matchMedia at all (jsdom / old browsers)', () => {
    const { container } = render(<TiltCard as="article">hello</TiltCard>)
    const card = container.querySelector('article')!
    expect(card.getAttribute('data-tilt')).toBe('off')
    expect(card.classList.contains('tilt-live')).toBe(false)
  })

  it('TiltCard is flat under prefers-reduced-motion even on a fine pointer', () => {
    mockMatchMedia((q) => q.includes('reduced-motion') || q.includes('hover: hover'))
    const { container } = render(<TiltCard>hello</TiltCard>)
    expect(container.firstElementChild!.getAttribute('data-tilt')).toBe('off')
  })

  it('TiltCard is flat on a coarse (touch) pointer', () => {
    mockMatchMedia((q) => q.includes('pointer: coarse') || q.includes('hover: hover'))
    const { container } = render(<TiltCard>hello</TiltCard>)
    expect(container.firstElementChild!.getAttribute('data-tilt')).toBe('off')
  })

  it('TiltCard tilts only with a fine, hover-capable pointer and motion allowed', () => {
    mockMatchMedia((q) => q.includes('hover: hover'))
    const { container } = render(<TiltCard data-testid="card">hello</TiltCard>)
    const card = container.firstElementChild as HTMLElement
    expect(card.getAttribute('data-tilt')).toBe('on')
    expect(card.classList.contains('tilt-live')).toBe(true)
    // pointer geometry is written as custom properties, never as layout
    Object.defineProperty(card, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }),
    })
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (cb(0), 1))
    card.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 0, pointerType: 'mouse' }))
    expect(card.style.getPropertyValue('--tilt-y')).not.toBe('')
    card.dispatchEvent(pointer('pointerleave', { pointerType: 'mouse' }))
    expect(card.style.getPropertyValue('--tilt-y')).toBe('')
    raf.mockRestore()
  })

  it('TiltCard ignores touch pointer moves even when enabled', () => {
    mockMatchMedia((q) => q.includes('hover: hover'))
    const { container } = render(<TiltCard>hello</TiltCard>)
    const card = container.firstElementChild as HTMLElement
    card.dispatchEvent(pointer('pointermove', { clientX: 10, clientY: 10, pointerType: 'touch' }))
    expect(card.style.getPropertyValue('--tilt-x')).toBe('')
  })
})

describe('ParallaxImage', () => {
  afterEach(cleanup)
  it('wraps the photo in a relative, clipped frame with a bleeding media layer', () => {
    const { container } = render(<ParallaxImage src="/images/gmaps/img-01.jpg" alt="Main house" className="h-40 rounded-xl" />)
    const frame = container.firstElementChild!
    expect(frame.className).toContain('parallax-frame')
    expect(frame.className).toContain('relative')
    expect(frame.querySelector('.parallax-media img')?.getAttribute('alt')).toBe('Main house')
  })
  it('does not force `relative` when the caller positions the frame absolutely', () => {
    const { container } = render(<ParallaxImage src="/images/gmaps/img-01.jpg" alt="x" className="absolute inset-0" />)
    expect(container.firstElementChild!.className).not.toMatch(/(^|\s)relative(\s|$)/)
  })
})

describe('Hero', () => {
  beforeEach(() => mockMatchMedia((q) => q.includes('reduced-motion')))
  afterEach(() => {
    cleanup()
    // @ts-expect-error — restore jsdom's missing matchMedia
    delete window.matchMedia
  })
  it('keeps its anchors and copy, and reports reduced motion without Ken Burns', () => {
    const { container } = render(<Hero />)
    const hero = container.querySelector('section.hero')!
    expect(hero.getAttribute('data-motion')).toBe('reduced')
    expect(container.querySelector('[data-tour="hero-cta"]')?.textContent).toContain('Check Availability')
    expect(container.textContent).toContain('Private countryside stay near Laguna attractions')
    expect(container.querySelector('[data-hero-layer="back"] img')?.className).not.toContain('animate-kenburns')
    // decorative foliage never intercepts taps
    const fore = container.querySelector('[data-hero-layer="fore"]')!
    expect(fore.getAttribute('aria-hidden')).toBe('true')
    expect(fore.className).toContain('pointer-events-none')
  })
})
