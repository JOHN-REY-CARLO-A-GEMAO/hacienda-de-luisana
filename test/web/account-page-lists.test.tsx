// The three ways a Guest could lose something on /account, plus the boundary
// that catches a page failing to draw.
//
// 1. The list used to render the first `pageSize` records and stop, with no
//    control to reach the rest: six bookings and the sixth was simply not on the
//    page. The Pager is mounted now, so this pins both halves of that.
// 2. Withdrawing released the held dates on a single unconfirmed tap.
// 3. A throw in any component used to white-screen the whole site.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '../../src/pages/AccountPage'
import { ConfirmDialog } from '../../src/components/ConfirmDialog'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { AuthContext, type AuthContextType } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'
import { can, type Permission } from '../../src/lib/auth'
import type { Actor } from '../../src/lib/booking'
import type { Booking } from '../../src/lib/storage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

const GUEST_UID = 'guest-under-test'

function booking(n: number): Booking {
  return {
    id: `bk-${n}`,
    ref_id: `HDL-${1000 + n}`,
    uid: GUEST_UID,
    guest_name: `Test Guest ${n}`,
    email: `guest${n}@example.com`,
    guest_phone: '09171234567',
    accommodation: 'main-house',
    check_in: '2026-12-01',
    check_out: '2026-12-03',
    guests: 2,
    status: 'Pending',
    created_at: new Date(Date.UTC(2026, 9, n, 4)).toISOString(),
    hold_expires_at: new Date(Date.UTC(2026, 10, 1, 4)).toISOString(),
    payment_proof_url: 'payments/guest/HDL/proof.png',
    amount_claimed: 12000,
    amount_due: 12000,
    stay_total: 24000,
  } as unknown as Booking
}

/** Six bookings, so page 1 at five per page leaves one behind. */
const SIX = [1, 2, 3, 4, 5, 6].map(booking)

/** A signed-in Guest, so the page shows the controls a Guest actually has. */
const GUEST_SESSION: AuthContextType = {
  user: {
    uid: GUEST_UID,
    email: 'guest@example.com',
    displayName: 'Test Guest',
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
  actor: { kind: 'guest', uid: GUEST_UID, name: 'Test Guest' } as unknown as Actor,
  login: async () => {},
  register: async () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
  refresh: async () => {},
}

function open(children: React.ReactNode, session: AuthContextType = GUEST_SESSION) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(
      <MemoryRouter>
        <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
      </MemoryRouter>,
    )
  })
  return {
    container,
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    button: (label: string) =>
      [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)),
    click: (el: HTMLElement | undefined) => {
      if (!el) throw new Error('expected a button on the page but found none')
      act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    },
  }
}

/** The page under test, reading a fixed list instead of the database. */
function openAccount(list: Booking[] = SIX) {
  vi.spyOn(cloudBookingsDB, 'subscribeMine').mockImplementation((_uid, callback) => {
    callback(list)
    return () => {}
  })
  return open(<AccountPage />)
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

describe('the Pager on /account', () => {
  it('offers a way past the first page when there are more records than fit', () => {
    const page = openAccount()

    // Newest first, so page one holds 1006..1002 and 1001 is the one at risk.
    expect(page.text()).toContain('Request HDL-1006')
    expect(page.text()).toContain('6 records')
    expect(page.text()).toContain('Page 1 of 2')
    expect(page.text()).not.toContain('Request HDL-1001')
  })

  it('reaches the records on the next page', () => {
    const page = openAccount()

    page.click(page.button('Next'))

    expect(page.text()).toContain('Request HDL-1001')
    expect(page.text()).toContain('Page 2 of 2')
  })

  it('says so when the search matches nothing, instead of showing an empty page', () => {
    const page = openAccount()
    const search = page.container.querySelector<HTMLInputElement>('input[placeholder="Search bookings"]')
    expect(search).toBeTruthy()

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(search!, 'nobody-by-that-name')
    act(() => search!.dispatchEvent(new Event('input', { bubbles: true })))

    expect(page.text()).toContain('No bookings match those filters')
    expect(page.text()).toContain('Clear search and filters')
    expect(page.text()).not.toContain('Request HDL-1006')
  })

  it('brings the list back when the search is cleared', () => {
    const page = openAccount()
    const search = page.container.querySelector<HTMLInputElement>('input[placeholder="Search bookings"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

    setter?.call(search!, 'nobody-by-that-name')
    act(() => search!.dispatchEvent(new Event('input', { bubbles: true })))
    expect(page.text()).toContain('No bookings match those filters')

    page.click(page.button('Clear search and filters'))

    expect(page.text()).not.toContain('No bookings match those filters')
    expect(page.text()).toContain('Request HDL-1006')
  })

  it('keeps a single-page list free of a pager', () => {
    const page = openAccount([booking(1)])
    expect(page.text()).not.toContain('Page 1 of')
  })
})

describe('confirming a withdrawal', () => {
  it('asks first, names the request, and Cancel changes nothing', () => {
    const transition = vi.spyOn(cloudBookingsDB, 'transition').mockResolvedValue({ ok: true } as never)
    const page = openAccount()

    // No dialog before the tap: nothing to confirm yet.
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
    page.click(page.button('Withdraw this request'))

    const dialog = page.container.querySelector('[role="alertdialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('Withdraw this request?')
    expect(dialog?.textContent).toContain('HDL-1006')
    expect(dialog?.textContent).toContain('2026-12-01')

    page.click(page.button('Keep it'))
    expect(transition).not.toHaveBeenCalled()
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('treats Escape as Cancel', () => {
    const transition = vi.spyOn(cloudBookingsDB, 'transition').mockResolvedValue({ ok: true } as never)
    const page = openAccount()
    page.click(page.button('Withdraw this request'))

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    expect(transition).not.toHaveBeenCalled()
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('runs the cancellation only when the second button is pressed', () => {
    const transition = vi.spyOn(cloudBookingsDB, 'transition').mockResolvedValue({ ok: true } as never)
    const page = openAccount()

    page.click(page.button('Withdraw this request'))
    page.click(page.button('Withdraw request'))

    expect(transition).toHaveBeenCalledTimes(1)
    expect(transition.mock.calls[0][0]).toBe('bk-6')
    expect(transition.mock.calls[0][1]).toMatchObject({ type: 'Cancel' })
  })
})

describe('ConfirmDialog on its own', () => {
  it('renders nothing while closed', () => {
    const page = open(
      <ConfirmDialog
        open={false}
        title="Remove this?"
        body="It cannot come back."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(page.container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('offers Cancel and the action, and reports which one was taken', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const page = open(
      <ConfirmDialog
        open
        danger
        title="Remove this?"
        body="It cannot come back."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(page.text()).toContain('It cannot come back.')
    expect(page.button('Cancel')).toBeTruthy()

    page.click(page.button('Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    page.click(page.button('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('the error boundary', () => {
  function Explodes({ boom }: { boom: boolean }) {
    if (boom) throw new Error('the widget could not draw')
    return <p>the page is fine</p>
  }

  it('renders its children while nothing is wrong', () => {
    const page = open(
      <ErrorBoundary>
        <Explodes boom={false} />
      </ErrorBoundary>,
    )
    expect(page.text()).toContain('the page is fine')
  })

  it('contains a throw instead of white-screening, and says what happened', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const page = open(
      <ErrorBoundary>
        <Explodes boom />
      </ErrorBoundary>,
    )

    expect(page.text()).toContain('This page could not be shown')
    expect(page.text()).toContain('the widget could not draw')
    // A way out, not a dead end.
    expect(page.button('Try again')).toBeTruthy()
    expect(page.container.querySelector('a[href="/"]')).toBeTruthy()
  })

  it('recovers to the children when Try again is pressed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Flaky({ boom }: { boom: boolean }) {
      if (boom) throw new Error('transient')
      return <p>recovered</p>
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push(root)
    let shouldThrow = true
    function Harness() {
      return (
        <ErrorBoundary>
          <Flaky boom={shouldThrow} />
        </ErrorBoundary>
      )
    }
    const draw = () => act(() => root.render(<Harness />))

    draw()
    expect(container.textContent).toContain('This page could not be shown')

    // Recovery is the button's job: re-rendering the same tree leaves the caught
    // error in place, which is React's contract and what the button exists for.
    shouldThrow = false
    draw()
    expect(container.textContent).toContain('This page could not be shown')

    const retry = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Try again'),
    )
    expect(retry).toBeTruthy()
    act(() => retry!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))

    expect(container.textContent).toContain('recovered')
  })
})