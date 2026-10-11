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
// on without an identity rather than blocking a booking over it — and the reason
// is kept (`lastIdentityFailure`) so `/status` can tell the owner which switch
// in the console turns it back on, instead of the Guest just silently losing
// their uploads.
// ----------------------------------------------------------------------------
import { signInAnonymously } from 'firebase/auth'
import { auth, isFirebaseConfigured } from './firebase'
import { appSession } from './authSession'
import { describeAuthFailure, failureLine, type FailureWords } from './firebaseFailure'

/** Why the last attempt to get a Guest identity failed, if it did. */
let lastFailure: FailureWords | null = null

/** Why the last attempt to get a Guest identity failed, or null if it worked. */
export function lastIdentityFailure(): FailureWords | null {
  return lastFailure
}

/**
 * The uid to stamp on a Guest's Booking, or null when there is no identity to
 * stamp it with. Never throws: a failed sign-in costs the Guest web uploads,
 * not their reservation.
 */
export async function ensureGuestUid(): Promise<string | null> {
  if (!isFirebaseConfigured || !auth) {
    // Demo mode has no anonymous sign-in to make, but a Guest who signed up here
    // still gets the Booking attached to the account they signed in with, so
    // /account can show it back to them. Nobody signed in, nobody to attach it to:
    // the Booking is still made, exactly as before.
    return appSession().getState().user?.uid ?? null
  }
  try {
    // Already signed in (the Admin's own session, or an earlier anonymous one):
    // reuse it rather than replacing it.
    if (auth.currentUser) {
      lastFailure = null
      return auth.currentUser.uid
    }
    const credential = await signInAnonymously(auth)
    lastFailure = null
    return credential.user.uid
  } catch (e) {
    lastFailure = describeAuthFailure(e)
    console.warn(
      '[GuestAuth] Could not sign the Guest in anonymously, so this Booking carries no identity ' +
        'and this browser cannot read it back later. ' +
        failureLine(lastFailure),
      e,
    )
    return null
  }
}
