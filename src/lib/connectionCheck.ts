// ----------------------------------------------------------------------------
// "Is this deployment actually wired?" — the check a person can run
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The failure this exists for is a silent one: a deployment built without its
// Firebase settings looks exactly like a working one until a Guest's request
// fails to arrive. The build half of the answer is decided at build time and
// reported by `firebaseConfigReport`; the live half — can this browser sign in,
// can it read the database — can only be asked from a browser.
//
// Three questions, in the order they would break:
//   1. Was this build given a project at all?
//   2. Can it obtain a Guest identity? (Anonymous sign-in, switched off by
//      default in a new Firebase project, is what /book depends on.)
//   3. Can it read Firestore? (A public read of `site_config/rates` — the rules
//      grant it, so a refusal means the rules are not deployed.)
//
// It signs in anonymously, which is exactly what sending a booking does; it
// writes nothing. `src/pages/StatusPage.tsx` is the surface, and it only runs
// when somebody presses the button.
// ----------------------------------------------------------------------------

import { signInAnonymously } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { appSession } from './authSession'
import {
  auth,
  db,
  firebaseConfigReport,
  isFirebaseConfigured,
  isUsingEmulators,
} from './firebase'
import { describeAuthFailure, describeFirestoreFailure, codeOf } from './firebaseFailure'
import { describeSource } from './firebaseConfig'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

export type Check = {
  id: 'build' | 'identity' | 'database' | 'emulators'
  label: string
  status: CheckStatus
  detail: string
}

/** The document the website reads to quote a payment plan. Public read. */
export const RATES_DOCUMENT = { collection: 'site_config', id: 'rates' } as const

export async function runConnectionCheck(): Promise<Check[]> {
  const checks: Check[] = []

  // 1. The build's own settings.
  checks.push(
    isFirebaseConfigured
      ? {
          id: 'build',
          label: 'Firebase settings in this build',
          status: 'ok',
          detail: describeSource(firebaseConfigReport.source),
        }
      : {
          id: 'build',
          label: 'Firebase settings in this build',
          status: 'fail',
          detail:
            'No project: this build has neither VITE_FIREBASE_* variables nor the committed ' +
            'defaults, so every request stays in this browser.',
        },
  )

  // 2. A Guest identity — what a Booking's `uid` comes from.
  if (!isFirebaseConfigured || !auth) {
    checks.push({
      id: 'identity',
      label: 'Guest identity (Anonymous sign-in)',
      status: 'skip',
      detail: 'Nothing to sign in to: this build has no Firebase project.',
    })
  } else if (auth.currentUser) {
    const user = auth.currentUser
    checks.push({
      id: 'identity',
      label: 'Guest identity (Anonymous sign-in)',
      status: 'ok',
      detail: user.isAnonymous
        ? `A Guest identity is already attached to this browser (${user.uid.slice(0, 8)}…).`
        : `Signed in as ${user.email ?? user.displayName ?? user.uid}. Bookings made here are attached to that account.`,
    })
  } else {
    try {
      const credential = await signInAnonymously(auth)
      checks.push({
        id: 'identity',
        label: 'Guest identity (Anonymous sign-in)',
        status: 'ok',
        detail:
          `Anonymous sign-in works — this is the identity a Booking is stamped with ` +
          `(${credential.user.uid.slice(0, 8)}…).`,
      })
    } catch (e) {
      const words = describeAuthFailure(e)
      checks.push({
        id: 'identity',
        label: 'Guest identity (Anonymous sign-in)',
        status: 'fail',
        detail: `${words.advice}${words.message ? ` (Firebase said: ${words.message})` : ''}`,
      })
    }
  }

  // 3. Firestore, through a read the rules allow anybody.
  if (!isFirebaseConfigured || !db) {
    checks.push({
      id: 'database',
      label: 'Firestore database',
      status: 'skip',
      detail: 'Nothing to read: this build has no Firebase project.',
    })
  } else {
    const { collection, id } = RATES_DOCUMENT
    try {
      const snap = await getDoc(doc(db, collection, id))
      checks.push({
        id: 'database',
        label: 'Firestore database',
        status: snap.exists() ? 'ok' : 'warn',
        detail: snap.exists()
          ? `Read ${collection}/${id}: the Admin has published rates, so a Guest can choose a payment plan.`
          : `Firestore answered, but ${collection}/${id} has not been published yet. Until the Admin ` +
            `publishes rates (Admin app → Rates), a Guest cannot choose a payment plan.`,
      })
    } catch (e) {
      const code = codeOf(e)
      const words = describeFirestoreFailure(e)
      checks.push({
        id: 'database',
        label: 'Firestore database',
        status: 'fail',
        detail:
          code === 'permission-denied'
            ? `Firestore refused a read that firestore.rules grants to anybody. Deploy the rules: ` +
              `firebase deploy --only firestore:rules. (${words.code})`
            : words.advice,
      })
    }
  }

  // 4. A pointer at the emulator suite on a visitor's machine is a mistake.
  if (isUsingEmulators) {
    checks.push({
      id: 'emulators',
      label: 'Emulator Suite',
      status: 'warn',
      detail:
        'This build points at the local Emulator Suite (VITE_USE_FIREBASE_EMULATORS=true). That is ' +
        'right for practice on a laptop; a visitor’s browser has no emulator, so remove it from the ' +
        'hosting dashboard for a real deployment.',
    })
  }

  return checks
}

/** Who, if anybody, this browser is signed in as — for the status page. */
export function currentIdentity(): { uid: string; anonymous: boolean; email: string | null } | null {
  const user = isFirebaseConfigured && auth ? auth.currentUser : appSession().getState().user
  if (!user) return null
  return {
    uid: user.uid,
    anonymous: (user as { isAnonymous?: boolean }).isAnonymous ?? !user.email,
    email: user.email ?? null,
  }
}
