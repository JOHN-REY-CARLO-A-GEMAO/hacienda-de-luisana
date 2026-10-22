import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { app, isUsingEmulators } from './firebase'

/**
 * One regional Functions client for the whole Guest website.
 *
 * Quotes, availability and Cases share the same Firebase App. Connecting the
 * same Functions instance to the emulator from three modules can throw after
 * the first module starts using it, so the connection is owned here exactly
 * once.
 */
let client: Functions | null = null
let emulatorConnected = false

export function functionsClient(): Functions {
  if (!app) throw new Error('Cloud services are not configured in this build.')
  if (!client) client = getFunctions(app, 'asia-southeast1')
  if (isUsingEmulators && !emulatorConnected) {
    connectFunctionsEmulator(client, window.location.hostname, 5001)
    emulatorConnected = true
  }
  return client
}
