// ----------------------------------------------------------------------------
// Firebase Configuration & Initialization
// Hacienda de LuisAna — Centralized Firebase setup
// ----------------------------------------------------------------------------
// Uses Vite environment variables (prefix VITE_) for security.
// Populate your .env.local file using .env.example as template.
//
// Supported services:
// - Authentication (Email/Password + Google)
// - Firestore Database
// - Storage
// - Analytics (optional, browser only)
// ----------------------------------------------------------------------------

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

// ----------------------------------------------------------------------------
// Environment Variables
// ----------------------------------------------------------------------------
// Vite requires VITE_ prefix for client-side env vars.
// See .env.example for required keys.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
}

// Helper to check if an environment string has a non-placeholder value
function isValidConfigValue(val?: string): boolean {
  if (!val) return false
  const trimmed = val.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  // Reject common dummy / placeholder patterns
  if (
    lower.includes('your_') ||
    lower.includes('placeholder') ||
    lower.includes('example') ||
    lower.includes('xxxx') ||
    lower.startsWith('<') ||
    lower.endsWith('>') ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'your_api_key_here' ||
    lower === 'your_project_id' ||
    lower === 'your_app_id' ||
    lower === 'your_sender_id'
  ) {
    return false
  }
  return true
}

// Google / Firebase Web API keys start with AIza and are ~39 characters long
function isValidApiKey(key?: string): boolean {
  if (!isValidConfigValue(key)) return false
  return Boolean(key && key.startsWith('AIza') && key.length >= 20)
}

// Check if Firebase is properly configured (all required fields present and non-placeholder)
export const isFirebaseConfigured = Boolean(
  isValidApiKey(firebaseConfig.apiKey) &&
  isValidConfigValue(firebaseConfig.authDomain) &&
  isValidConfigValue(firebaseConfig.projectId) &&
  isValidConfigValue(firebaseConfig.appId)
)

// Practice database: the Firebase Emulator Suite on localhost (Auth :9099,
// Firestore :8080, Storage :9199). Set VITE_USE_FIREBASE_EMULATORS=true in
// .env.local to talk to the emulators instead of the live project — same SDK,
// same rules files, zero quota, uploads included. Never enabled by accident:
// the flag must read exactly 'true'.
export const isUsingEmulators =
  isFirebaseConfigured && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

// Warn in development if not configured, but don't crash the app
if (!isFirebaseConfigured && import.meta.env.DEV) {
  console.info(
    '[Firebase] Running in local offline mode. ' +
    'To connect to Firebase, update .env.local with valid Firebase credentials (API key starting with AIza). ' +
    'Bookings and admin dashboard will use local persistence.'
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

    // Optional Analytics — only in browser, only if measurementId present and not a placeholder
    if (
      typeof window !== 'undefined' &&
      isValidConfigValue(firebaseConfig.measurementId) &&
      !firebaseConfig.measurementId?.includes('XXXX')
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
  // Dummy placeholders to keep imports working when not configured
  app = null
  auth = null
  db = null
  storage = null
  googleProvider = null
}

export { app, auth, db, storage, googleProvider, firebaseConfig }

// ----------------------------------------------------------------------------
// Helper for debugging / admin UI
// ----------------------------------------------------------------------------
export function getFirebaseStatus() {
  const isReady = isFirebaseConfigured && Boolean(app)
  return {
    configured: isReady,
    emulators: isUsingEmulators,
    projectId: isReady ? (firebaseConfig.projectId || 'not-set') : 'local-mode',
    authDomain: isReady ? (firebaseConfig.authDomain || 'not-set') : 'local-mode',
    hasApiKey: isValidApiKey(firebaseConfig.apiKey),
    hasMeasurementId: isValidConfigValue(firebaseConfig.measurementId) && !firebaseConfig.measurementId?.includes('XXXX'),
  }
}
