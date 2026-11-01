import { afterEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const functions = { app: 'test-functions-client' }
  return {
    functions,
    getFunctions: vi.fn(() => functions),
    connectFunctionsEmulator: vi.fn(),
    httpsCallable: vi.fn(() => () => Promise.resolve({ data: 'firebase' })),
    httpsCallableFromURL: vi.fn(() => () => Promise.resolve({ data: 'worker' })),
  }
})

vi.mock('firebase/functions', () => ({
  getFunctions: sdk.getFunctions,
  connectFunctionsEmulator: sdk.connectFunctionsEmulator,
  httpsCallable: sdk.httpsCallable,
  httpsCallableFromURL: sdk.httpsCallableFromURL,
}))

vi.mock('../../src/lib/firebase', () => ({
  app: {},
  isUsingEmulators: false,
}))

import { backendCallable } from '../../src/lib/functionsClient'

describe('backendCallable host selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    sdk.httpsCallable.mockClear()
    sdk.httpsCallableFromURL.mockClear()
  })

  it('uses the configured Cloudflare Worker while Firebase attaches Auth', async () => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://hacienda-api.example.workers.dev/api/')

    const call = backendCallable('quoteBooking')

    expect(sdk.httpsCallableFromURL).toHaveBeenCalledWith(
      sdk.functions,
      'https://hacienda-api.example.workers.dev/api/quoteBooking',
    )
    await expect(call({})).resolves.toEqual({ data: 'worker' })
  })

  it('allows a loopback HTTP Worker during local development', () => {
    vi.stubEnv('VITE_WORKER_API_URL', 'http://[::1]:8787/')
    backendCallable('bookingAvailability')

    expect(sdk.httpsCallableFromURL).toHaveBeenCalledWith(
      sdk.functions,
      'http://[::1]:8787/bookingAvailability',
    )
  })

  it('keeps the Firebase callable when no Worker URL is configured', async () => {
    vi.stubEnv('VITE_WORKER_API_URL', '')

    const call = backendCallable('submitBooking')

    expect(sdk.httpsCallable).toHaveBeenCalledWith(sdk.functions, 'submitBooking')
    await expect(call({})).resolves.toEqual({ data: 'firebase' })
  })

  it('ignores malformed or insecure public Worker URLs', () => {
    vi.stubEnv('VITE_WORKER_API_URL', 'http://public.example/api')
    backendCallable('bookingAvailability')

    vi.stubEnv('VITE_WORKER_API_URL', 'not a url')
    backendCallable('bookingAvailability')

    expect(sdk.httpsCallableFromURL).not.toHaveBeenCalled()
    expect(sdk.httpsCallable).toHaveBeenCalledTimes(2)
  })
})
