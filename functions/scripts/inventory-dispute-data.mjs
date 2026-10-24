#!/usr/bin/env node
/**
 * Read-only inventory for the retired dispute system.
 *
 * Counts documents and Storage objects only. It never prints case content,
 * downloads evidence bytes, writes Firestore, or deletes Storage objects.
 * Run with an authorized Application Default Credentials identity.
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  node scripts/inventory-dispute-data.mjs --project PROJECT_ID [--bucket BUCKET ...]

Reads aggregate counts for retired Firestore collections/subcollections and the
caseEvidence/ Storage prefix. No case content or object bytes are returned.
Use an authorized Application Default Credentials identity.`)
  process.exit(0)
}

const options = { '--project': [], '--bucket': [] }
for (let index = 0; index < args.length; index += 1) {
  const name = args[index]
  if (!(name in options)) throw new Error(`Unknown argument: ${name}`)
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  options[name].push(value)
  index += 1
}

const project = options['--project']
const buckets = options['--bucket']
if (project.length !== 1) throw new Error('Pass exactly one explicit --project PROJECT_ID.')

initializeApp({ projectId: project[0] })
const db = getFirestore()
const collections = [
  'cases',
  'casePrivate',
  'caseUploads',
  'caseOperations',
  'caseNotifications',
  'caseRateLimits',
  'caseCounters',
  'casePolicy',
  'caseMaintenance',
  'disputes',
]

async function documentCount(collection) {
  const result = await db.collection(collection).count().get()
  return result.data().count
}

async function subcollectionCounts(parent, children) {
  const counts = Object.fromEntries(children.map(child => [child, 0]))
  let last
  for (;;) {
    let query = db.collection(parent).select('status').orderBy('__name__').limit(250)
    if (last) query = query.startAfter(last)
    const page = await query.get()
    for (const document of page.docs) {
      for (const child of children) {
        const result = await document.ref.collection(child).count().get()
        counts[child] += result.data().count
      }
    }
    if (page.size < 250) break
    last = page.docs[page.docs.length - 1]
  }
  return counts
}

async function storageCount(name) {
  const bucket = getStorage().bucket(name)
  let objects = 0
  let bytes = 0
  for await (const file of bucket.getFilesStream({ prefix: 'caseEvidence/' })) {
    objects += 1
    bytes += Number(file.metadata.size || 0)
  }
  return { objects, bytes }
}

const firestore = Object.fromEntries(await Promise.all(
  collections.map(async collection => [collection, await documentCount(collection)]),
))
const subcollections = {
  cases: await subcollectionCounts('cases', ['activity', 'evidence']),
  casePrivate: await subcollectionCounts('casePrivate', ['notes']),
}
const storage = {}
for (const bucket of buckets) storage[bucket] = await storageCount(bucket)

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  project: project[0],
  mode: 'read-only aggregate inventory; no case content read into output',
  firestore,
  subcollections,
  storage,
  ...(buckets.length ? {} : {
    storageNote: 'No bucket supplied. Repeat with --bucket for each bucket that may contain caseEvidence/.',
  }),
}, null, 2))
