#!/usr/bin/env node
// ----------------------------------------------------------------------------
// Operator CLI for the guest-history migration.
//
//   npm --prefix functions run build
//   # 1. LOOK, CHANGE NOTHING (the default, always safe):
//   node functions/lib/src/scripts/migrateGuestHistory.js --audit
//   node functions/lib/src/scripts/migrateGuestHistory.js --uid=<uid> --dry-run
//
//   # 2. Only with the operator's own hand on the switch:
//   node functions/lib/src/scripts/migrateGuestHistory.js --uid=<uid> --apply --confirm <projectId>
//   node functions/lib/src/scripts/migrateGuestHistory.js --all --apply --confirm <projectId>
//
//   # Waiting for a live-location session to end on its own, rather than
//   # aborting the moment one is seen:
//   node functions/lib/src/scripts/migrateGuestHistory.js --all --apply --confirm <projectId> --wait=70
//
//   # Checking the new paths after the fact (read-only, re-runnable):
//   node functions/lib/src/scripts/migrateGuestHistory.js --verify --uid=<uid>
//
// `--apply` refuses to start unless `--confirm` repeats the project id it is
// pointed at. That is deliberate friction: this job writes to real Guests'
// message history, in the project that serves real bookings. Nothing here
// deletes anything — that is a property of the migration itself, not of this
// flag — but it does copy, and copying is not something to do by accident.
//
// Against the emulator (`FIRESTORE_EMULATOR_HOST` set) `--confirm` is not
// required, because there is nothing there to be careful with.
// ----------------------------------------------------------------------------

import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initializeApp } from 'firebase-admin/app'

import { firestoreMigrationStores } from '../guestHistoryAdapter'
import {
  MAX_LIVE_LOCATION_WAIT_MS,
  auditGuestConversations,
  runGuestHistoryMigration,
  verifyGuestConversation,
  type MigrationResult,
} from '../guestConversationMigration'

type Args = {
  uid: string | null
  all: boolean
  audit: boolean
  apply: boolean
  resume: boolean
  verify: boolean
  json: boolean
  confirm: string | null
  /** Minutes to wait for live-location sessions to end. 0 checks once. */
  waitMinutes: number
  /** Seconds between re-checks while waiting. */
  pollSeconds: number
  help: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    uid: null,
    all: false,
    audit: false,
    apply: false,
    resume: false,
    verify: false,
    json: false,
    confirm: null,
    waitMinutes: 0,
    pollSeconds: 30,
    help: false,
  }
  for (const token of argv) {
    if (token === '--help' || token === '-h') args.help = true
    else if (token === '--all') args.all = true
    else if (token === '--audit') args.audit = true
    else if (token === '--apply') args.apply = true
    else if (token === '--resume') args.resume = true
    else if (token === '--verify') args.verify = true
    else if (token === '--json') args.json = true
    else if (token.startsWith('--uid=')) args.uid = token.slice('--uid='.length).trim()
    else if (token.startsWith('--confirm=')) args.confirm = token.slice('--confirm='.length).trim()
    else if (token.startsWith('--wait=')) {
      const minutes = Number(token.slice('--wait='.length).trim())
      if (!Number.isFinite(minutes) || minutes < 0) {
        throw new Error(`--wait takes minutes, 0 or more. Got: ${token}`)
      }
      args.waitMinutes = minutes
    } else if (token.startsWith('--poll-seconds=')) {
      const seconds = Number(token.slice('--poll-seconds='.length).trim())
      if (!Number.isFinite(seconds) || seconds < 1) {
        throw new Error(`--poll-seconds takes seconds, 1 or more. Got: ${token}`)
      }
      args.pollSeconds = seconds
    } else if (token === '--dry-run' || token === '--dry-run=true') args.apply = false
    else {
      throw new Error(`Unknown argument: ${token}. Run with --help.`)
    }
  }
  return args
}

function resolveProjectId(): string {
  return (
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    ''
  )
}

function isEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim())
}

const USAGE = `Guest-history migration

  --audit              Report every conversation structure. Writes nothing.
  --uid=<uid>          Restrict to one Guest account.
  --all                Run for every Guest the audit finds.
  --dry-run            Plan only. Writes nothing. (default)
  --apply              Copy. Requires --confirm <projectId>.
  --confirm=<id>       Repeat the project id you are about to write to.
  --resume             Take over a lease whose holder stopped renewing it.
  --wait=<minutes>     Wait for live-location sessions to end on their own
                       (0 = check once and abort, the default).
  --poll-seconds=<n>   Gap between live-location re-checks (default 30).
  --verify             Re-check the new paths for --uid/--all. Writes nothing.
  --json               Machine-readable output.

Nothing is ever deleted. Superseded threads are annotated, not removed.

MIGRATION IS DEFERRED WHILE LIVE LOCATION IS RUNNING. A session is filed under
the conversation id, and consolidating a thread retires the id it hangs on — so
a Guest mid-share would silently stop being watchable. The run looks in both
Firestore and the Realtime Database, waits for sessions to expire on their own,
rechecks immediately before the first write, and aborts if one is still live.
It never stops or invalidates a session, and it does not assume the time of day
means nobody is sharing.`

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (!args.audit && !args.uid && !args.all) {
    console.error('Pick a scope: --audit, --uid=<uid>, or --all. See --help.')
    return 2
  }
  if (args.waitMinutes * 60_000 > MAX_LIVE_LOCATION_WAIT_MS) {
    console.error(
      `--wait=${args.waitMinutes} is longer than the longest session (${MAX_LIVE_LOCATION_WAIT_MS / 60_000} minutes). ` +
        'Wait for it to end, then run again.',
    )
    return 2
  }

  const projectId = resolveProjectId()
  if (args.apply && !isEmulator()) {
    if (!args.confirm) {
      console.error(
        'Refusing to apply without --confirm <projectId>. This job writes to real message history.',
      )
      return 3
    }
    if (!projectId) {
      console.error('No project id resolved (set GCLOUD_PROJECT). Refusing to apply.')
      return 3
    }
    if (args.confirm !== projectId) {
      console.error(
        `Refusing to apply: --confirm was "${args.confirm}" but this process is pointed at "${projectId}".`,
      )
      return 3
    }
  }

  initializeApp()
  const db = getFirestore()
  let bucket = null
  try {
    bucket = getStorage().bucket()
  } catch {
    // No bucket on this project: the run still reports attachments it cannot copy
    // instead of failing the whole thing later, half-done.
    console.warn('[migration] no Storage bucket available; attachment copies will be refused')
  }
  let database = null
  try {
    database = getDatabase()
  } catch {
    // Deliberately NOT swallowed into a "carry on regardless". The live-location
    // guard reads the Realtime Database, and without it the job can see the
    // consent but not the position. `firestoreMigrationStores` turns a null
    // database into a guard that throws, so an apply refuses to start rather
    // than guessing that the coast is clear.
    console.warn('[migration] no Realtime Database available; live location cannot be checked')
  }
  if (args.apply && !database) {
    console.error(
      'Refusing to apply without a Realtime Database: live-location positions cannot be checked, ' +
        'so this job cannot promise it is not cutting a Guest off. Configure the database, or see --help.',
    )
    return 3
  }
  const stores = firestoreMigrationStores(db, bucket, database)

  if (args.audit) {
    const report = await auditGuestConversations(stores, {
      ...(args.uid ? { uid: args.uid } : {}),
      logger: console,
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(
        `[migration] audit: ${report.totals.guests} guest(s), ${report.totals.sourceThreads} superseded thread(s), ` +
          `${report.totals.plannedCopies} message(s) and ${report.totals.plannedAttachments} attachment(s) to copy.`,
      )
      for (const guest of report.guests) {
        console.log(
          `  ${guest.uid}: canonical=${guest.canonicalExists ? 'yes' : 'MISSING'} ` +
            `sources=${guest.sources.length} copies=${guest.plannedCopies} attachments=${guest.plannedAttachments}`,
        )
        for (const source of guest.sources) {
          console.log(
            `    - ${source.id}: ${source.messageCount} message(s), ${source.attachmentCount} attachment(s)` +
              `${source.bookingId ? `, booking ${source.bookingId}` : ''}`,
          )
        }
      }
      if (report.orphans.length) {
        console.log(`[migration] ${report.orphans.length} document(s) name no owner and are left alone:`)
        for (const orphan of report.orphans) console.log(`    ! ${orphan.id} (${orphan.reason})`)
      }
    }
    return 0
  }

  const uids = args.all
    ? (await auditGuestConversations(stores, { logger: console })).guests.map((guest) => guest.uid)
    : [args.uid as string]

  // --verify is read-only and answers one question: do the paths the Guest and
  // the Admin both use actually work, now?
  if (args.verify) {
    const reports = []
    for (const uid of uids) {
      const report = await verifyGuestConversation(stores, uid)
      reports.push(report)
      if (!args.json) {
        console.log(
          `[migration] verify ${uid}: ${report.ok ? 'OK' : 'FAILED'} — ` +
            `${report.checked.messages} message(s), ${report.checked.attachments} attachment(s), ` +
            `${report.checked.sources} superseded thread(s), ${report.checked.liveLocation} live session(s)`,
        )
        for (const path of Object.values(report.paths)) console.log(`    ${path}`)
        for (const problem of report.problems) console.error(`    ! ${problem}`)
      }
    }
    if (args.json) console.log(JSON.stringify(reports, null, 2))
    return reports.some((report) => !report.ok) ? 1 : 0
  }

  const results: MigrationResult[] = []
  for (const uid of uids) {
    const result = await runGuestHistoryMigration(stores, {
      uid,
      dryRun: !args.apply,
      ...(args.resume ? { resume: true } : {}),
      ...(args.waitMinutes > 0
        ? { liveLocation: { timeoutMs: args.waitMinutes * 60_000, pollMs: args.pollSeconds * 1_000 } }
        : {}),
      logger: console,
    })
    results.push(result)
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const result of results) {
      const line =
        `${result.uid}: ${result.status} — planned ${result.planned}, copied ${result.copied}, ` +
        `attachments ${result.attachments}` +
        (result.superseded.length ? `, superseded ${result.superseded.join(', ')}` : '')
      console.log(`[migration] ${line}`)
      if (result.status === 'blocked-live-location') {
        for (const session of result.liveLocation?.blocking ?? []) {
          console.warn(
            `[migration]   waiting on a live-location session on ${session.conversationId}` +
              ` (seen in ${session.foundIn.join(' + ')}` +
              `${session.expiresAtMs ? `, ends ${new Date(session.expiresAtMs).toISOString()}` : ''})`,
          )
        }
        console.warn('[migration]   nothing was copied and no session was touched. Run again when it has ended.')
      }
      if (result.liveLocationClosureFailures?.length) {
        console.error(
          `[migration]   ${result.liveLocationClosureFailures.length} retired thread(s) could NOT be closed to live location:`,
        )
        for (const failure of result.liveLocationClosureFailures) console.error(`[migration]     ! ${failure}`)
        console.error(
          '[migration]   The Firestore fence is still holding — no NEW session can open on them — ' +
            'but a browser already holding one could keep writing until its own window closes.',
        )
      }
      if (result.verification && !result.verification.ok) {
        console.error(`[migration]   VERIFICATION FAILED for ${result.uid}:`)
        for (const problem of result.verification.problems) console.error(`[migration]     ! ${problem}`)
      }
      if (result.error) console.error(`[migration]   error: ${result.error}`)
    }
  }

  // A blocked Guest is skipped, not failed: with --all the others still go
  // ahead, and the operator is told which to come back to.
  const failed = results.some((result) => result.status === 'failed')
  const unverified = results.some((result) => result.verification && !result.verification.ok)
  const unclosed = results.some((result) => (result.liveLocationClosureFailures?.length ?? 0) > 0)
  return failed || unverified || unclosed ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error('[migration] fatal:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
