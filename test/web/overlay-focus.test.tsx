// Every overlay in the site keeps the keyboard inside itself — and gives it
// back when it closes.
//
// The dogfood run found two dialogs that declared `aria-modal="true"` and then
// let Tab walk out into the page behind the scrim: the Guest tour (three Tabs
// to the brand link) and the gallery lightbox (three Tabs to the footer's
// "Check Availability"). The lightbox looked trapped because it uses the shared
// `useOverlay`, but the trap's "last control" was the `md:hidden` Prev/Next
// pair that no desktop screen renders — so the wrap never fired.
//
// Two layers are pinned here:
//   1. `overlayFocusables` — the list the trap wraps around: what counts as a
//      control and what is skipped because it is not rendered.
//   2. A real dialog (the gallery lightbox) driven with real Tab presses.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '../../src/App'
import { AuthProvider } from '../../src/context/AuthContext'
import { overlayFocusables } from '../../src/components/ui/overlay'
import { COOKIE, setCookie } from '../../src/lib/cookies'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

function tab(shiftKey = false) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }))
  })
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  // A returning Guest: the tour has been answered, so nothing but the lightbox
  // is open on /gallery and the two dialogs cannot be confused for each other.
  setCookie(COOKIE.tutorialDone, '1')
  localStorage.setItem('hdl_tutorial_done', '1')
})

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach((node) => node.remove())
  delete document.body.dataset.scrollLocked
  document.cookie = `${COOKIE.tutorialDone}=; Path=/; Max-Age=0`
  localStorage.removeItem('hdl_tutorial_done')
})

describe('the list a dialog wraps Tab around', () => {
  it('skips a control the screen does not render', () => {
    // This is the lightbox at desktop width: the `md:hidden` Prev/Next pair is
    // display:none, and counting one of them as "last" is what let focus out.
    // jsdom does not evaluate media queries, so the rule is written flat — the
    // computed `display` is what the trap reads, and it reads the same way.
    const style = document.createElement('style')
    style.textContent = '.md\\:hidden { display: none }'
    document.head.appendChild(style)
    const host = mount(`
      <div id="panel">
        <button id="close">Close</button>
        <button id="prev">Previous</button>
        <button id="next">Next</button>
        <button id="mobile-prev" class="md:hidden">Prev</button>
        <button id="mobile-next" class="md:hidden">Next</button>
      </div>
    `)
    const ids = overlayFocusables(host.querySelector<HTMLElement>('#panel')).map((el) => el.id)
    expect(ids).toEqual(['close', 'prev', 'next'])
  })

  it('skips controls hidden by an ancestor, a visibility rule, or aria-hidden', () => {
    const host = mount(`
      <div id="panel">
        <button id="visible">Save</button>
        <div style="display: none"><button id="in-hidden-box">Hidden</button></div>
        <button id="invisible" style="visibility: hidden">Invisible</button>
        <button id="aria-hidden" aria-hidden="true">Decorative</button>
        <button id="disabled" disabled>Disabled</button>
        <input id="readonly" readonly />
      </div>
    `)
    const ids = overlayFocusables(host.querySelector<HTMLElement>('#panel')).map((el) => el.id)
    expect(ids).toEqual(['visible', 'readonly'])
  })

  it('includes a root that is itself the control, once', () => {
    // The tour points `scope` at the highlighted control — often an anchor.
    const host = mount(`
      <a id="cta" href="/book"><span>Book this room</span></a>
      <div id="panel"><button id="next">Next</button></div>
    `)
    const ids = overlayFocusables(host.querySelector<HTMLElement>('#panel'), host.querySelector<HTMLElement>('#cta')).map((el) => el.id)
    expect(ids).toEqual(['next', 'cta'])
    expect(overlayFocusables(host.querySelector<HTMLElement>('#cta'), host.querySelector<HTMLElement>('#cta')).length).toBe(1)
  })
})

describe('the gallery lightbox', () => {
  function openLightbox() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push(root)
    window.history.pushState({}, '', '/gallery')
    act(() => {
      root.render(
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>,
      )
    })

    const tile = container.querySelector<HTMLButtonElement>('#gallery button[aria-label^="Open "]')
    expect(tile, 'no photograph tile on /gallery').toBeTruthy()
    // A real activation focuses the tile first (Enter, or a mouse in Chrome);
    // that is the element the overlay remembers to give focus back to.
    act(() => {
      tile!.focus()
      tile!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label*="photograph"]')
    expect(dialog, 'the lightbox did not open').toBeTruthy()
    return { container, tile: tile!, dialog: dialog! }
  }

  it('takes focus on open and never lets Tab leave', () => {
    const { dialog } = openLightbox()

    expect(dialog.contains(document.activeElement)).toBe(true)

    // Well past the number of controls: the old trap let go on the third.
    for (let press = 0; press < 8; press += 1) {
      tab()
      expect(dialog.contains(document.activeElement), `Tab ${press + 1} escaped the lightbox`).toBe(true)
    }
    for (let press = 0; press < 4; press += 1) {
      tab(true)
      expect(dialog.contains(document.activeElement), `Shift+Tab ${press + 1} escaped the lightbox`).toBe(true)
    }
  })

  it('returns focus to the photograph that opened it', () => {
    const { tile } = openLightbox()
    press('Escape')
    expect(document.querySelector('[role="dialog"][aria-label*="photograph"]')).toBeNull()
    expect(document.activeElement).toBe(tile)
  })
})
