import { afterEach, describe, expect, it, vi } from 'vitest'

const firestoreSdk = vi.hoisted(() => ({
  initializeFirestore: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
}))
vi.mock('firebase/firestore', () => firestoreSdk)

// The regression this file exists for: `src/lib/firebase.ts` builds the object it
// hands `resolveFirebaseConfig`, and the resolver looks each value up by its
// *variable* name (`env['VITE_FIREBASE_API_KEY']`). Keying that object by field
// name instead made every lookup miss, so every build reported demo mode while
// `import.meta.env` sat there fully populated.
//
// `test/web/firebase-config.test.ts` could not catch it: it passes a
// correctly-keyed env in by hand, so it exercises the resolver and never this
// shape. This test drives the real call site, which means it has to populate
// `import.meta.env` before the module is evaluated.
const STUBBED: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'AIzaSyFakeKeyForThisWiringTestOnly0123456789',
  VITE_FIREBASE_AUTH_DOMAIN: 'hacienda-de-luisana.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'hacienda-de-luisana',
}

describe('the environment src/lib/firebase.ts hands the resolver', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    firestoreSdk.initializeFirestore.mockClear()
    firestoreSdk.connectFirestoreEmulator.mockClear()
  })

  it('is keyed by variable name, so the resolver finds every value', async () => {
    for (const [key, value] of Object.entries(STUBBED)) vi.stubEnv(key, value)
    vi.resetModules()

    const { isFirebaseConfigured, firebaseConfigSource, firebaseConfigReport } = await import(
      '../../src/lib/firebase'
    )

    // The three required fields, each read back as a real value rather than a miss.
    expect(firebaseConfigReport.missingRequired).toEqual([])
    expect(firebaseConfigReport.refusedEnvKeys).toEqual([])
    expect(isFirebaseConfigured).toBe(true)
    expect(firebaseConfigSource).toBe('env')
    expect(firestoreSdk.initializeFirestore).toHaveBeenCalledTimes(1)
    expect(firestoreSdk.initializeFirestore).toHaveBeenCalledWith(
      expect.anything(),
      { experimentalAutoDetectLongPolling: true },
    )

    const apiKey = firebaseConfigReport.fields.find((f) => f.field === 'apiKey')
    expect(apiKey?.state).toBe('env')
    expect(apiKey?.value).toBe(STUBBED.VITE_FIREBASE_API_KEY)
  })

  it('still says demo mode when the build carries no variables at all', async () => {
    vi.resetModules()

    const { isFirebaseConfigured, firebaseConfigSource } = await import('../../src/lib/firebase')

    expect(isFirebaseConfigured).toBe(false)
    expect(firebaseConfigSource).toBe('none')
  })
})