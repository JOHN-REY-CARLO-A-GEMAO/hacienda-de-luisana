// ----------------------------------------------------------------------------
// The anonymous identity a Guest's own documents hang off.
//
// firestore.rules keys guest self-serve access to `uid` on the Booking document
// — `isOwnDoc()` compares it to `request.auth.uid` — and `uid` is not among the
// keys a Guest may change later. So the identity has to be attached when the
// Booking is created, exactly as the mobile app does; a Guest who signs in
// afterwards cannot claim a document that was created without them.
//
// Anonymous sign-in must be enabled in the Firebase console. When it is not, or
// when there is no Firebase project at all, this returns null and callers carry
// on without an identity rather than blocking a booking over it.
// ----------------------------------------------------------------------------
import { signInAnonymously } from 'firebase/auth'
import { auth, isFirebaseConfigured } from './firebase'

/**
 * The uid to stamp on a Guest's Booking, or null when there is no Firebase to
 * stamp it with. Never throws: a failed sign-in costs the Guest web uploads,
 * not their reservation.
 */
export async function ensureGuestUid(): Promise<string | null> {
  if (!isFirebaseConfigured || !auth) return null
  try {
    // Already signed in (the Host's own session, or an earlier anonymous one):
    // reuse it rather than replacing it.
    if (auth.currentUser) return auth.currentUser.uid
    const credential = await signInAnonymously(auth)
    return credential.user.uid
  } catch (e) {
    console.warn(
      '[GuestAuth] Could not sign the Guest in anonymously. ' +
        'Enable Anonymous sign-in in Firebase console → Authentication → Sign-in method. ' +
        'The booking will still be created, but this browser cannot upload its own ID later.',
      e,
    )
    return null
  }
}
