// ----------------------------------------------------------------------------
// Unified Guest Messaging UI & Data Flow Tests
// Covers booking-scoped conversations, multi-stay switching, booking details
// drawer, verified quick replies, private image attachments, compact live
// location status (dismiss vs stop sharing), and strict zero-raw-ID hygiene.
// ----------------------------------------------------------------------------
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingDetailsDrawer } from '../../src/components/chat/BookingDetailsDrawer'
import { ConversationHeader } from '../../src/components/chat/ConversationHeader'
import { LiveLocationStatus } from '../../src/components/chat/LiveLocationStatus'
import { ShareLocationBar } from '../../src/components/chat/ShareLocationBar'
import { StayEntry } from '../../src/components/Account/StayEntry'
import { MessageComposer } from '../../src/components/chat/MessageComposer'
import { BUSINESS } from '../../src/config/site'
import { AuthContext } from '../../src/context/AuthContext'
import type { UseLiveLocation } from '../../src/hooks/useLiveLocation'
import type { LocationSession } from '../../src/lib/liveLocationPolicy'
import { type Booking } from '../../src/lib/storage'
import { LIMITS, resetRateLimit } from '../../src/lib/rateLimit'
import { MESSAGE_MAX } from '../../src/lib/validation'
import { MessagesPage } from '../../src/pages/MessagesPage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PUMP_MS = 12

async function pump(turns = 3) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

const mounted: Root[] = []

const SESSION: LocationSession = {
  id: 'booking-bk_test_1',
  conversation_id: 'booking-bk_test_1',
  guest_uid: 'guest-uid-alpha-991',
  active: true,
  started_at_ms: 0,
  expires_at_ms: 30 * 60_000,
  duration_minutes: 30,
  stream_secret: 'a'.repeat(32),
}

function makeSharing(over: Partial<UseLiveLocation> = {}): UseLiveLocation {
  return {
    phase: 'idle',
    resuming: false,
    session: null,
    message: null,
    countdown: null,
    lastSentAtMs: null,
    offline: false,
    fixError: null,
    blocked: null,
    start: async () => {},
    stop: async () => {},
    ...over,
  }
}

function seedBookings(bookings: Booking[]) {
  localStorage.setItem('hdl:bookings', JSON.stringify(bookings))
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk_internal_doc_88291',
    ref_id: 'HDL-7821',
    uid: 'guest-uid-alpha-991',
    guest_name: 'Maria Clara Santos',
    email: 'maria@example.com',
    phone: '09171234567',
    accommodation: 'main-house',
    check_in: '2026-12-10',
    check_out: '2026-12-12',
    guests: 6,
    stay_total: 24000,
    total_amount: 24000,
    status: 'Reserved',
    created_at: '2026-10-20T08:00:00.000Z',
    ...overrides,
  } as Booking
}

function render(node: React.ReactNode, path = '/'): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>)
  })
  mounted.push(root)
  return container
}

function asGuest(uid = 'guest-uid-alpha-991', email = 'maria@example.com', name = 'Maria Clara Santos') {
  const current = (AuthContext as unknown as { _currentValue: Record<string, unknown> })._currentValue
  return {
    ...current,
    user: { uid, email, displayName: name },
    profile: { uid, email, name, role: 'guest' },
    role: 'guest' as const,
    loading: false,
  }
}

function renderPage(uid?: string, bookingId: string | null = 'bk_internal_doc_88291'): HTMLElement {
  return render(
    <AuthContext.Provider value={asGuest(uid) as never}>
      <MessagesPage />
    </AuthContext.Provider>,
    bookingId ? `/messages?booking=${encodeURIComponent(bookingId)}` : '/messages',
  )
}

function findButton(container: ParentNode, label: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => label.test(b.textContent ?? '') || label.test(b.getAttribute('aria-label') ?? ''),
  )
  if (!found) throw new Error(`no button matching ${label}`)
  return found
}

function setTextareaValue(textarea: HTMLTextAreaElement, nextValue: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, nextValue)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

let objectUrlSequence = 0

beforeEach(() => {
  resetRateLimit()
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

describe('unified booking-scoped conversation screen', () => {
  it('requires an explicitly selected reservation even if bookings exist', async () => {
    seedBookings([makeBooking()])
    const container = renderPage(undefined, null)
    await pump(4)
    expect(container.textContent).toContain('Select a reservation')
    expect(container.querySelector('a[href="/mybookings"]')).toBeTruthy()
    expect(container.querySelector('[role="log"]')).toBeNull()
  })

  it('does not open an unknown booking', async () => {
    seedBookings([makeBooking()])
    const container = renderPage(undefined, 'foreign-booking')
    await pump(4)
    expect(container.textContent).toContain('Reservation unavailable')
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('does not open a booking owned by a different account even if the email matches', async () => {
    seedBookings([makeBooking({ uid: 'different-guest' })])
    const container = renderPage()
    await pump(4)
    expect(container.textContent).toContain('Reservation unavailable')
    expect(container.querySelector('[role="log"]')).toBeNull()
  })

  it('offers a booking-specific message link on each reservation', async () => {
    const container = render(<StayEntry booking={makeBooking({ id: 'bk/one' })} />)
    await pump(2)
    expect(container.querySelector('a[href="/messages?booking=bk%2Fone"]')?.textContent)
      .toContain('Message about this reservation')
  })

  it('keeps location consent in a compact control and starts only after choosing a duration', () => {
    const start = vi.fn()
    const container = render(<ShareLocationBar sharing={makeSharing({ start })} />)
    expect(container.textContent).not.toContain('Sharing stops automatically')
    act(() => findButton(container, /Share live location/i).click())
    expect(container.textContent).toContain('Share your live location with the Admin')
    act(() => findButton(container, /15 minutes/i).click())
    expect(start).toHaveBeenCalledWith(15)
  })

  it('opens only the selected booking in a clean workspace', async () => {
    seedBookings([makeBooking()])
    const container = renderPage()
    await pump(4)
    expect(container.textContent).toContain('Guest Messages')
    expect(container.textContent).toContain('Start your conversation')
    expect(container.querySelector('.messages-topics, .messages-conversation-header, .messages-switcher')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).not.toContain('Hacienda de LuisAna · Concierge')
    expect(container.querySelector('[data-tour="message-composer"]')).toBeTruthy()
    expect(container.querySelector('a[href="tel:+639258507707"]')).toBeTruthy()
    expect(container.querySelector('[role="log"]')).toBeTruthy()
  })

  it('sends to the explicitly selected booking without mixing another booking', async () => {
    seedBookings([
      makeBooking({ id: 'bk_stay_one', ref_id: 'HDL-7821' }),
      makeBooking({ id: 'bk_stay_two', ref_id: 'HDL-9042', accommodation: 'house-a-camping' }),
    ])
    const first = renderPage(undefined, 'bk_stay_one')
    await pump(4)
    const textarea = first.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement
    act(() => setTextareaValue(textarea, 'Hello from first booking'))
    await pump(1)
    act(() => findButton(first, /^Send message$/i).click())
    await pump(3)
    expect(first.querySelector('[role="log"]')?.textContent).toContain('Hello from first booking')
    const second = renderPage(undefined, 'bk_stay_two')
    await pump(4)
    expect(second.querySelector('[role="log"]')?.textContent).not.toContain('Hello from first booking')
    expect(second.querySelector('[role="log"]')?.textContent).toContain('Start your conversation')
  })

  it('clears the old thread and draft when the booking URL changes in place', async () => {
    seedBookings([
      makeBooking({ id: 'bk_1', ref_id: 'HDL-1111' }),
      makeBooking({ id: 'bk_2', ref_id: 'HDL-2222' }),
    ])
    localStorage.setItem('hdl:chat', JSON.stringify([{
      id: 'old', convo_id: 'local:booking-bk_1', sender_uid: 'guest-uid-alpha-991',
      mine: true, text: 'First booking only', at: '2026-10-20T10:00:00Z',
    }]))
    function Screen() {
      const navigate = useNavigate()
      return <><button onClick={() => navigate('/messages?booking=bk_2')}>Next reservation</button><MessagesPage /></>
    }
    const container = render(<AuthContext.Provider value={asGuest() as never}><Screen /></AuthContext.Provider>, '/messages?booking=bk_1')
    await pump(4)
    expect(container.querySelector('[role="log"]')?.textContent).toContain('First booking only')
    const textarea = container.querySelector('textarea')!
    act(() => setTextareaValue(textarea, 'Draft for first booking'))
    act(() => findButton(container, /Next reservation/).click())
    await pump(4)
    expect(container.querySelector('[role="log"]')?.textContent).not.toContain('First booking only')
    expect(container.querySelector('textarea')?.value).toBe('')
  })

  it('populates verified Hacienda directions via Send Directions quick reply and opens BookingDetailsDrawer', async () => {
    seedBookings([makeBooking()])
    const container = renderPage()
    await pump(4)

    // Click "Send Directions" quick reply chip.
    act(() => findButton(container, /^Send Directions$/i).click())
    await pump(2)

    const textarea = container.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement
    expect(textarea.value).toContain(BUSINESS.address.formatted)
    expect(textarea.value).toContain(BUSINESS.contact.directions)
    expect(textarea.value).toContain('map pin is approximate')
    expect(textarea.value).not.toContain('Verified directions')

    // Open Booking Details drawer.
    act(() => findButton(container, /Booking details/i).click())
    await pump(2)

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('The Main House')
    expect(dialog?.textContent).toContain('HDL-7821')
    expect(dialog?.textContent).toContain('6 guests')
    expect(dialog?.textContent).toContain(BUSINESS.contact.phoneDisplay)
  })

  it('loads the newest 40 messages of a 140-message booking thread and paginates 30 older on demand', async () => {
    seedBookings([makeBooking({ id: 'bk_paged', ref_id: 'HDL-5050' })])
    const seededMessages = Array.from({ length: 140 }, (_, i) => ({
      id: `msg-${i + 1}`,
      convo_id: 'local:booking-bk_paged',
      sender_uid: 'guest-uid-alpha-991',
      mine: true,
      text: `MessageEntry-${String(i + 1).padStart(3, '0')}`,
      at: new Date(Date.UTC(2026, 9, 20, 0, i, 0)).toISOString(),
    }))
    localStorage.setItem('hdl:chat', JSON.stringify(seededMessages))

    const container = renderPage(undefined, 'bk_paged')
    await pump(4)

    const logRegion = container.querySelector('[role="log"]')!
    // Initial page: newest 40 (#101..#140).
    expect(logRegion.textContent).toContain('MessageEntry-140')
    expect(logRegion.textContent).toContain('MessageEntry-101')
    expect(logRegion.textContent).not.toContain('MessageEntry-100')

    // Click "Load earlier messages" -> 40 older (#61..#100) prepend cleanly.
    act(() => findButton(container, /Load earlier messages/i).click())
    await pump(3)

    expect(logRegion.textContent).toContain('MessageEntry-100')
    expect(logRegion.textContent).toContain('MessageEntry-061')
    expect(logRegion.textContent).not.toContain('MessageEntry-060')
  })

  it('validates image attachments and sends a valid private PNG attachment into the timeline', async () => {
    seedBookings([makeBooking()])
    const container = renderPage()
    await pump(4)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    // Reject an unsupported PDF file with a clear inline error.
    const badPdf = new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' })
    Object.defineProperty(fileInput, 'files', { value: [badPdf], configurable: true })
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await pump(1)
    expect(container.textContent).toMatch(/JPEG, PNG, or WebP/i)

    // Attach a valid 1 KB PNG image and send it without text.
    const validPng = new File([new Uint8Array(512)], 'gate-arrival.png', { type: 'image/png' })
    Object.defineProperty(fileInput, 'files', { value: [validPng], configurable: true })
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await pump(2)

    expect(container.textContent).toContain('gate-arrival.png')
    act(() => findButton(container, /^Send message$/i).click())
    await pump(4)

    // Attachment preview clears after send and MessageAttachmentView renders in the timeline.
    expect(container.querySelector('.messages-attachment-preview')).toBeNull()
    expect(container.querySelector('.messages-attachment')).toBeTruthy()
  })

  it('allows short chat replies like "OK" and enforces LIMITS.chat cooldown without losing the draft', async () => {
    seedBookings([makeBooking()])
    const container = renderPage()
    await pump(4)

    const textarea = container.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement

    // 1st message: short chat reply "OK" succeeds (validateMessage untouched)
    act(() => setTextareaValue(textarea, 'OK'))
    await pump(1)
    act(() => findButton(container, /^Send message$/i).click())
    await pump(3)
    expect(textarea.value).toBe('')
    expect(container.textContent).toContain('OK')

    // Send remaining messages up to LIMITS.chat.max
    for (let i = 1; i < LIMITS.chat.max; i++) {
      act(() => setTextareaValue(textarea, `Ping ${i}`))
      await pump(1)
      act(() => findButton(container, /^Send message$/i).click())
      await pump(2)
    }

    // Next rapid send hits LIMITS.chat cooldown and preserves the typed text
    act(() => setTextareaValue(textarea, 'Hold this draft during cooldown'))
    await pump(1)
    act(() => findButton(container, /^Send message$/i).click())
    await pump(2)

    expect(container.textContent).toMatch(/Too many attempts/i)
    expect(textarea.value).toBe('Hold this draft during cooldown')
  })
})

describe('the composer', () => {
  function renderComposer(over: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
    function Wrapper() {
      const [value, setValue] = useState(over.value ?? '')
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

  it('enforces the 1,000-character message limit and shows live count', async () => {
    const container = renderComposer({ value: 'hello' })
    await pump(1)
    const input = container.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement
    expect(input).toBeTruthy()
    expect(input.maxLength).toBe(MESSAGE_MAX)
    expect(container.textContent).toContain('5/1000')
  })

  it('surfaces send/attachment errors with a working Retry action', async () => {
    const onRetry = vi.fn()
    const container = renderComposer({
      value: 'Gate photo',
      error: 'The image could not be sent. Check your connection and retry.',
      onRetry,
    })
    await pump(1)

    expect(container.textContent).toContain('The image could not be sent.')
    act(() => findButton(container, /Retry/i).click())
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('📍 LiveLocationStatus compact bar & dismiss/re-expand flow', () => {
  it('renders nothing when sharing is idle', async () => {
    const container = render(<LiveLocationStatus sharing={makeSharing()} />)
    await pump(1)
    expect(container.textContent).toBe('')
  })

  it('separates minimizing the banner from Stop Sharing and stays discoverable in header', async () => {
    const stop = vi.fn(async () => {})
    function Harness() {
      const [dismissed, setDismissed] = useState(false)
      const activeSharing = makeSharing({
        phase: 'active',
        session: SESSION,
        countdown: '28:14',
        lastSentAtMs: Date.now(),
        stop,
      })
      return (
        <div>
          <ConversationHeader
            guestName="Maria Clara Santos"
            propertyName="The Main House"
            bookingReference="HDL-7821"
            onToggleBookingDetails={() => {}}
            liveLocationActive={activeSharing.phase === 'active'}
            liveLocationCountdown={activeSharing.countdown}
            liveLocationDismissed={dismissed}
            onExpandLiveLocation={() => setDismissed(false)}
          />
          <LiveLocationStatus
            sharing={activeSharing}
            dismissed={dismissed}
            onDismiss={() => setDismissed(true)}
          />
        </div>
      )
    }

    const container = render(<Harness />)
    await pump(1)

    expect(container.textContent).toContain('Live Location Active')
    expect(container.textContent).toContain('28:14 remaining')
    // Never invents a fake ETA.
    expect(container.textContent).not.toMatch(/\bETA\b/i)

    // Minimize banner: hides the bar WITHOUT stopping sharing, and reveals header pill.
    act(() => findButton(container, /Minimize live location bar/i).click())
    await pump(1)
    expect(stop).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Live Location Active')
    expect(container.textContent).toContain('Sharing · 28:14')

    // Re-expand from header pill, then press Stop Sharing.
    act(() => findButton(container, /Show active live location status bar/i).click())
    await pump(1)
    expect(container.textContent).toContain('Live Location Active')

    act(() => findButton(container, /^Stop Sharing$/i).click())
    await pump(1)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('handles legacy/unlinked BookingDetailsDrawer gracefully without raw IDs', async () => {
    render(
      <BookingDetailsDrawer
        open={true}
        onClose={() => {}}
        booking={null}
        fallbackPropertyName="Earlier · Booking inquiry"
      />,
    )
    await pump(1)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('earlier inquiry')
    expect(dialog?.textContent).toContain(BUSINESS.address.formatted)
  })
})
