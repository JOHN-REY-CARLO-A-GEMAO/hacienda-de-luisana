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
// - Analytics (optional, browser only, needs an app id)
// ----------------------------------------------------------------------------

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'
import {
  fieldReport,
  resolveFirebaseConfig,
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
const resolution: FirebaseConfigReport = resolveFirebaseConfig({
  env: import.meta.env as unknown as Record<string, unknown>,
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
let googleProvider: GoogleAuthProvider | null = null

// connect*Emulator warn when called twice (HMR re-runs this module), so the
// connection happens once per page load.
let emulatorsConnected = false

if (isFirebaseConfigured) {
  try {
    // Avoid re-initializing during HMR
    app = getApps().length ? getApp() : initializeApp(firebaseConfig as any)
    auth = getAuth(app)
    db = getFirestore(app)
    storage = getStorage(app)
    if (isUsingEmulators && !emulatorsConnected) {
      emulatorsConnected = true
      // Phones on the same Wi-Fi load the site via the laptop's LAN IP
      // (e.g. http://192.168.1.6:3000), so 127.0.0.1 would point at the phone
      // itself and refuse to connect. Use the page's own hostname so both
      // laptop (localhost) and phone (LAN IP) reach the same emulators.
      // Requires emulators listening on LAN: `firebase emulators:start --host 0.0.0.0`
      const emulatorHost =
        typeof window !== 'undefined' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
          ? window.location.hostname
          : '127.0.0.1'
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
    googleProvider = null
  }
} else {
  // No project to reach: every consumer below already checks the flag first.
  app = null
  auth = null
  db = null
  storage = null
  googleProvider = null
}

export { app, auth, db, storage, googleProvider, firebaseConfig }

// ----------------------------------------------------------------------------
// Helper for debugging / admin UI / the /status page
// ----------------------------------------------------------------------------
export function getFirebaseStatus() {
  const isReady = isFirebaseConfigured && Boolean(app)
  return {
    configured: isReady,
    source: resolution.source,
    emulators: isUsingEmulators,
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
