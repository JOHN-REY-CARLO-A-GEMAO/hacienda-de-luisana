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
import { getAuth, type Auth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

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

// Warn in development if not configured, but don't crash the app
if (!isFirebaseConfigured && import.meta.env.DEV) {
  console.info(
    '[Firebase] Running in local offline mode. ' +
    'To connect to Firebase, update .env.local with valid Firebase credentials (API key starting with AIza). ' +
    'Bookings and admin dashboard will use local persistence.'
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

if (isFirebaseConfigured) {
  try {
    // Avoid re-initializing during HMR
    app = getApps().length ? getApp() : initializeApp(firebaseConfig as any)
    auth = getAuth(app)
    db = getFirestore(app)
    storage = getStorage(app)
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
    projectId: isReady ? (firebaseConfig.projectId || 'not-set') : 'local-mode',
    authDomain: isReady ? (firebaseConfig.authDomain || 'not-set') : 'local-mode',
    hasApiKey: isValidApiKey(firebaseConfig.apiKey),
    hasMeasurementId: isValidConfigValue(firebaseConfig.measurementId) && !firebaseConfig.measurementId?.includes('XXXX'),
  }
}
