// The whole flow, end to end, through the real app.
//
// Not a unit of anything: `<App/>` inside the real `<AuthProvider>`, which in a
// test run has no Firebase and therefore runs on the local demo adapter — the same
// adapter the website runs on for anybody without `.env.local`. What is exercised
// is what a person does: arrive at a protected page, be asked to sign in, sign
// up as a Guest, be let in — or, as the Admin, be pointed at the mobile app —
// and sign out.
//
// Waiting is by condition, never by a fixed nap: a demo sign-in stretches a
// password through 210,000 rounds of PBKDF2 before it writes anything, so how
// long it takes belongs to the machine, not to the test.
//
// The rules that make this real in production are asserted separately
// (auth-firestore-rules.test.ts); this is the half a person can see.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** One turn of the event loop, and one React flush after it. */
const PUMP_MS = 10
/** Long enough for two PBKDF2 derivations on a loaded machine, with room to spare. */
const TIMEOUT_MS = 20_000

/** Invented for this file: what the sign-up form is filled with. */
const TYPED_AT_SIGN_UP = 'bahay-kubo-9'

/** The owner's address — on the bootstrap allowlist, so it arrives as the Admin. */
const ADMIN_ADDRESS = 'haciendadeluisiana@gmail.com'

const mounted: Root[] = []

async function pump(turns = 1) {
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PUMP_MS))
    })
  }
}

type Page = {
  text: () => string
  html: () => string
  container: HTMLElement
  /** Pump the event loop until this shows up on the page, or give up loudly. */
  wait: (match: string | RegExp) => Promise<void>
  /** Pump a few turns when there is nothing to wait for — an absence, say. */
  settle: (turns?: number) => Promise<void>
}

function openAt(path: string): Page {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    )
  })

  const text = () => (container.textContent ?? '').replace(/\s+/g, ' ')

  return {
    text,
    html: () => container.innerHTML,
    container,
    settle: (turns = 4) => pump(turns),
    wait: async (match) => {
      const found = () => (typeof match === 'string' ? text().includes(match) : match.test(text()))
      const deadline = Date.now() + TIMEOUT_MS
      while (!found()) {
        if (Date.now() > deadline) {
          throw new Error(`gave up waiting for ${String(match)} — the page reads: ${text().slice(0, 400)}`)
        }
        await pump()
      }
    },
  }
}

/** Click the first button or link whose text answers to `label`. */
function click(page: Page, label: RegExp) {
  const target = [...page.container.querySelectorAll('button, a')].find((element) =>
    label.test(element.textContent ?? ''),
  )
  if (!target) throw new Error(`nothing to click matching ${label} in: ${page.text().slice(0, 300)}`)
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Fill a field the way a keystroke would, so React hears about it. */
function type(page: Page, selector: string, value: string) {
  const input = page.container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`no input at ${selector}`)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(page: Page) {
  const form = page.container.querySelector('form')
  if (!form) throw new Error('no form on the page')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  localStorage.clear()
  // One website has one session; a test run has fifteen. Drop it so no case
  // inherits the last one's identity.
  resetAppSession()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

/** Sign up through the form on the page, the way a person does. */
async function signUp(page: Page, email: string, name = 'Maria Santos') {
  click(page, /Create one/)
  type(page, 'input[autocomplete="name"]', name)
  type(page, 'input[type="email"]', email)
  type(page, 'input[type="password"]', TYPED_AT_SIGN_UP)
  await submit(page)
}

describe('arriving at a page that is not public', () => {
  it('asks who you are before it shows anything', () => {
    const account = openAt('/account')
    expect(account.text()).toContain('Sign in')
    expect(account.text()).not.toContain('No bookings on this account yet')
  })

  it('says the site is in demo mode, and offers no role to step into', () => {
    const page = openAt('/account')

    expect(page.text()).toContain('Demo mode')
    expect(page.text()).toContain('Signing up here makes you a Guest')
    expect(page.text()).not.toMatch(/Continue as (Host|Staff|Admin|Guest)/)
    expect(page.text()).not.toMatch(/\bStaff\b|\bHost\b/)
  })
})

describe('the retired web dashboards', () => {
  it('answer with a signpost to the Admin app, and no sign-in form', () => {
    for (const path of ['/admin', '/app', '/app/tracking', '/admin/auth']) {
      const page = openAt(path)
      expect(page.text(), path).toContain('The Admin dashboard moved')
      expect(page.text(), path).toContain('Admin')
      expect(page.text(), path).not.toContain('Admin Control Center')
      expect(page.text(), path).not.toContain('Booker Requests')
      expect(page.container.querySelector('form'), path).toBeNull()
    }
  })
})

describe('the Admin', () => {
  it('is recognised by address, turned away from the Guest page, and pointed at the app', async () => {
    const page = openAt('/account')

    await signUp(page, ADMIN_ADDRESS, 'Ana Luisana')
    await page.wait('This website is for Guests')

    expect(page.text()).toContain('Admin')
    expect(page.text()).toContain(ADMIN_ADDRESS)
    expect(page.text()).toContain('Admin mobile app')
    expect(page.text()).not.toContain('No bookings on this account yet')
    // The Nav offers no dashboard, because there is none on the website.
    expect(page.html()).not.toContain('href="/admin"')
    expect(page.html()).not.toContain('href="/app"')
  }, TIMEOUT_MS)

  it('is signed out again, and the notice goes with the session', async () => {
    const page = openAt('/account')
    await signUp(page, ADMIN_ADDRESS, 'Ana Luisana')
    await page.wait('This website is for Guests')

    click(page, /^Sign out$/)
    await page.wait('Sign in')

    expect(page.text()).not.toContain('This website is for Guests')
  }, TIMEOUT_MS)
})

describe('a Guest', () => {
  it('signs up from the form and lands on their own bookings', async () => {
    const page = openAt('/account')
    expect(page.text()).toContain('Sign in')

    await signUp(page, 'maria@example.com')
    await page.wait('Your stay · Guest')

    expect(page.text()).toContain('maria@example.com')
    expect(page.text()).toContain('No bookings on this account yet')
    expect(page.text()).toContain('Signed in as Guest')
  }, TIMEOUT_MS)

  it('keeps a Booking they made while signed in, and shows it back to them', async () => {
    const page = openAt('/account')
    await signUp(page, 'maria@example.com')
    await page.wait('Your stay · Guest')
    const uid = JSON.parse(localStorage.getItem('hdl:auth:session') ?? 'null').uid as string

    // A Booking made by this identity, the way /book makes it.
    localStorage.setItem(
      'hdl:bookings',
      JSON.stringify([
        {
          id: 'book-1',
          ref_id: 'HDL-4821',
          guest_name: 'Maria Santos',
          phone: '0917 000 0000',
          email: 'maria@example.com',
          check_in: '2026-10-01',
          check_out: '2026-10-04',
          guests: 4,
          accommodation: 'main-house',
          special_requests: '',
          status: 'Pending',
          // A live Date hold. One that has run out reads as Expired, and an
          // Expired request is past the point where a Guest may withdraw alone.
          created_at: new Date().toISOString(),
          hold_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          uid,
        },
      ]),
    )
    window.dispatchEvent(new Event('hdl:bookings-updated'))
    await page.wait('HDL-4821')

    expect(page.text()).toContain('The Main House')
    expect(page.text()).toContain('Withdraw this request')
  }, TIMEOUT_MS)

  it('is not shown somebody else’s Booking', async () => {
    const page = openAt('/account')
    await signUp(page, 'maria@example.com')
    await page.wait('Your stay · Guest')

    localStorage.setItem(
      'hdl:bookings',
      JSON.stringify([
        {
          id: 'book-2',
          guest_name: 'Somebody Else',
          phone: '0917 111 2222',
          email: 'other@example.com',
          check_in: '2026-11-01',
          check_out: '2026-11-02',
          guests: 2,
          accommodation: 'main-house',
          special_requests: '',
          status: 'Reserved',
          created_at: '2026-09-20T00:00:00.000Z',
          uid: 'another-identity',
        },
      ]),
    )
    window.dispatchEvent(new Event('hdl:bookings-updated'))
    await page.settle()

    expect(page.text()).not.toContain('Somebody Else')
    expect(page.text()).not.toContain('0917 111 2222')
    expect(page.text()).toContain('No bookings on this account yet')
  }, TIMEOUT_MS)
})

describe('the public website', () => {
  it('needs nobody to sign in', () => {
    const home = openAt('/')
    expect(home.text()).not.toContain("This page isn't yours")
    expect(home.text()).not.toContain('Checking authentication')

    const book = openAt('/book')
    expect(book.text()).toContain('Plan Your Stay')
  })

  it('offers Sign in while signed out, and the Guest’s own page once signed in', async () => {
    const page = openAt('/login')
    expect(page.text()).toContain('Sign in')

    await signUp(page, 'maria@example.com')
    await page.wait('Welcome back, Guest')

    // The Nav points a Guest at their own page, and at nothing else.
    expect(page.html()).toContain('href="/account"')
    expect(page.html()).not.toContain('href="/admin"')
    expect(page.html()).not.toContain('href="/app"')
  }, TIMEOUT_MS)
})
