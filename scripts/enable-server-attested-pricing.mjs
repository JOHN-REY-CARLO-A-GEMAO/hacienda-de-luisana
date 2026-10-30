#!/usr/bin/env node
// ----------------------------------------------------------------------------
// Enable server-attested booking pricing (F1 / F7 remediation)
// ----------------------------------------------------------------------------
// Flips `site_config/booking.quotes_required` to `true` in Firestore, which
// makes `firestore.rules` `validGuestQuote()` enforce quote attestation on
// every Guest Booking create. Until this is on, a Guest can submit an
// arbitrary `stay_total` and the rules accept it (finding F1); and the
// ₱1,000 floor is not a real price check (finding F7).
//
// Prerequisites (must be done first, in order):
//  1. `firebase deploy --only firestore:rules` — the rules already contain
//     `quotesRequired()` and `validGuestQuote()`; they are inert while the
//     flag is off, so deploying them first is safe.
//  2. Deploy Cloud Functions with `BOOKING_QUOTES_ENABLED=true` set in the
//     runtime environment (named in `.env.example`, never committed).
//     Without the callable deployed, enforcement means every online Booking
//     is refused — deploy the functions BEFORE flipping this flag.
//  3. Run the website against production for one business day and confirm
//     every written Booking carries a `quote_id` whose `booking_quotes/`
//     document exists.
//
// Then run this script:
//   node scripts/enable-server-attested-pricing.mjs          # dry run
//   node scripts/enable-server-attested-pricing.mjs --confirm  # flip the flag
//
// Rollback: set `quotes_required` back to `false` in the Firestore console.
// One document, no deploy, no data repair.
// ----------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIRM = process.argv.includes('--confirm')
const PROJECT = 'hacienda-de-luisana'

// The Firebase Admin SDK is not a root dependency; it lives in functions/.
// This script is a template — run it from a context where firebase-admin is
// available (e.g. the functions directory after `npm install` there), or
// adapt it to your deployment tooling.
//
// eslint-disable-next-line no-unused-vars
let admin
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  admin = require('firebase-admin')
} catch {
  console.error('firebase-admin is not available in this context.')
  console.error('Run from the functions directory, or adapt to your deployment tooling.')
  process.exit(1)
}

async function main () {
  // The credential comes from the environment, never a command-line argument.
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT })
  }
  const db = admin.firestore()

  const ref = db.doc('site_config/booking')
  const snap = await ref.get()

  if (!snap.exists) {
    console.error('site_config/booking does not exist — create it first with the published rates.')
    process.exit(1)
  }

  const data = snap.data()
  const current = data?.quotes_required ?? false

  console.log(`site_config/booking.quotes_required = ${current}`)

  if (current === true) {
    console.log('Already enabled. Nothing to do.')
    return
  }

  if (!CONFIRM) {
    console.log('Dry run — would set quotes_required: true. Re-run with --confirm to apply.')
    return
  }

  await ref.set({ quotes_required: true }, { merge: true })
  console.log('Set site_config/booking.quotes_required = true.')
  console.log('Server-attested pricing is now enforced. Guest Bookings without a valid')
  console.log('quote_id will be refused by firestore.rules validGuestQuote().')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
