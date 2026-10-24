// The interactive Guest tutorial, walked end to end through the real app —
// the same way auth-flow.test.tsx exercises sign-in.
//
// Not a unit of anything: `<App/>` inside the real `<AuthProvider>` on the
// local demo adapter. What is exercised is what a first-time Guest does:
// the tour opens on its own, highlights the real accommodation card, waits
// for real clicks and real keystrokes instead of Next buttons, sends an
// actual Booking through the demo store, and remembers completion in the
// tutorial cookie so a returning visitor is left alone.
//
// Waiting is by condition, never by a fixed nap: the tour advances its steps
// on short timers after each interaction, so how long they take belongs to
// the machine.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { resetAppSession } from '../../src/lib/authSession'
import { COOKIE } from '../../src/lib/cookies'
import { bookingBusinessDate } from '../../src/lib/booking'
import { OFFICIAL_ACCOMMODATION_RATES } from '../../src/config/officialBusiness'
import { LOCAL_RATES_KEY } from '../../src/lib/ratesDB'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PUMP_MS = 10
const TIMEOUT_MS = 30_000

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
  container: HTMLElement
  wait: (match: string | RegExp) => Promise<void>
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
    container,
    settle: (turns = 4) => pump(turns),
    wait: async (match) => {
      const found = () => (typeof match === 'string' ? text().includes(match) : match.test(text()))
      const deadline = Date.now() + TIMEOUT_MS
      while (!found()) {
        if (Date.now() > deadline) {
          throw new Error(`gave up waiting for ${String(match)} — the page reads: ${text().slice(0, 500)}`)
        }
        await pump()
      }
    },
  }
}

/** Click the first button or link whose visible text answers to `label`. */
function click(page: Page, label: RegExp) {
  const target = [...page.container.querySelectorAll<HTMLElement>('button, a')].find((element) =>
    label.test(element.textContent ?? ''),
  )
  if (!target) throw new Error(`nothing to click matching ${label} in: ${page.text().slice(0, 300)}`)
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Click the first element whose aria-label answers to `label`. */
function clickAria(page: Page, label: RegExp) {
  const target = [...page.container.querySelectorAll<HTMLElement>('[aria-label]')].find((element) =>
    label.test(element.getAttribute('aria-label') ?? ''),
  )
  if (!target) throw new Error(`nothing aria-labelled ${label} in: ${page.text().slice(0, 300)}`)
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Click the element carrying a tour anchor — the real control, not a mock. */
function clickTour(page: Page, name: string) {
  const target = page.container.querySelector<HTMLElement>(`[data-tour="${name}"]`)
  if (!target) throw new Error(`no [data-tour="${name}"] on: ${page.text().slice(0, 300)}`)
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Fill a field the way a keystroke would, so React hears about it. */
function type(page: Page, selector: string, value: string) {
  const input = page.container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!input) throw new Error(`no input at ${selector}`)
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function clearTutorialMemory() {
  document.cookie = `${COOKIE.tutorialDone}=; Path=/; Max-Age=0`
  localStorage.removeItem('hdl_tutorial_done')
}

function tutorialCookieSet(): boolean {
  return document.cookie.includes(`${COOKIE.tutorialDone}=`) && !document.cookie.includes(`${COOKIE.tutorialDone}=;`)
}

/** Dates the booking form will accept, whenever the test happens to run. */
function futureDate(offsetDays: number): string {
  const d = new Date(Date.parse(`${bookingBusinessDate()}T00:00:00Z`) + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(LOCAL_RATES_KEY, JSON.stringify({
    version: 'tutorial-rates-v1',
    effective_date: bookingBusinessDate(),
    holiday_dates: [],
    accommodations: Object.fromEntries(
      Object.entries(OFFICIAL_ACCOMMODATION_RATES).map(([id, rates]) => [id, { ...rates, security_deposit: 0 }]),
    ),
  }))
  resetAppSession()
  clearTutorialMemory()
})

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
  clearTutorialMemory()
})

describe('the interactive Guest tutorial', () => {
  it(
    'opens by itself on a first visit and offers itself again after Exit',
    async () => {
      const first = openAt('/')
      await first.wait('Let’s walk through your first stay')
      // Exit (×) must not mark the tour done.
      clickAria(first, /Exit the tour/i)
      await first.settle()
      expect(first.text()).not.toContain('Let’s walk through your first stay')
      expect(tutorialCookieSet()).toBe(false)

      // A fresh visit (new mount, no memory) offers the tour again.
      mounted.pop()!.unmount()
      document.body.innerHTML = ''
      const second = openAt('/')
      await second.wait('Let’s walk through your first stay')
      expect(second.text()).toContain('Start the tour')
    },
    TIMEOUT_MS,
  )

  it(
    'walks the Guest through the real booking flow — clicking, typing, checking — and remembers completion',
    async () => {
      const page = openAt('/')

      // 1. Welcome → Start.
      await page.wait('Let’s walk through your first stay')
      click(page, /Start the tour/i)

      // 2. The accommodations step: no Next button — the highlighted, real
      //    "View Accommodation" control is the only way forward except skipping.
      await page.wait('Choose how you want to stay')
      clickTour(page, 'accommodation-cta')

      //    …the site's own router carried us to the Booking form.
      await page.wait('Pick your dates first')
      expect(page.container.querySelector('form')).toBeTruthy()

      // 3. Dates: typing into the real date fields is what advances the tour.
      type(page, '[data-tour-field="check-in"]', futureDate(30))
      type(page, '[data-tour-field="check-out"]', futureDate(31))
      await page.wait('Tell us who’s coming')
      click(page, /^\s*Next\s*$/i)

      // 4. Details: the name field gates the step…
      await page.wait('Who do we confirm with?')
      type(page, '[data-tour-field="guest-name"]', 'Maria Santos')
      //    …the rest of the contact details the request itself needs.
      type(page, 'input[placeholder="09XX XXX XXXX"]', '0917 123 4567')
      type(page, 'input[placeholder="you@email.com"]', 'maria@example.com')
      await page.wait('Read and accept the Terms')

      // 5. Terms: ticking the real checkbox, not pressing Next.
      const termsBox = page.container.querySelector<HTMLInputElement>('[data-tour="terms"] input[type="checkbox"]')
      expect(termsBox).toBeTruthy()
      act(() => {
        termsBox!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(termsBox!.checked).toBe(true)
      await page.wait('Continue to the downpayment')

      // 6. Continue: the form does not create a Booking. The payment page does.
      clickTour(page, 'submit-booking')
      await page.wait('Downpayment proof')
      expect(page.text()).toMatch(/screenshot/i)

      // 7 → 8: My Bookings and the after-approval explanation (informational).
      click(page, /^\s*Next\s*$/i)
      await page.wait('My Bookings — follow your own stay')
      click(page, /^\s*Next\s*$/i)
      await page.wait('After approval: pay, upload, arrive')
      click(page, /^\s*Next\s*$/i)

      // 9: Messages — signed out in this run, so the step cannot highlight
      //    the composer; it must degrade to a readable card instead of
      //    blocking the tour.
      await page.wait('Chat with the Admin')
      await page.wait('direct line to the Admin')
      click(page, /^\s*Next\s*$/i)

      // 10: Finish remembers completion — cookie and localStorage.
      await page.wait('You know your way around now')
      click(page, /Finish/i)
      await page.settle()
      expect(tutorialCookieSet()).toBe(true)
      expect(localStorage.getItem('hdl_tutorial_done')).toBe('1')

      // The tour is closed; normal browsing is untouched, and Replay exists.
      await page.wait('Replay tutorial')
      expect(page.text()).not.toContain('You know your way around now')
    },
    TIMEOUT_MS,
  )

  it(
    'Skip tour ends the walkthrough early, remembers it, and Replay starts it over',
    async () => {
      const page = openAt('/')
      await page.wait('Let’s walk through your first stay')
      click(page, /Start the tour/i)
      await page.wait('Choose how you want to stay')

      // Interactive step offers escape hatches but no "Next".
      expect(page.text()).toContain('Skip tour')
      expect(page.text()).toContain('Skip this step')
      click(page, /Skip tour/i)
      await page.settle()
      expect(tutorialCookieSet()).toBe(true)
      expect(page.text()).not.toContain('Choose how you want to stay')

      // Replay runs the tour from the top.
      click(page, /Replay tutorial/i)
      await page.wait('Let’s walk through your first stay')
    },
    TIMEOUT_MS,
  )

  it(
    'Back onto an already-satisfied step never strands the Guest',
    async () => {
      const page = openAt('/')
      await page.wait('Let’s walk through your first stay')
      click(page, /Start the tour/i)
      await page.wait('Choose how you want to stay')
      clickTour(page, 'accommodation-cta')

      // Fill the dates, move on to the party step…
      await page.wait('Pick your dates first')
      type(page, '[data-tour-field="check-in"]', futureDate(30))
      type(page, '[data-tour-field="check-out"]', futureDate(32))
      await page.wait('Tell us who’s coming')

      // …then step Back: the dates are still filled, so the tour must carry
      // the Guest forward again without another keystroke.
      click(page, /^\s*Back\s*$/i)
      await page.wait('Pick your dates first')
      await page.wait('Tell us who’s coming')
    },
    TIMEOUT_MS,
  )

  it(
    'remembers a Guest who declines with "Explore on my own"',
    async () => {
      const first = openAt('/')
      await first.wait('Let’s walk through your first stay')

      // Declining the invitation is a decision: the same memory "Skip tour"
      // writes, so the card cannot come back on the next page.
      click(first, /Explore on my own/i)
      await first.settle()
      expect(first.text()).not.toContain('Let’s walk through your first stay')
      expect(tutorialCookieSet()).toBe(true)

      // A fresh visit — new document, cookie intact — is left alone.
      mounted.pop()!.unmount()
      document.body.innerHTML = ''
      const second = openAt('/stay')
      await second.wait('Replay tutorial')
      expect(second.text()).not.toContain('Let’s walk through your first stay')

      // …and the deliberate Replay still works, cookie or not.
      click(second, /Replay tutorial/i)
      await second.wait('Let’s walk through your first stay')
    },
    TIMEOUT_MS,
  )

  it(
    'counts the tour once, and the request sub-flow as its own named stretch',
    async () => {
      const page = openAt('/')
      await page.wait('Let’s walk through your first stay')
      expect(page.text()).toContain('Step 1 of 12')

      click(page, /Start the tour/i)
      await page.wait('Choose how you want to stay')
      expect(page.text()).toContain('Step 2 of 12')
      // The welcome and the accommodation step are not part of a sub-flow.
      expect(page.container.querySelector('[role="progressbar"]')).toBeTruthy()

      clickTour(page, 'accommodation-cta')
      await page.wait('Pick your dates first')

      const card = page.container.querySelector('[data-tour-card]')
      const text = (card?.textContent ?? '').replace(/\s+/g, ' ')
      // One step counter for the whole tour…
      expect(text).toContain('Step 3 of 12')
      // …and a separately labelled counter for the five request steps, with
      // the old hand-written "1 of 5 — your request" eyebrow gone.
      expect(text).toContain('Your request')
      expect(text).toContain('1 of 5')
      expect(text).not.toMatch(/1 of 5 — your request/i)

      // The progress bar tells a screen reader the same number the card does.
      const bar = page.container.querySelector('[role="progressbar"]')
      expect(bar?.getAttribute('aria-valuenow')).toBe('3')
      expect(bar?.getAttribute('aria-valuemax')).toBe('12')
    },
    TIMEOUT_MS,
  )

  it(
    'holds the keyboard inside the tour card, and gives it back on close',
    async () => {
      const page = openAt('/')
      await page.wait('Let’s walk through your first stay')

      const card = page.container.querySelector<HTMLElement>('[data-tour-card]')
      expect(card).toBeTruthy()
      // The card takes focus when it opens — not the page behind it.
      expect(card!.contains(document.activeElement)).toBe(true)

      const inside = () =>
        [...card!.querySelectorAll<HTMLElement>('button, [href]')]

      // Tab around the whole card twice: focus must never leave it.
      for (let press = 0; press < inside().length * 2 + 2; press += 1) {
        act(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        })
        expect(card!.contains(document.activeElement), `Tab ${press + 1} escaped the card`).toBe(true)
      }

      // Shift+Tab wraps backwards the same way.
      for (let press = 0; press < 3; press += 1) {
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
          )
        })
        expect(card!.contains(document.activeElement), `Shift+Tab ${press + 1} escaped the card`).toBe(true)
      }

      // Escape closes it and focus returns to whatever held it before.
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      await page.settle()
      expect(page.text()).not.toContain('Let’s walk through your first stay')
      // Body held focus when the card auto-opened, so nothing is stranded on a
      // control that no longer exists.
      expect(card!.isConnected).toBe(false)
    },
    TIMEOUT_MS,
  )


  it(
    'stays closed for a returning visitor once completed',
    async () => {
      localStorage.setItem('hdl_tutorial_done', '1')
      const page = openAt('/')
      await page.wait('Replay tutorial')
      // The welcome card never opens; the page behind is fully usable.
      expect(page.text()).not.toContain('Let’s walk through your first stay')
      expect(page.container.querySelector('[data-tour="hero-cta"]')).toBeTruthy()
    },
    TIMEOUT_MS,
  )
})
