// ----------------------------------------------------------------------------
// Unified Guest Messaging UI & Data Flow Tests
// Covers booking-scoped conversations, multi-stay switching, booking details
// drawer, verified quick replies, private image attachments, compact live
// location status (dismiss vs stop sharing), and strict zero-raw-ID hygiene.
// ----------------------------------------------------------------------------
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingDetailsDrawer } from '../../src/components/chat/BookingDetailsDrawer'
import { ConversationHeader } from '../../src/components/chat/ConversationHeader'
import { LiveLocationStatus } from '../../src/components/chat/LiveLocationStatus'
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

function renderPage(uid?: string): HTMLElement {
  return render(
    <AuthContext.Provider value={asGuest(uid) as never}>
      <MessagesPage />
    </AuthContext.Provider>,
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
  it('renders an honest empty state with no topic sidebar when the Guest has no bookings', async () => {
    const container = renderPage()
    await pump(3)

    expect(container.textContent).not.toContain('Conversation topics')
    expect(container.textContent).not.toContain('Booking inquiry')
    expect(container.textContent).not.toContain('Payment help')
    expect(container.textContent).not.toContain('Access / smart lock')

    expect(container.textContent).toContain('Guest Messages')
    expect(container.textContent).toContain('One continuous conversation per booking')
    expect(container.textContent).toContain('No conversations yet')
    expect(container.querySelector('a[href="/book"]')).toBeTruthy()
  })

  it('opens the unified booking conversation directly with human-readable property & reference and zero raw IDs', async () => {
    seedBookings([makeBooking()])
    const container = renderPage()
    await pump(4)

    expect(container.textContent).toContain('Hacienda de LuisAna · Concierge')
    expect(container.textContent).toContain('The Main House')
    expect(container.textContent).toContain('HDL-7821')

    // Guided tour anchors must be present in the live conversation composer.
    expect(container.querySelector('[data-tour="message-composer"]')).toBeTruthy()
    expect(container.querySelector('textarea[data-tour-field="message"]')).toBeTruthy()

    // Verified Hacienda phone action in header.
    const callLink = container.querySelector('a[href="tel:+639258507707"]')
    expect(callLink).toBeTruthy()

    // Strict zero-raw-ID check across text, aria-label, and title attributes.
    const allAttrs = [...container.querySelectorAll('*')]
      .flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? ''])
      .join(' ')
    expect(container.textContent).not.toMatch(/guest-uid-alpha-991|bk_internal_doc_88291|local:booking|main-house/)
    expect(allAttrs).not.toMatch(/guest-uid-alpha-991|bk_internal_doc_88291|local:booking|inquiry-/)
  })

  it('sends messages, updates the timeline chronologically, and keeps multi-booking threads isolated', async () => {
    seedBookings([
      makeBooking({
        id: 'bk_stay_one',
        ref_id: 'HDL-7821',
        accommodation: 'main-house',
        created_at: '2026-10-22T10:00:00.000Z',
      }),
      makeBooking({
        id: 'bk_stay_two',
        ref_id: 'HDL-9042',
        accommodation: 'house-a-camping',
        created_at: '2026-10-18T10:00:00.000Z',
      }),
    ])

    const container = renderPage()
    await pump(4)

    // Both bookings appear in the stay switcher rail with friendly names.
    expect(container.textContent).toContain('Your Stays')
    expect(container.textContent).toContain('The Main House')
    expect(container.textContent).toContain('A-House')

    // Send a message in Stay 1 (HDL-7821).
    const textarea = container.querySelector('textarea[data-tour-field="message"]') as HTMLTextAreaElement
    act(() => setTextareaValue(textarea, 'Hello from Main House booking!'))
    await pump(1)

    act(() => findButton(container, /^Send message$/i).click())
    await pump(3)

    expect(container.textContent).toContain('Hello from Main House booking!')
    expect(textarea.value).toBe('')

    // Switch to Stay 2 (A-House · HDL-9042) and verify isolation + navigation.
    const secondStayBtn = findButton(container, /A-House.*HDL-9042/i)
    act(() => secondStayBtn.click())
    await pump(3)

    const logRegion = container.querySelector('[role="log"]')!
    expect(logRegion.textContent).not.toContain('Hello from Main House booking!')
    expect(logRegion.textContent).toContain('Start your conversation')
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

  it('switches cleanly between mobile stays rail and conversation pane and filters by HDL reference', async () => {
    seedBookings([
      makeBooking({ id: 'bk_1', ref_id: 'HDL-1111', accommodation: 'main-house', created_at: '2026-10-23T10:00:00.000Z' }),
      makeBooking({ id: 'bk_2', ref_id: 'HDL-2222', accommodation: 'annex', created_at: '2026-10-21T10:00:00.000Z' }),
      makeBooking({ id: 'bk_3', ref_id: 'HDL-3333', accommodation: 'house-a-camping', created_at: '2026-10-19T10:00:00.000Z' }),
    ])

    const container = renderPage()
    await pump(4)

    const topicsAside = container.querySelector('.messages-topics')!
    const convoPane = container.querySelector('.messages-conversation')!
    expect(convoPane.classList.contains('messages-mobile-visible')).toBe(true)

    // Tap mobile Back ("Stays") button -> mobile inbox rail becomes visible.
    act(() => findButton(container, /Back to stays list/i).click())
    await pump(1)
    expect(topicsAside.classList.contains('messages-mobile-visible')).toBe(true)
    expect(convoPane.classList.contains('messages-mobile-visible')).toBe(false)

    // Filter stays by reference "HDL-2222".
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement
    expect(searchInput).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(searchInput, 'HDL-2222')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await pump(1)

    expect(topicsAside.textContent).toContain('HDL Annex')
    expect(topicsAside.textContent).not.toContain('HDL-3333')

    // Tap filtered stay -> mobile conversation pane opens for HDL-2222!
    act(() => findButton(topicsAside, /HDL Annex.*HDL-2222/i).click())
    await pump(3)
    expect(convoPane.classList.contains('messages-mobile-visible')).toBe(true)
    expect(convoPane.textContent).toContain('HDL Annex · HDL-2222')
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

    const container = renderPage()
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
