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

// Check if Firebase is properly configured (all required fields present)
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
)

// Warn in development if not configured, but don't crash the app
if (!isFirebaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[Firebase] Missing configuration. Using local fallback. ' +
    'Create .env.local from .env.example and fill in your Firebase keys. ' +
    'Auth will show setup instructions, bookings will use localStorage.'
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
  // Avoid re-initializing during HMR
  app = getApps().length ? getApp() : initializeApp(firebaseConfig as any)
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
  googleProvider = new GoogleAuthProvider()
  googleProvider.setCustomParameters({ prompt: 'select_account' })

  // Optional Analytics — only in browser, only if measurementId present
  if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
    // Dynamic import to avoid SSR issues and keep bundle lean
    import('firebase/analytics').then(({ getAnalytics, isSupported }) => {
      isSupported().then((supported) => {
        if (supported && app) {
          getAnalytics(app)
        }
      })
    }).catch(() => {
      // Analytics is optional, ignore errors
    })
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
  return {
    configured: isFirebaseConfigured,
    projectId: firebaseConfig.projectId || 'not-set',
    authDomain: firebaseConfig.authDomain || 'not-set',
    hasApiKey: Boolean(firebaseConfig.apiKey),
    hasMeasurementId: Boolean(firebaseConfig.measurementId),
  }
}
