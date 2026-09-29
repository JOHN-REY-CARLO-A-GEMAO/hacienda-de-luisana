// ----------------------------------------------------------------------------
// The chat screen as a Guest actually meets it: the composer's limit, the
// "Load earlier messages" affordance, and the 📍 Live Location control.
//
// Rendered into a real DOM root and driven by clicks and typing, the way
// `payment-step.test.tsx` drives the Booking form — so what is asserted here is
// what a Guest without Firebase credentials sees, which is the case where
// honesty matters most: a share that cannot happen must say so rather than
// appear to be running.
//
// The share bar itself is driven at its own seam (a `UseLiveLocation` value in,
// the control out) because the running state needs a live session, and a
// session needs a stream transport this build does not have.
// ----------------------------------------------------------------------------
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../src/context/AuthContext'
import { ShareLocationBar } from '../../src/components/chat/ShareLocationBar'
import { MessagesPage } from '../../src/pages/MessagesPage'
import type { UseLiveLocation } from '../../src/hooks/useLiveLocation'
import type { LocationSession } from '../../src/lib/liveLocationPolicy'
import { MESSAGE_MAX } from '../../src/lib/validation'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PUMP_MS = 10

async function pump(turns = 2) {
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

const mounted: Root[] = []

const SESSION: LocationSession = {
  id: 'convo-1',
  conversation_id: 'convo-1',
  guest_uid: 'guest-ui-1',
  active: true,
  started_at_ms: 0,
  expires_at_ms: 30 * 60_000,
  duration_minutes: 30,
  stream_secret: 'a'.repeat(32),
}

/** The bar's interface: what the hook hands it, minus the two actions. */
function sharing(over: Partial<UseLiveLocation> = {}): UseLiveLocation {
  return {
    phase: 'idle',
    session: null,
    message: null,
    countdown: null,
    lastSentAtMs: null,
    offline: false,
    blocked: null,
    start: async () => {},
    stop: async () => {},
    ...over,
  }
}

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
  mounted.push(root)
  return container
}

/** The page reads the session from context, so the context is what a test sets. */
function asGuest(uid = 'guest-ui-1') {
  const current = (AuthContext as unknown as { _currentValue: Record<string, unknown> })._currentValue
  return { ...current, user: { uid, email: 'guest@example.com', displayName: 'Ana' }, role: 'guest' as const, loading: false }
}

function renderPage(): HTMLElement {
  return render(
    <AuthContext.Provider value={asGuest() as never}>
      <MessagesPage />
    </AuthContext.Provider>,
  )
}

function button(container: HTMLElement, label: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))
  if (!found) throw new Error(`no button matching ${label}`)
  return found
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

afterAll(() => {
  document.body.innerHTML = ''
})

describe('the composer', () => {
  it('refuses to let a Guest type more than the message limit', async () => {
    const container = renderPage()
    await pump()
    const input = container.querySelector('input[data-tour-field="message"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.maxLength).toBe(MESSAGE_MAX)
    expect(MESSAGE_MAX).toBe(1000)
  })

  it('shows how much of the limit is left as the Guest types', async () => {
    const container = renderPage()
    await pump()
    const input = container.querySelector('input[data-tour-field="message"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await pump()
    expect(container.textContent).toContain('5/1000')
  })
})

describe('a long thread', () => {
  it('opens one page and offers to fetch the rest, rather than reading everything', async () => {
    const messages = Array.from({ length: 140 }, (_, i) => ({
      id: `m${i}`,
      text: `message ${i}`,
      at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 1000).toISOString(),
      mine: true,
      sender_uid: 'guest-ui-1',
    }))
    localStorage.setItem('hdl:chat', JSON.stringify(messages))

    const container = renderPage()
    await pump(3)
    // Forty newest messages, not a hundred and forty.
    expect(container.querySelectorAll('li')).toHaveLength(40)
    const opened = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '')
    expect(opened.some((t) => t.includes('message 0,'))).toBe(false)
    expect(opened.some((t) => t.includes('message 139'))).toBe(true)

    act(() => button(container, /Load earlier messages/).click())
    await pump(3)
    const after = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '')
    expect(after).toHaveLength(70)
    // The older page reaches back to message 70 — the thread's own start is
    // another press away, and the control stays because there is more.
    expect(after.some((t) => t.includes('message 70'))).toBe(true)
    expect(after.some((t) => t.includes('message 69'))).toBe(false)
    // The button stays because there is more to fetch.
    expect(container.textContent).toContain('Load earlier messages')
  })

  it('hides the fetch control when there is nothing older left', async () => {
    localStorage.setItem(
      'hdl:chat',
      JSON.stringify([
        { id: 'm1', text: 'only message', at: '2026-10-01T00:00:00.000Z', mine: true, sender_uid: 'guest-ui-1' },
      ]),
    )
    const container = renderPage()
    await pump(3)
    expect(container.textContent).toContain('only message')
    expect(container.textContent).not.toContain('Load earlier messages')
  })
})

describe('📍 Live Location, offered from inside the conversation', () => {
  it('offers the three durations, and says what sharing means before it starts', async () => {
    const start = vi.fn(async () => {})
    const container = render(<ShareLocationBar sharing={sharing({ start })} />)
    await pump()
    expect(container.textContent).toMatch(/Sharing is off until you choose a time/)

    act(() => button(container, /📍 Live Location/).click())
    await pump()
    for (const minutes of ['15 minutes', '30 minutes', '60 minutes']) {
      expect(container.textContent).toContain(minutes)
    }

    act(() => button(container, /30 minutes/).click())
    await pump()
    expect(start).toHaveBeenCalledWith(30)
  })

  it('tells the Guest the Admin can see them, and how long is left, while it runs', async () => {
    const container = render(
      <ShareLocationBar
        sharing={sharing({ phase: 'active', session: SESSION, countdown: '27:43', lastSentAtMs: 1 })}
      />,
    )
    await pump()
    expect(container.textContent).toContain('Sharing live location')
    expect(container.textContent).toContain('The Admin can see your location')
    expect(container.textContent).toContain('Expires in:')
    expect(container.textContent).toContain('27:43')
  })

  it('always offers a way to stop', async () => {
    const stop = vi.fn(async () => {})
    const container = render(
      <ShareLocationBar sharing={sharing({ phase: 'active', session: SESSION, countdown: '12:00', stop })} />,
    )
    await pump()
    act(() => button(container, /Stop Sharing/).click())
    await pump()
    expect(stop).toHaveBeenCalled()
  })

  it('says it is offline rather than claiming the Admin can see a position', async () => {
    const container = render(
      <ShareLocationBar
        sharing={sharing({ phase: 'active', session: SESSION, countdown: '12:00', offline: true })}
      />,
    )
    await pump()
    expect(container.textContent).toContain('You are offline, so the position is not updating.')
  })

  it('shows a refusal instead of a share that did not happen', async () => {
    const container = render(
      <ShareLocationBar
        sharing={sharing({ phase: 'error', message: 'Location permission was refused, so nothing is being shared.' })}
      />,
    )
    await pump()
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/permission was refused/)
  })

  it('is disabled, and says why, where this build cannot share at all', async () => {
    const container = render(
      <ShareLocationBar sharing={sharing({ blocked: 'no-firebase' })} />,
    )
    await pump()
    const control = button(container, /📍 Live Location/)
    expect(control.disabled).toBe(true)
    expect(control.getAttribute('title')).toMatch(/not available/i)
  })
})

describe('the page a Guest without a cloud connection sees', () => {
  it('never shows a share as running when the build cannot share', async () => {
    // The test run has no Firebase project, so the stream transport is absent.
    // The one unforgivable failure here is a control that looks active.
    const container = renderPage()
    await pump(3)
    const control = button(container, /📍 Live Location/)
    expect(control.disabled).toBe(true)
    expect(container.textContent).not.toContain('Sharing live location')
  })
})
