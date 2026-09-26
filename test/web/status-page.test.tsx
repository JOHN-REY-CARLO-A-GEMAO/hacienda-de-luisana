// The page an owner opens when the website says "Demo mode" — and the check
// behind its button.
//
// The build half of this page is fact from `firebaseConfig.ts`; the live half is
// only asked when somebody presses the button. In a test run there is no
// Firebase at all, which is exactly the deployment this page has to explain, so
// the prose and the check are both asserted here.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { StatusPage } from '../../src/pages/StatusPage'
import { runConnectionCheck } from '../../src/lib/connectionCheck'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    )
  })
  return {
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
    button: (label: string) =>
      [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)),
  }
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('the deployment status page', () => {
  it('says a build with no Firebase keeps Guest requests in their own browser', () => {
    const page = render()

    expect(page.text()).toContain('Demo mode')
    expect(page.text()).toContain('Firebase not configured in this build')
    expect(page.text()).toContain('never reach the Admin app')
  })

  it('names every variable a deployment would set, and says none of them arrived', () => {
    const page = render()

    expect(page.text()).toContain('VITE_FIREBASE_API_KEY')
    expect(page.text()).toContain('VITE_FIREBASE_PROJECT_ID')
    expect(page.text()).toContain('VITE_FIREBASE_AUTH_DOMAIN')
    // The three required values, each reported as not set rather than guessed at.
    expect(page.text()).toContain('Missing: apiKey, projectId, authDomain')
    expect(page.text()).not.toContain('AIza')
  })

  it('tells the owner what to do about it, including the redeploy', () => {
    const page = render()

    expect(page.text()).toContain('Settings → Environment Variables')
    expect(page.text()).toContain('Redeploy')
    expect(page.text()).toContain('src/lib/firebaseDefaults.ts')
    expect(page.text()).toContain('Authorized domains')
  })

  it('answers its own test button, naming each step of the chain', async () => {
    const page = render()

    await act(async () => {
      page.button('Test the connection')?.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    const text = page.text()
    expect(text).toContain('Firebase settings in this build')
    expect(text).toContain('Guest identity (Anonymous sign-in)')
    expect(text).toContain('Firestore database')
    // Nothing to sign in to and nothing to read: said plainly, not thrown.
    expect(text).toContain('Nothing to sign in to')
    expect(text).toContain('Nothing to read')
  })
})

describe('the connection check with no project in the build', () => {
  it('fails the build step and skips the two that need a project', async () => {
    const checks = await runConnectionCheck()

    expect(checks.map((c) => c.id)).toEqual(['build', 'identity', 'database'])
    expect(checks[0].status).toBe('fail')
    expect(checks[0].detail).toMatch(/committed defaults|no project|every request stays in this browser/i)
    expect(checks[1].status).toBe('skip')
    expect(checks[2].status).toBe('skip')
  })
})
