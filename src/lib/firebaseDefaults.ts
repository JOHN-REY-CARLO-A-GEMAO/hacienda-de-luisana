// ----------------------------------------------------------------------------
// The project this repository deploys to — committed, on purpose
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The website and the Flutter Admin app are two applications on one Firebase
// project (ADR-0007). The Admin app already carries that project's keys in
// `lib/firebase_options.dart`, committed for the same reason these are: **a
// Firebase web config is public by design.** It identifies the project, it does
// not authorise anything — `firestore.rules`, `storage.rules` and Firebase Auth
// are the authorization, and they answer every request whether or not somebody
// knows the key. The key's only job is to let the SDK find the project. See
// docs/FIREBASE_SETUP.md § Security Notes.
//
// Why a committed default exists at all: the deployed website used to depend on
// VITE_FIREBASE_* variables being pasted into a hosting dashboard, and a
// deployment missing any one of them did not fail loudly — it silently fell back
// to demo mode, where a Guest's booking request stays in their own browser and
// never reaches the Admin app, while the page still says the request was sent.
// That is the one failure this project cannot have: the business loses the
// booking and never learns about it.
//
// So the deployed site is configured from here, and a dashboard variable — where
// one is set — wins over it (see `firebaseConfig.ts` for the order). Local
// development is unchanged: `npm run dev` and the test run keep the demo adapter
// and the emulator workflow unless `.env.local` says otherwise.
//
// To point a deployment at a different project, or to replace the key below with
// one from Firebase console → Project settings → Your apps → Web app, set the
// VITE_FIREBASE_* variables in the host's dashboard (and redeploy — Vite reads
// them at build time) or in `.env.local` locally. Nothing here has to change.
// ----------------------------------------------------------------------------

import type { FirebaseConfig } from './firebaseConfig'

/**
 * The same Firebase project the Admin app talks to
 * (`lib/firebase_options.dart`, `firebase.json`), described for a browser.
 */
export const COMMITTED_PROJECT: FirebaseConfig = {
  // The project's API key. Firebase issues one per registered app and every one
  // of them opens the same project — the Android app's is the one already in this
  // repository, and it is the one verified here against Identity Toolkit and
  // Firestore. A Web app key from the console is tidier (it is the one Google
  // calls "for web"), and dropping one in through VITE_FIREBASE_API_KEY needs no
  // code change.
  apiKey: 'AIzaSyBLiLB2JFcyKMkrCkrjY30-oZ2XJ6qP_E0',
  // Standard Firebase Auth domain, and the origin the Google sign-in popup
  // returns to. The domains it may return to are listed in Firebase console →
  // Authentication → Settings → Authorized domains; a domain that is not on that
  // list fails Google sign-in with `auth/unauthorized-domain` (docs/FIREBASE_SETUP.md).
  authDomain: 'hacienda-de-luisana.firebaseapp.com',
  projectId: 'hacienda-de-luisana',
  // The Cloud Storage bucket uploads land in (KYC documents, payment proofs).
  storageBucket: 'hacienda-de-luisana.firebasestorage.app',
  messagingSenderId: '648433185',
  // Empty until a Web app is registered in the Firebase console. Auth, Firestore
  // and Storage do not read this value; Analytics (and Cloud Messaging) do, so
  // Analytics simply stays off rather than half-initialised. Fill it in — via
  // VITE_FIREBASE_APP_ID, or here — when the console has a Web app to take it
  // from.
  appId: '',
  // Optional, and only meaningful with an `appId` above.
  measurementId: '',
}
