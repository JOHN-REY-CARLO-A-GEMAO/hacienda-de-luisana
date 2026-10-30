// The CAPTCHA the auth forms rely on.
//
// Two things are being protected here, and the second matters more than the
// first. The obvious one: `window.turnstile` is typed, and the widget is drawn,
// kept in step with the token, and removed. The important one: when Turnstile is
// *not* available — blocked by an extension, offline, script never arrived —
// nothing invents a token. There is no stub, no "assume the Guest is a person".
// A form that asks for verification stays closed, which is the whole point of
// asking.
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_SCRIPT_URL,
  loadTurnstile,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from '../../src/lib/turnstile'
import { TURNSTILE_UNAVAILABLE, useTurnstile, type TurnstileState } from '../../src/hooks/useTurnstile'
import { AuthProvider } from '../../src/context/AuthContext'
import { LoginFormOnly } from '../../src/components/Auth/LoginFormOnly'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A Turnstile that answers the way Cloudflare's does, without the network. */
function fakeTurnstile() {
  const callbacks: {
    options?: TurnstileRenderOptions
    container?: HTMLElement
  } = {}

  const api = {
    render: vi.fn((container: HTMLElement | string, options: TurnstileRenderOptions) => {
      callbacks.container = container as HTMLElement
      callbacks.options = options
      return 'widget-1'
    }),
    remove: vi.fn(),
    reset: vi.fn(),
    execute: vi.fn(),
    getResponse: vi.fn(() => undefined),
    isExpired: vi.fn(() => false),
    ready: vi.fn((callback: (widgetId?: string) => void) => callback('widget-1')),
  }

  return {
    api: api as unknown as TurnstileApi,
    spy: api,
    callbacks,
  }
}

/** Turnstile itself, taken off the window between tests. */
afterEach(() => {
  delete window.turnstile
  vi.unstubAllEnvs()
  document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]').forEach((tag) => tag.remove())
})

const mounted: Root[] = []

function mount(element: React.ReactElement): { root: Root; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => root.render(element))
  return { root, container }
}

afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

describe('loadTurnstile', () => {
  it('resolves with the API that is already on the page', async () => {
    const turnstile = fakeTurnstile()
    window.turnstile = turnstile.api

    await expect(loadTurnstile(50)).resolves.toBe(turnstile.api)
  })

  it('rejects, with no stand-in token, when the script never arrives', async () => {
    await expect(loadTurnstile(60)).rejects.toThrow(/did not load/)

    // Nothing was left behind that a later attempt would keep polling: a Guest
    // who allows the script and presses Retry gets a real try.
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).toBeNull()
    expect(window.turnstile).toBeUndefined()
  })

  it('loads again after a failed attempt once the API exists', async () => {
    await expect(loadTurnstile(60)).rejects.toThrow()

    const turnstile = fakeTurnstile()
    window.turnstile = turnstile.api

    await expect(loadTurnstile(60)).resolves.toBe(turnstile.api)
  })

  it('waits on the tag the page already ships instead of adding a second', async () => {
    const shipped = document.createElement('script')
    shipped.src = TURNSTILE_SCRIPT_URL
    document.head.appendChild(shipped)

    const pending = loadTurnstile(120)
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveLength(1)
    await expect(pending).rejects.toThrow(/did not load/)
  })

  it('adds the tag at the same URL when a page has none, and drops a dead one', async () => {
    const pending = loadTurnstile(120)
    const injected = document.querySelector<HTMLScriptElement>('script[data-hdl-turnstile]')
    expect(injected?.src).toBe(TURNSTILE_SCRIPT_URL)

    await expect(pending).rejects.toThrow(/did not load/)
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).toBeNull()
  })
})

describe('useTurnstile', () => {
  function Harness({ siteKey, seen }: { siteKey?: string; seen: TurnstileState[] }) {
    const state = useTurnstile(siteKey)
    seen.push(state)
    return <div ref={state.containerRef} />
  }

  it('asks for nothing when no site key is configured', () => {
    const turnstile = fakeTurnstile()
    window.turnstile = turnstile.api
    const seen: TurnstileState[] = []

    mount(<Harness seen={seen} />)

    const last = seen[seen.length - 1]
    expect(last.status).toBe('disabled')
    expect(last.token).toBeNull()
    expect(turnstile.spy.render).not.toHaveBeenCalled()
  })

  it('renders into the container and holds the token Cloudflare hands back', async () => {
    const turnstile = fakeTurnstile()
    window.turnstile = turnstile.api
    const seen: TurnstileState[] = []

    const { container } = mount(<Harness siteKey="site-key-public" seen={seen} />)
    await act(async () => {})

    expect(turnstile.spy.render).toHaveBeenCalledTimes(1)
    expect(turnstile.callbacks.options?.sitekey).toBe('site-key-public')
    expect(turnstile.callbacks.container).toBe(container.firstElementChild)

    await act(async () => {
      turnstile.callbacks.options?.callback?.('token-from-cloudflare')
    })
    expect(seen[seen.length - 1].token).toBe('token-from-cloudflare')

    // An expired token is not a token: the form closes again until the Guest
    // passes a new challenge.
    await act(async () => {
      turnstile.callbacks.options?.['expired-callback']?.()
    })
    expect(seen[seen.length - 1].token).toBeNull()
  })

  it('removes the widget when the form goes away', async () => {
    const turnstile = fakeTurnstile()
    window.turnstile = turnstile.api
    const seen: TurnstileState[] = []

    const { root } = mount(<Harness siteKey="site-key-public" seen={seen} />)
    await act(async () => {})

    act(() => root.unmount())
    expect(turnstile.spy.remove).toHaveBeenCalledWith('widget-1')
  })

  it('reports an error and hands back no token when the widget cannot be drawn', async () => {
    const turnstile = fakeTurnstile()
    turnstile.spy.render.mockImplementation(() => {
      throw new Error('invalid site key')
    })
    window.turnstile = turnstile.api
    const seen: TurnstileState[] = []

    mount(<Harness siteKey="site-key-public" seen={seen} />)
    await act(async () => {})

    const last = seen[seen.length - 1]
    expect(last.status).toBe('error')
    expect(last.error).toBe(TURNSTILE_UNAVAILABLE)
    // The one assertion this file exists for.
    expect(last.token).toBeNull()
  })
})

// The form, not the hook: with a site key configured, a verification that did
// not load must stop the sign-in before Firebase is asked to sign anybody in.
describe('the sign-in form', () => {
  it('refuses to sign in when the challenge could not load', async () => {
    vi.stubEnv('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY', 'site-key-public')
    const turnstile = fakeTurnstile()
    turnstile.spy.render.mockImplementation(() => {
      throw new Error('blocked by the browser')
    })
    window.turnstile = turnstile.api

    const errors: (string | null)[] = []

    function Host() {
      const [email, setEmail] = useState('guest@example.com')
      return (
        <LoginFormOnly
          email={email}
          onEmailChange={setEmail}
          onError={(error) => errors.push(error)}
          onInfo={() => {}}
          onSwitchToReset={() => {}}
          onSwitchToRegister={() => {}}
        />
      )
    }

    const { container } = mount(
      <AuthProvider>
        <Host />
      </AuthProvider>,
    )
    await act(async () => {})

    const password = container.querySelector<HTMLInputElement>('input[type="password"]')
    expect(password).not.toBeNull()
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setValue?.call(password, 'bahay-kubo-9')
    act(() => {
      password?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form')
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // The name on the LAST complaint is the verification, so the submit never
    // reached `login()` — no token, no sign-in.
    expect(errors[errors.length - 1]).toBe(TURNSTILE_UNAVAILABLE)
  })
})
