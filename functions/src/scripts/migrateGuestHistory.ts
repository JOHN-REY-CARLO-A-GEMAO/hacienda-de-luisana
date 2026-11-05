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
// `--apply` refuses to start unless `--confirm` repeats the project id it is
// pointed at. That is deliberate friction: this job writes to real Guests'
// message history, in the project that serves real bookings. Nothing here
// deletes anything — that is a property of the migration itself, not of this
// flag — but it does copy, and copying is not something to do by accident.
//
// Against the emulator (`FIRESTORE_EMULATOR_HOST` set) `--confirm` is not
// required, because there is nothing there to be careful with.
// ----------------------------------------------------------------------------

import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { initializeApp } from 'firebase-admin/app'

import { firestoreMigrationStores } from '../guestHistoryAdapter'
import {
  auditGuestConversations,
  runGuestHistoryMigration,
  type MigrationResult,
} from '../guestConversationMigration'

type Args = {
  uid: string | null
  all: boolean
  audit: boolean
  apply: boolean
  resume: boolean
  json: boolean
  confirm: string | null
  help: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    uid: null,
    all: false,
    audit: false,
    apply: false,
    resume: false,
    json: false,
    confirm: null,
    help: false,
  }
  for (const token of argv) {
    if (token === '--help' || token === '-h') args.help = true
    else if (token === '--all') args.all = true
    else if (token === '--audit') args.audit = true
    else if (token === '--apply') args.apply = true
    else if (token === '--resume') args.resume = true
    else if (token === '--json') args.json = true
    else if (token.startsWith('--uid=')) args.uid = token.slice('--uid='.length).trim()
    else if (token.startsWith('--confirm=')) args.confirm = token.slice('--confirm='.length).trim()
    else if (token === '--dry-run' || token === '--dry-run=true') args.apply = false
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
  --json               Machine-readable output.

Nothing is ever deleted. Superseded threads are annotated, not removed.`

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
  const stores = firestoreMigrationStores(db, bucket)

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

  const results: MigrationResult[] = []
  for (const uid of uids) {
    const result = await runGuestHistoryMigration(stores, {
      uid,
      dryRun: !args.apply,
      ...(args.resume ? { resume: true } : {}),
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
      if (result.error) console.error(`[migration]   error: ${result.error}`)
    }
  }

  return results.some((result) => result.status === 'failed') ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error('[migration] fatal:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
