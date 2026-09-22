// ----------------------------------------------------------------------------
// Which adapter the session runs on
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One decision, in one place: with Firebase keys the session runs on Firebase
// Auth and Firestore Profiles; without them it runs on this browser's storage, so
// the website still signs people in on a machine that has never seen the project's
// `.env.local`. Everything above this — the session, the pages, the buttons —
// reads the same ports either way.
// ----------------------------------------------------------------------------

import { createSession, type AuthPort, type ProfilePort, type SessionStore } from './auth'
import { createFirebasePorts } from './authFirebase'
import { createLocalPorts } from './authLocal'

export type SessionPorts = {
  auth: AuthPort
  profiles: ProfilePort
}

/** The ports this deployment runs on. */
export function createAppPorts(): SessionPorts {
  return createFirebasePorts() ?? createLocalPorts()
}

let instance: SessionStore | null = null

/**
 * The app's session.
 *
 * One for the lifetime of the page, built the first time it is asked for rather
 * than at import, so importing anything that mentions it has no side effects.
 */
export function appSession(): SessionStore {
  if (!instance) {
    const ports = createAppPorts()
    instance = createSession(ports.auth, ports.profiles)
  }
  return instance
}

/**
 * Throw the session away, so the next reader builds a fresh one on fresh ports.
 *
 * The website has one session for its whole life and never needs this. It is
 * here for the two cases that outlive a single session: a test run, where each
 * case has to start as a stranger, and a dev hot reload, where the adapters have
 * just been replaced underneath the page.
 */
export function resetAppSession(): void {
  instance = null
}
