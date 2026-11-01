import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  httpsCallableFromURL,
  type Functions,
  type HttpsCallable,
} from 'firebase/functions'
import { app, isUsingEmulators } from './firebase'

/**
 * One regional Functions client for the whole Guest website.
 *
 * Quotes and availability share the same Firebase App. Connecting the same
 * Functions instance to the emulator from several modules can throw after the
 * first module starts using it, so the connection is owned here exactly once.
 */
let client: Functions | null = null
let emulatorConnected = false

export function functionsClient(): Functions {
  if (!app) throw new Error('Cloud services are not configured in this build.')
  if (!client) client = getFunctions(app, 'asia-southeast1')
  // Never point a production visitor at the developer's local emulator.
  if (isUsingEmulators && !import.meta.env.PROD && !emulatorConnected) {
    connectFunctionsEmulator(client, window.location.hostname, 5001)
    emulatorConnected = true
  }
  return client
}

/**
 * The deployed Cloudflare Worker base URL, when this website build has one.
 *
 * This is a public endpoint URL, never a secret. It is deliberately optional:
 * with no URL configured the website keeps the Firebase callable path and its
 * existing Spark transport fallback, so shipping this code cannot strand the
 * estate before the Worker itself is deployed and verified.
 */
export function workerApiBaseUrl(): string | null {
  const raw = import.meta.env.VITE_WORKER_API_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.search || url.hash) return null
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !(isLocalhost && !import.meta.env.PROD)) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * A callable for one booking endpoint, hosted by Cloudflare when configured
 * and by Firebase otherwise. The Worker implements Firebase's callable
 * protocol, so `httpsCallableFromURL` preserves Auth-token attachment and the
 * structured `code` / `message` / `details` error shape both clients expect.
 */
export function backendCallable<RequestData, ResponseData>(name: string): HttpsCallable<RequestData, ResponseData> {
  const functions = functionsClient()
  const workerBase = isUsingEmulators ? null : workerApiBaseUrl()
  return workerBase
    ? httpsCallableFromURL<RequestData, ResponseData>(functions, `${workerBase}/${name}`)
    : httpsCallable<RequestData, ResponseData>(functions, name)
}
