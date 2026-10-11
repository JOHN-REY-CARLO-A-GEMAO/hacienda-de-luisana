// ----------------------------------------------------------------------------
// The Firebase adapter — Firebase Auth, and Profiles in Firestore
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The adapter production runs on: Firebase holds the accounts (and the password
// hashes, which never come near this bundle), keeps the session across reloads,
// and refuses anything the client should not have been allowed to ask for
// through `firestore.rules`.
//
// It satisfies the same two ports as the local demo adapter, so the session that
// sits on top of it does not know or care which one it has.
// ----------------------------------------------------------------------------

import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
  type Auth,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase'
import {
  AuthError,
  normalizeProfile,
  type AuthPort,
  type ProfilePort,
  type SessionUser,
} from './auth'
import { roleForEmail } from './auth/profile'

/** Where the role of every signed-in person is stored. */
export const PROFILES_COLLECTION = 'profiles'

/**
 * The Admin operates the hacienda from the Flutter app, never from this website
 * (ADR-0007: one role, two applications; the website is the Guest's). So an
 * allowlisted Admin address is refused at every door on this side, and the
 * session is torn down rather than left half-open.
 *
 * This is a courtesy, not an enforcement. `firestore.rules` is the enforcement,
 * and it cannot help here: the app and the website share one Firebase project
 * and one rules file, and Firestore rules cannot tell a browser from a phone.
 * What they can do is stop the *product* offering the Admin a website, so the
 * separation is real in use rather than only on paper. Anyone who edits the
 * bundle can still reach an Admin's data from a browser — which is why
 * `firestore.rules` writes its invariants to hold without trusting the client.
 */
function refuseAdminOnWeb(firebaseAuth: Auth, user: User): void {
  if (roleForEmail(user.email) !== 'admin') return
  void signOut(firebaseAuth)
  throw new AuthError(
    'hdl/admin-uses-app',
    'The Admin signs in on the Hacienda app, not on this website.',
  )
}

/** Where a Firebase session came from, as the session reports it. */
function providerOf(user: User): SessionUser['provider'] {
  const providerId = user.providerData[0]?.providerId
  if (providerId === 'google.com') return 'google'
  if (user.isAnonymous || providerId === 'anonymous') return 'anonymous'
  return 'password'
}

/** A Firebase user as the session sees it: no provider internals leak past here. */
function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    isAnonymous: user.isAnonymous,
    provider: providerOf(user),
  }
}

/**
 * The two ports, or null when the project has no Firebase to talk to.
 *
 * Callers fall back to the local adapter rather than failing: a website with no
 * keys configured still has to open.
 */
export function createFirebasePorts(): { auth: AuthPort; profiles: ProfilePort } | null {
  if (!isFirebaseConfigured || !auth || !db) return null
  const firebaseAuth = auth
  const firestore = db

  // A reload keeps the person signed in. This is Firebase's default for the web
  // SDK; it is written down because a returning Guest's own Bookings depend on it.
  void setPersistence(firebaseAuth, browserLocalPersistence).catch((error) => {
    console.warn('[Auth] could not set session persistence', error)
  })

  const authPort: AuthPort = {
    isCloud: true,
    supportsGoogle: Boolean(googleProvider),

    subscribe(listener) {
      return onAuthStateChanged(
        firebaseAuth,
        (user) => listener(user ? toSessionUser(user) : null),
        (error) => {
          // A provider that cannot say who is signed in is a signed-out person:
          // the safe answer, and the one the rules will give anyway.
          console.warn('[Auth] session listener failed', error)
          listener(null)
        },
      )
    },

    current: () => (firebaseAuth.currentUser ? toSessionUser(firebaseAuth.currentUser) : null),

    async register(input) {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, input.email, input.password)
      if (input.displayName) {
        // A name that fails to save is not an account that failed: they are in.
        await updateProfile(credential.user, { displayName: input.displayName }).catch((error) => {
          console.warn('[Auth] could not save the display name', error)
        })
      }
      refuseAdminOnWeb(firebaseAuth, credential.user)
      return toSessionUser(credential.user)
    },

    async login(credentials) {
      const credential = await signInWithEmailAndPassword(firebaseAuth, credentials.email, credentials.password)
      refuseAdminOnWeb(firebaseAuth, credential.user)
      return toSessionUser(credential.user)
    },

    async loginWithGoogle() {
      if (!googleProvider) throw new AuthError('hdl/unavailable', 'Google sign-in is not configured on this project.')
      const credential = await signInWithPopup(firebaseAuth, googleProvider)
      refuseAdminOnWeb(firebaseAuth, credential.user)
      return toSessionUser(credential.user)
    },

    async logout() {
      await signOut(firebaseAuth)
    },

    async resetPassword(email) {
      await sendPasswordResetEmail(firebaseAuth, email)
    },
  }

  const profileRef = (uid: string) => doc(firestore, PROFILES_COLLECTION, uid)

  const profiles: ProfilePort = {
    async read(uid) {
      const snapshot = await getDoc(profileRef(uid))
      return snapshot.exists() ? normalizeProfile({ uid, ...snapshot.data() }) : null
    },

    async create(profile) {
      // `merge` so a Guest signing up on a second device does not lose a role
      // written for them elsewhere, and never overwrites a role with the default.
      await setDoc(profileRef(profile.uid), profile, { merge: true })
      return profile
    },
  }

  return { auth: authPort, profiles }
}

