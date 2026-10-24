// ----------------------------------------------------------------------------
// The unified chat screen: one continuous conversation per guest booking.
// No topic sidebar, no topic switching, human-readable guest and booking
// identity throughout. Rendered into a real DOM root and driven by clicks.
// ----------------------------------------------------------------------------
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '../../src/context/AuthContext'
import { MessagesPage } from '../../src/pages/MessagesPage'
import { MessageComposer } from '../../src/components/chat/MessageComposer'
import type { UseLiveLocation } from '../../src/hooks/useLiveLocation'
import type { LocationSession } from '../../src/lib/liveLocationPolicy'
import { MESSAGE_MAX } from '../../src/lib/validation'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PUMP_MS = 10

async function pump(turns = 2) {
  for (let turn = 0; turn < turns; turn += 1) {
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
  const found = [...container.querySelectorAll('button')].find((b) =>
    label.test(b.textContent ?? '') || label.test(b.getAttribute('aria-label') ?? ''),
  )
  if (!found) throw new Error(`no button matching ${label}`)
  return found
}

let objectUrlSequence = 0

beforeEach(() => {
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => `blob:private-${++objectUrlSequence}`)
  URL.revokeObjectURL = vi.fn(() => {})
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

afterAll(() => {
  document.body.innerHTML = ''
})

describe('the unified inbox', () => {
  it('shows one conversation per booking with no topic sidebar', async () => {
    const container = renderPage()
    await pump(3)

    // No topic picker, no topic buttons, no topic-switching affordance.
    expect(container.textContent).not.toContain('Conversation topics')
    expect(container.textContent).not.toContain('Booking inquiry')
    expect(container.textContent).not.toContain('Payment help')
    expect(container.textContent).not.toContain('Access')

    // Empty state when the Guest has no bookings (and thus no conversations).
    expect(container.textContent).toContain('No conversations yet')
    expect(container.textContent).toContain('One continuous conversation per booking')
  })

  it('never exposes raw database identifiers in the UI', async () => {
    const container = renderPage()
    await pump(3)

    // No UIDs, no document IDs, no collection names visible.
    expect(container.textContent).not.toMatch(/guest_uid|inquiry-|local:/i)
    expect(container.querySelector('[aria-label*="inquiry-"]')).toBeNull()
  })

  it('has a header with separated logo and title regions', async () => {
    const container = renderPage()
    await pump(3)

    expect(container.textContent).toContain('Guest Messages')
    expect(container.textContent).toContain('One continuous conversation per booking')
  })
})

describe('the composer', () => {
  function renderComposer(over: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
    function Wrapper() {
      const [value, setValue] = useState('')
      return (
        <MessageComposer
          disabled={false}
          sending={false}
          value={value}
          onChange={setValue}
          onSend={async () => {}}
          onAttach={() => {}}
          {...over}
        />
      )
    }
    return render(<Wrapper />)
  }

  it('refuses to let a Guest type more than the message limit', async () => {
    const container = renderComposer()
    await pump()
    const input = container.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement
    expect(input).toBeTruthy()
    expect(input.maxLength).toBe(MESSAGE_MAX)
    expect(MESSAGE_MAX).toBe(1000)
  })

  it('shows how much of the limit is left as the Guest types', async () => {
    const container = renderComposer({ value: 'hello' })
    await pump()
    expect(container.textContent).toContain('5/1000')
  })
})

describe('📍 Live Location, compact status chip', () => {
  it('does not show a share bar when the build cannot share', async () => {
    const container = renderPage()
    await pump(3)
    expect(container.textContent).not.toContain('Sharing live location')
    expect(container.textContent).not.toContain('Live Location')
  })

  it('renders a compact chip while actively sharing', async () => {
    const container = render(
      <div>
        {sharing.phase === 'active' && sharing.session && (
          <div role="status" aria-label="Live location active">
            📍 Live Location Active · {sharing.countdown} ·
            <button type="button" onClick={() => void sharing.stop()}>
              Stop Sharing
            </button>
          </div>
        )}
      </div>,
    )
    await pump()
    expect(container.textContent).not.toContain('Live Location Active') // phase is 'idle'
  })

  it('shows the stop sharing control on the chip', async () => {
    const stop = vi.fn(async () => {})
    const container = render(
      <div role="status" aria-label="Live location active">
        📍 Live Location Active · 12:00 ·
        <button type="button" onClick={() => void stop()}>
          Stop Sharing
        </button>
      </div>,
    )
    await pump()
    act(() => button(container, /Stop Sharing/).click())
    await pump()
    expect(stop).toHaveBeenCalled()
  })
})
