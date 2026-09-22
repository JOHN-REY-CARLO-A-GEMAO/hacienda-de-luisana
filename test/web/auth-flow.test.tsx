// The whole flow, end to end, through the real app.
//
// Not a unit of anything: `<App/>` inside the real `<AuthProvider>`, which in a
// test run has no Firebase and therefore runs on the local demo adapter — the same
// adapter the website runs on for anybody without `.env.local`. What is exercised
// is what a person does: arrive at a protected page, be asked to sign in, step
// into a role, be let in or be turned away, sign out.
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

describe('arriving at a page that is not public', () => {
  it('asks who you are before it shows anything', () => {
    const admin = openAt('/admin')
    expect(admin.text()).toContain('Sign in')
    expect(admin.text()).not.toContain('Admin Control Center')

    const app = openAt('/app')
    expect(app.text()).toContain('Host or Staff access only')
    expect(app.text()).not.toContain('Booker Requests')
  })

  it('says the site is in demo mode, and offers the three roles', () => {
    const page = openAt('/admin')

    expect(page.text()).toContain('Demo mode')
    expect(page.text()).toContain('Continue as Host')
    expect(page.text()).toContain('Continue as Staff')
    expect(page.text()).toContain('Continue as Guest')
  })
})

describe('the Host', () => {
  it('signs in and reaches the dashboard, team panel included', async () => {
    const page = openAt('/admin')

    click(page, /Continue as Host/)
    await page.wait('Admin Control Center')

    expect(page.text()).toContain('Signed in as Host')
    expect(page.text()).toContain('Team & Roles')
    expect(page.text()).not.toContain("This page isn't yours")
  })

  it('can open the client app as well', async () => {
    const page = openAt('/app')

    click(page, /Continue as Host/)
    await page.wait('App for Host')

    expect(page.text()).toContain('Tracking')
    expect(page.text()).toContain('Smart Lock')
  })

  it('is signed out again, and the dashboard goes with the session', async () => {
    const page = openAt('/admin')
    click(page, /Continue as Host/)
    await page.wait('Admin Control Center')

    click(page, /^Sign out$/)
    await page.wait('Sign in')

    expect(page.text()).not.toContain('Admin Control Center')
  })

  it('sees the team panel say who has which role', async () => {
    const page = openAt('/admin?tab=team')
    click(page, /Continue as Host/)
    await page.wait('Admin Control Center')

    click(page, /Team & Roles/)
    await page.wait('Sino ang may alagang papel')

    expect(page.text()).toContain("that's you")
    expect(page.text()).toContain('demo-host@hacienda.test')
  })
})

describe('Staff', () => {
  it('reaches the client app, without the tabs that are the Host’s', async () => {
    const page = openAt('/app')

    click(page, /Continue as Staff/)
    await page.wait('App for Staff')

    expect(page.text()).toContain('Bookings')
    expect(page.text()).toContain('Smart Lock')
    expect(page.text()).not.toContain('Tracking')
    // A page this role would be turned away from is not offered as a link.
    expect(page.html()).not.toContain('href="/admin"')
  })

  it('is turned away from the Host dashboard, and told who they are', async () => {
    const page = openAt('/admin')

    click(page, /Continue as Staff/)
    await page.wait("This page isn't yours")

    expect(page.text()).toContain('Staff')
    expect(page.text()).not.toContain('Admin Control Center')
  })

  it('is turned away from a Guest’s live location, even inside the app they may open', async () => {
    const page = openAt('/app/tracking')

    click(page, /Continue as Staff/)
    await page.wait("This page isn't yours")

    expect(page.text()).toContain('/app/tracking')
  })
})

describe('a Guest', () => {
  it('signs up from the form and lands on their own bookings', async () => {
    const page = openAt('/account')
    expect(page.text()).toContain('Guest or Host access only')

    click(page, /Create one/)
    type(page, 'input[autocomplete="name"]', 'Maria Santos')
    type(page, 'input[type="email"]', 'maria@example.com')
    type(page, 'input[type="password"]', TYPED_AT_SIGN_UP)
    await submit(page)
    await page.wait('My Bookings')

    expect(page.text()).toContain('maria@example.com')
    expect(page.text()).toContain('No bookings on this account yet')
  })

  it('is turned away from the Host dashboard and from the client app', async () => {
    const admin = openAt('/admin')
    click(admin, /Continue as Guest/)
    await admin.wait("This page isn't yours")

    // The same identity, on another page: no second sign-in, and still turned away.
    const app = openAt('/app')
    await app.wait("This page isn't yours")
    expect(app.text()).toContain('Guest')
    expect(app.text()).not.toContain('Booker Requests')
  })

  it('keeps a Booking they made while signed in, and shows it back to them', async () => {
    const page = openAt('/account')
    click(page, /Continue as Guest/)
    await page.wait('My Bookings')
    const uid = JSON.parse(localStorage.getItem('hdl:auth:session') ?? 'null').uid as string

    // A Booking made by this identity, the way /book makes it.
    localStorage.setItem(
      'hdl:bookings',
      JSON.stringify([
        {
          id: 'book-1',
          ref_id: 'HDL-4821',
          guest_name: 'Demo Guest',
          phone: '0917 000 0000',
          email: 'guest@hacienda.test',
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
  })

  it('is not shown somebody else’s Booking', async () => {
    const page = openAt('/account')
    click(page, /Continue as Guest/)
    await page.wait('My Bookings')

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
  })
})

describe('the public website', () => {
  it('needs nobody to sign in', () => {
    const home = openAt('/')
    expect(home.text()).not.toContain("This page isn't yours")
    expect(home.text()).not.toContain('Checking authentication')

    const book = openAt('/book')
    expect(book.text()).toContain('Plan Your Stay')
  })

  it('offers Sign in while signed out, and the role’s own page once signed in', async () => {
    const page = openAt('/login')
    expect(page.text()).toContain('Sign in')

    click(page, /Continue as Staff/)
    await page.wait('You are the Staff')

    // The Nav points a role at the pages it may open, and at nothing else.
    expect(page.html()).toContain('href="/app"')
    expect(page.html()).not.toContain('href="/admin"')
  })
})
