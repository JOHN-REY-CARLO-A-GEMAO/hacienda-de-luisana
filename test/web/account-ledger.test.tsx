// The shape of /account — the guest book — pinned against the source and a
// rendered page.
//
// Every rule here is one `docs/ACCOUNT.md` argues for, and several of them had
// already regressed once before they were written down: a stay whose length had
// to be computed by the reader, a record nobody opened because it was always
// open, an entry that was a card again. A test cannot see how a page looks, but
// it can see the structures that decide it: the date margin, the disclosure, the
// tablist's contract, and whether a completed stay still takes a photograph.
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '../../src/pages/AccountPage'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'
import { can, type Permission } from '../../src/lib/auth'
import { staySpan, nightsBetween, countdownLabel, accommodationName } from '../../src/components/Account/stayFacts'
import type { Actor } from '../../src/lib/booking'
import type { Booking } from '../../src/lib/storage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []
const GUEST_UID = 'guest-under-test'

const read = (path: string) => readFileSync(path, 'utf8')

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    ref_id: 'HDL-2401',
    uid: GUEST_UID,
    guest_name: 'Ana Reyes',
    email: 'ana@example.com',
    guest_phone: '09171234567',
    accommodation: 'main-house',
    check_in: '2026-11-20',
    check_out: '2026-11-23',
    guests: 9,
    status: 'Reserved',
    created_at: '2026-10-06T04:00:00.000Z',
    hold_expires_at: '2026-10-07T04:00:00.000Z',
    amount_due: 12000,
    stay_total: 24000,
    security_deposit: 2000,
    ...over,
  } as unknown as Booking
}

const GUEST_SESSION: AuthContextType = {
  user: {
    uid: GUEST_UID,
    email: 'ana@example.com',
    displayName: 'Ana Reyes',
    isAnonymous: false,
    provider: 'password',
  },
  profile: null,
  role: 'guest',
  loading: false,
  status: 'signed-in',
  isConfigured: false,
  isCloud: false,
  can: (permission: Permission) => can('guest', permission),
  canOpen: () => true,
  actor: { kind: 'guest', uid: GUEST_UID, name: 'Ana Reyes' } as unknown as Actor,
  login: async () => {},
  register: async () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
  refresh: async () => {},
}

function openAccount(list: Booking[]) {
  vi.spyOn(cloudBookingsDB, 'subscribeMine').mockImplementation((_uid, callback) => {
    callback(list)
    return () => {}
  })
  vi.spyOn(cloudBookingsDB, 'history').mockResolvedValue([])
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(
      <MemoryRouter>
        <AuthContext.Provider value={GUEST_SESSION}>
          <AccountPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    )
  })
  return {
    container,
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    tab: (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
        (b.textContent ?? '').includes(label),
      ),
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
  localStorage.setItem(
    LOCAL_RATES_KEY,
    JSON.stringify({
      version: 'test-v1',
      effective_date: '2026-10-01',
      holiday_dates: [],
      accommodations: {
        'main-house': {
          property_name: 'The Main House',
          rate_unit: 'standard_stay',
          active: true,
          security_deposit: 0,
          down_payment_percent: 50,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
          },
        },
      },
    }),
  )
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  resetAppSession()
})

describe('the date margin', () => {
  it('writes a range the way a document does, without repeating the month', () => {
    expect(staySpan('2026-11-20', '2026-11-22').long).toBe('20 – 22 November 2026')
    expect(staySpan('2026-11-20', '2026-11-22')).toMatchObject({ month: 'Nov', days: '20 – 22', year: '2026' })
  })

  it('says so when a stay crosses a month or a year', () => {
    expect(staySpan('2026-12-30', '2027-01-02').long).toBe('30 December 2026 – 2 January 2027')
    expect(staySpan('2026-12-30', '2027-01-02').year).toBe('2026 – 2027')
    expect(staySpan('2026-11-30', '2026-12-02').long).toBe('30 November – 2 December 2026')
  })

  it('counts nights, so no reader has to subtract two dates', () => {
    expect(nightsBetween('2026-11-20', '2026-11-23')).toBe(3)
    expect(nightsBetween('2026-11-20', '2026-11-20')).toBe(0)
    expect(nightsBetween('not-a-date', '2026-11-20')).toBe(0)
  })

  it('names the distance to a stay, and stops once it has no useful answer', () => {
    const now = new Date('2026-11-17T02:00:00Z')
    expect(countdownLabel('2026-11-20', '2026-11-23', now)).toBe('3 days away')
    expect(countdownLabel('2026-11-18', '2026-11-20', now)).toBe('Check-in tomorrow')
    expect(countdownLabel('2026-11-17', '2026-11-19', now)).toBe('Check-in today')
    expect(countdownLabel('2026-11-16', '2026-11-19', now)).toBe('You are staying now')
    expect(countdownLabel('2026-10-01', '2026-10-03', now)).toBeNull()
  })

  it('turns an unknown accommodation key into words rather than shipping it raw', () => {
    // A retired unit the catalogue no longer lists: the Guest reads words, not a key.
    expect(accommodationName('garden-suite')).toBe('Garden Suite')
    // A key the catalogue does know keeps the Hacienda's own name for it.
    expect(accommodationName('main-house')).toBe('The Main House')
    expect(accommodationName('house-a-camping')).toBe('A-House')
  })

  it('draws one mark per night in the margin, capped at a week', () => {
    const page = openAccount([booking({ check_in: '2026-11-20', check_out: '2026-11-27' })])

    const ticks = page.container.querySelectorAll('.ledger-date .ledger-tick')
    expect(ticks.length).toBe(7)
    // The margin, not a figure in the prose, is where the length is read from.
    expect(page.container.querySelector('.ledger-date')?.textContent).toContain('Nov')
    expect(page.container.querySelector('.ledger-date')?.textContent).toContain('20 – 27')
  })
})

describe('an entry', () => {
  it('is not a photograph per stay: the picture belongs to the page opener alone', () => {
    const page = openAccount([booking({ status: 'Completed', check_in: '2026-06-01', check_out: '2026-06-03' })])

    expect(page.container.querySelectorAll('.ledger-entry img').length).toBe(0)
    expect(page.container.querySelectorAll('.ledger-opener img').length).toBeLessThanOrEqual(1)
  })

  it('says what is outstanding in one sentence, not a grid of tinted tiles', () => {
    const page = openAccount([
      booking({
        status: 'Pending',
        amount_due: 3000,
        created_at: new Date().toISOString(),
        hold_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ])

    expect(page.container.querySelectorAll('.ledger-entry .guest-value').length).toBe(0)
    expect(page.text()).toContain('is with the Hacienda')
  })

  it('folds the stage track and the Activity log behind one disclosure', () => {
    const page = openAccount([booking()])

    const record = page.container.querySelector<HTMLDetailsElement>('details.ledger-record')
    expect(record).toBeTruthy()
    // Closed by default: what a Guest opens when something is disputed.
    expect(record?.open).toBe(false)
    expect(record?.querySelector('summary')?.textContent).toContain('Progress and activity')
    expect(record?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Booking stage')
  })

  it('does not draw a stage track for a booking that ended without a stay', () => {
    const page = openAccount([booking({ status: 'Cancelled' })])

    expect(page.container.querySelector('details.ledger-record [role="img"]')).toBeNull()
    expect(page.text()).toContain('This booking was withdrawn')
  })
})

describe('the leave switch', () => {
  it('is a real tablist, with the keyboard contract that implies', () => {
    const page = openAccount([booking()])

    const list = page.container.querySelector('[role="tablist"]')
    expect(list?.getAttribute('aria-label')).toBe('Account sections')

    const tabs = [...page.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1])

    // Each tab says which panel it controls, and that panel points back at the
    // tab that is showing it — the pair a screen reader needs to announce.
    for (const tab of tabs) expect(tab.getAttribute('aria-controls')).toBe('account-panel')
    const panel = page.container.querySelector('[role="tabpanel"]')
    expect(panel?.id).toBe('account-panel')
    expect(panel?.getAttribute('aria-labelledby')).toBe('account-tab-bookings')

    // Arrow keys move the selection and the roving tabstop with it.
    act(() => {
      list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(page.tab('My profile')?.getAttribute('aria-selected')).toBe('true')

    // Home goes back to the first leaf.
    act(() => {
      list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(page.tab('My bookings')?.getAttribute('aria-selected')).toBe('true')
  })
})

describe('the counts at the foot of the book', () => {
  it('are a sentence, and they still add up', () => {
    const page = openAccount([
      booking({
        id: 'a',
        status: 'Pending',
        check_in: '2026-12-01',
        check_out: '2026-12-03',
        created_at: new Date().toISOString(),
        hold_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      booking({ id: 'b', status: 'Reserved', check_in: '2026-12-10', check_out: '2026-12-12' }),
      booking({ id: 'c', status: 'Completed', check_in: '2026-06-01', check_out: '2026-06-03' }),
    ])

    const summary = page.container.querySelector('.ledger-summary')?.textContent?.replace(/\s+/g, ' ')
    expect(summary).toContain('3 stays on this account')
    expect(summary).toContain('waiting on the Hacienda')
  })
})

describe('the guest book is one design, in one place', () => {
  it('keeps its colour and type tokens in the stylesheet, not in components', () => {
    const offenders = ['src/components/Account/StayEntry.tsx', 'src/components/Account/Flyleaf.tsx'].filter(
      (file) => /#[0-9a-fA-F]{6}\b/.test(read(file)),
    )
    expect(offenders).toEqual([])

    const css = read('src/styles.css')
    for (const token of ['--ledger-ink', '--ledger-leaf', '--ledger-brass', '--ledger-rule']) {
      expect(css, token).toContain(token)
    }
  })

  it('leaves no component of the previous pass behind', () => {
    const barrel = read('src/components/Account/index.ts')
    for (const gone of ['BookingFolio', 'AccountRail', 'RailPanel', 'HelpPanel', 'StatusTrack']) {
      expect(barrel, gone).not.toMatch(new RegExp(`export .*\\b${gone}\\b`))
    }

    // The two primitives only that page ever rendered are gone with it.
    expect(read('src/components/ui/index.ts')).not.toContain('StatCard')
    expect(read('src/components/ui/index.ts')).not.toContain('Tabs')
  })

  it('has no dead `guest-*` rule left in the stylesheet for a class nothing renders', () => {
    const css = read('src/styles.css')
    const declared = [...css.matchAll(/^\.(guest-[a-z-]+)/gm)].map((m) => m[1])
    const sources = [
      'src/pages/AccountPage.tsx',
      'src/components/Account/StayEntry.tsx',
      'src/components/Account/Flyleaf.tsx',
      'src/components/Account/LedgerTabs.tsx',
      'src/components/Account/StayMasthead.tsx',
      'src/components/Account/StatusTrack.tsx',
      'src/components/Booking/BookingHistory.tsx',
      'src/components/Booking/HoldCountdown.tsx',
      'src/components/Booking/PaymentStep.tsx',
      'src/components/Booking/LateCheckoutRequest.tsx',
      'src/components/Booking/BookingInvoice.tsx',
      'src/components/Booking/PaymentInformationPanel.tsx',
      'src/components/Auth/ProtectedRoute.tsx',
      'src/components/chat/BookingDetailsDrawer.tsx',
      'src/components/chat/MessageBubble.tsx',
      'src/pages/BookingStatusPage.tsx',
      'src/pages/MessagesPage.tsx',
      'src/pages/DownpaymentPage.tsx',
      'src/components/ReviewForm.tsx',
    ]
      .map(read)
      .join('\n')

    const dead = [...new Set(declared)].filter((name) => !new RegExp(`\\b${name}\\b`).test(sources))
    expect(dead).toEqual([])
  })
})
