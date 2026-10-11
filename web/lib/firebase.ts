// ----------------------------------------------------------------------------
// Firebase Configuration & Initialization
// Hacienda de LuisAna — Centralized Firebase setup
// ----------------------------------------------------------------------------
// Where the project this build talks to comes from is decided in one pure place
// (`firebaseConfig.ts`): `VITE_FIREBASE_*` if the build has them, the committed
// project (`firebaseDefaults.ts`) for a deployed build that has none, and the
// local demo adapter if there is no project at all. This file only does the
// wiring — initialise the SDK once, connect the emulators in practice mode, and
// describe what happened for `/status`.
//
// Supported services:
// - Authentication (Email/Password + Google + Anonymous for web Guests)
// - Firestore Database
// - Storage
// - Realtime Database (the ephemeral live-location stream, ADR-0013 — optional:
//   a project with no `databaseURL` keeps the stream switched off, with a
//   reason, rather than guessing a URL)
// - Analytics (optional, browser only, needs an app id)
// ----------------------------------------------------------------------------

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'
import type { Database } from 'firebase/database'
import {
  fieldReport,
  resolveFirebaseConfig,
  FIREBASE_ENV_KEYS,
  type FirebaseConfigField,
  type FirebaseConfigReport,
} from './firebaseConfig'
import { COMMITTED_PROJECT } from './firebaseDefaults'

// ----------------------------------------------------------------------------
// The decision
// ----------------------------------------------------------------------------
// `import.meta.env.PROD` is a build-time constant, so which of the three
// sources applies is fixed into the bundle: a deployed build (Vercel, GitHub
// Pages, Firebase Hosting) may fall back to the committed project, while
// `npm run dev` and the test run stay in demo mode until `.env.local` or the
// emulator flag says otherwise.
// The eight keys, named one by one.
//
// This used to pass `import.meta.env` whole. Vite has only one way to substitute
// that — inline every `VITE_*` variable it can see — and on Vercel that includes
// the system variables. The deployed bundle was shipping VITE_VERCEL_GIT_COMMIT_
// MESSAGE, a whole commit message, to anyone who opened the JS, along with the
// deploy id, the branch URL, and the git author's name and login.
//
// Written as dot accesses rather than `import.meta.env[FIREBASE_ENV_KEYS[field]]`
// on purpose: a computed member access is not statically replaceable, so it would
// have left the whole env object sitting in the bundle and leaked exactly as much.
// Each dot access is replaced by that one value, and nothing else survives.
//
// The keys are the *variable names*, not the field names, because that is what
// `resolveFirebaseConfig` looks up: it iterates FIREBASE_ENV_KEYS and reads
// `env[envKey]`. Keyed by field name instead, every lookup missed, every field
// came back `missing`, and the site reported demo mode in every environment —
// `.env.local`, a Vercel deployment, all of them — with a fully populated
// `import.meta.env` sitting right there. The unit test could not see it: it
// passes a correctly-keyed env in by hand, so it never exercised this shape.
//
// The annotation is what keeps the list honest. It is the union of the names in
// FIREBASE_ENV_KEYS, so the eight are repeated rather than derived: add a ninth
// field to FIREBASE_ENV_KEYS and this stops compiling until it is listed here,
// instead of quietly ignoring the new variable and falling back to the committed
// defaults.
const FIREBASE_ENV: Record<(typeof FIREBASE_ENV_KEYS)[FirebaseConfigField], unknown> = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MEASUREMENT_ID: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  VITE_FIREBASE_DATABASE_URL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

const resolution: FirebaseConfigReport = resolveFirebaseConfig({
  env: FIREBASE_ENV,
  defaults: COMMITTED_PROJECT,
  allowDefaults: Boolean(import.meta.env.PROD),
})

const firebaseConfig = resolution.config

/** True when this build has a Firebase project to talk to. */
export const isFirebaseConfigured = resolution.configured

/** Where the project settings came from: 'env' | 'defaults' | 'mixed' | 'none'. */
export const firebaseConfigSource = resolution.source

/** The full account of every field — what `/status` and the build log read. */
export const firebaseConfigReport = resolution

// Practice database: the Firebase Emulator Suite on localhost (Auth :9099,
// Firestore :8080, Storage :9199). Set VITE_USE_FIREBASE_EMULATORS=true in
// .env.local to talk to the emulators instead of the live project — same SDK,
// same rules files, zero quota, uploads included. Never enabled by accident:
// the flag must read exactly 'true'.
export const isUsingEmulators =
  isFirebaseConfigured && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

// A build that would talk to an emulator on a visitor's machine is a mistake
// worth shouting about: there is no emulator at 127.0.0.1 in a browser that is
// not the developer's.
if (isUsingEmulators && import.meta.env.PROD) {
  console.error(
    '[Firebase] This production build is pointed at the local Emulator Suite ' +
      '(VITE_USE_FIREBASE_EMULATORS=true). Visitors have no emulator on their machine — ' +
      'remove that variable from the hosting dashboard and rebuild.',
  )
}

if (!isFirebaseConfigured && import.meta.env.DEV) {
  console.info(
    '[Firebase] Running in local offline mode. ' +
      'To connect to Firebase, update .env.local with valid Firebase credentials (API key starting with AIza). ' +
      'Bookings and admin dashboard will use local persistence.',
  )
}

if (isFirebaseConfigured && resolution.source !== 'env' && import.meta.env.PROD) {
  console.info(
    '[Firebase] Configured from the project committed in src/lib/firebaseDefaults.ts — ' +
      'this build has no VITE_FIREBASE_* environment variables of its own. ' +
      'Set them in the hosting dashboard (and redeploy) to override any value.',
  )
}

if (resolution.refusedEnvKeys.length > 0) {
  console.warn(
    '[Firebase] These environment variables are set but were refused, so the committed project ' +
      `is used for those values instead: ${resolution.refusedEnvKeys.join(', ')}. ` +
      'Check them in the hosting dashboard (a Firebase web API key starts with "AIza").',
  )
}

if (isUsingEmulators && import.meta.env.DEV) {
  console.info(
    '[Firebase] Talking to the local Emulator Suite (Auth :9099, Firestore :8080, Storage :9199). ' +
      'Nothing here touches the live project. Inspect data at http://127.0.0.1:4000.',
  )
}

// ----------------------------------------------------------------------------
// Initialize Firebase (singleton pattern)
// ----------------------------------------------------------------------------
let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null
let realtime: Database | null = null
let realtimeAttempted = false
let googleProvider: GoogleAuthProvider | null = null

// connect*Emulator warn when called twice (HMR re-runs this module), so the
// connection happens once per page load.
let emulatorsConnected = false

/**
 * The host the emulators are reached on.
 *
 * Phones on the same Wi-Fi load the site via the laptop's LAN IP
 * (e.g. `http://192.168.1.6:3000`), so 127.0.0.1 would point at the phone
 * itself and refuse to connect. Use the page's own hostname so both laptop
 * (localhost) and phone (LAN IP) reach the emulators. Requires emulators
 * listening on LAN: `firebase emulators:start --host 0.0.0.0`
 */
const emulatorHost =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'
    ? window.location.hostname
    : '127.0.0.1'

if (isFirebaseConfigured) {
  try {
    // Avoid re-initializing during HMR
    app = getApps().length ? getApp() : initializeApp(firebaseConfig as any)
    auth = getAuth(app)
    // Some browser privacy filters and restrictive networks break Firestore's
    // streaming transport (`ERR_BLOCKED_BY_CLIENT` / WebChannel failures). Let
    // the SDK detect that and fall back to long-polling automatically; this
    // keeps normal environments on the default transport and does not alter the
    // authorization enforced by firestore.rules.
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    storage = getStorage(app)
    if (isUsingEmulators && !emulatorsConnected) {
      emulatorsConnected = true
      // Phones on the same Wi-Fi load the site via the laptop's LAN IP
      // (e.g. http://192.168.1.6:3000), so 127.0.0.1 would point at the phone
      // itself and refuse to connect. Use the page's own hostname so both
      // laptop (localhost) and phone (LAN IP) reach the same emulators.
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
      connectFirestoreEmulator(db, emulatorHost, 8080)
      connectStorageEmulator(storage, emulatorHost, 9199)
    }
    googleProvider = new GoogleAuthProvider()
    googleProvider.setCustomParameters({ prompt: 'select_account' })

    // Optional Analytics — only in browser, and only when the build has both a
    // measurement id and an app id to key it to. Without an app id the SDK has
    // nothing to file the data under, so Analytics stays off rather than
    // initialised half way.
    if (
      typeof window !== 'undefined' &&
      fieldReport(resolution, 'appId').value &&
      fieldReport(resolution, 'measurementId').value
    ) {
      // Dynamic import to avoid SSR issues and keep bundle lean
      import('firebase/analytics')
        .then(({ getAnalytics, isSupported }) => {
          return isSupported().then((supported) => {
            if (supported && app) {
              getAnalytics(app)
            }
          })
        })
        .catch(() => {
          // Analytics is optional, ignore errors
        })
    }
  } catch (err) {
    console.warn('[Firebase] Initialization error, falling back to local mode:', err)
    app = null
    auth = null
    db = null
    storage = null
    realtime = null
    googleProvider = null
  }
} else {
  // No project to reach: every consumer below already checks the flag first.
  app = null
  auth = null
  db = null
  storage = null
  realtime = null
  googleProvider = null
}

export { app, auth, db, storage, googleProvider, firebaseConfig }

/**
 * Does this build carry a Realtime Database URL?
 *
 * A build-time fact, answered without opening a connection, because that is
 * what the sharing control needs to decide whether to offer the button at all.
 */
export function hasRealtimeDatabaseConfig(): boolean {
  return isFirebaseConfigured && Boolean(resolution.config.databaseURL)
}

/**
 * The Realtime Database, opened on first use.
 *
 * Loaded with a dynamic import on purpose. The database carries the ephemeral
 * live-location stream and nothing else (ADR-0013), so a static import would
 * add its weight to the bundle of every visitor — including the great majority
 * who never open a conversation. One call, memoised; a failure resolves to null
 * and the sharing control turns that into a stated refusal rather than a button
 * that pretends to work.
 */
export async function ensureRealtimeDatabase(): Promise<Database | null> {
  if (realtime) return realtime
  if (realtimeAttempted) return null
  realtimeAttempted = true
  if (!hasRealtimeDatabaseConfig() || !app) return null
  try {
    const { getDatabase, connectDatabaseEmulator } = await import('firebase/database')
    realtime = getDatabase(app)
    if (isUsingEmulators) connectDatabaseEmulator(realtime, emulatorHost, 9000)
  } catch (err) {
    console.warn('[Firebase] Realtime Database unavailable; live location is off.', err)
    realtime = null
  }
  return realtime
}

// ----------------------------------------------------------------------------
// Helper for debugging / admin UI / the /status page
// ----------------------------------------------------------------------------
export function getFirebaseStatus() {
  const isReady = isFirebaseConfigured && Boolean(app)
  return {
    configured: isReady,
    source: resolution.source,
    emulators: isUsingEmulators,
    /** The ephemeral live-location stream's transport, or why there is none. */
    realtimeDatabase: hasRealtimeDatabaseConfig() ? firebaseConfig.databaseURL : '',
    projectId: isReady ? firebaseConfig.projectId || 'not-set' : 'local-mode',
    authDomain: isReady ? firebaseConfig.authDomain || 'not-set' : 'local-mode',
    hasApiKey: Boolean(fieldReport(resolution, 'apiKey').value),
    hasAppId: Boolean(fieldReport(resolution, 'appId').value),
    hasMeasurementId: Boolean(fieldReport(resolution, 'measurementId').value),
    /** Required values this build does not have — why it is in demo mode. */
    missingRequired: resolution.missingRequired,
    /** Variables that were set and refused, with the reason. */
    refusedEnvKeys: resolution.refusedEnvKeys,
  }
}
