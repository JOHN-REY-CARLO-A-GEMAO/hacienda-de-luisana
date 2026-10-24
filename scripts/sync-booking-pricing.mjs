#!/usr/bin/env node
// ----------------------------------------------------------------------------
// Sync the canonical booking pricing into the Cloud Functions bundle
// ----------------------------------------------------------------------------
// Why this exists is the important part.
//
// The authoritative price of a stay is computed in `src/lib/booking/rates.ts`
// (`quoteAccommodation`) — the guest-count schedule per standard stay times the
// nights of the stay, classification against the published holiday list,
// addons, the 50/50 split, the Security deposit, the refund snapshot. That
// module is pure and closed:
// nothing in `src/lib/booking/` imports Firebase, Vite or a browser API, which
// is why it is testable without them.
//
// A Cloud Function has to run the *same* arithmetic — a second implementation
// would drift, and drift in a price is the bug this whole feature exists to fix.
// But `firebase deploy --only functions` uploads the `functions/` directory and
// its installed dependencies only: a `../../src/...` import compiles and then
// fails at runtime, because the file it needs is not in the bundle. So the pure
// closure is copied in, from the one authored source.
//
// A copy is only safe if it cannot go stale silently, so this script also writes
// `manifest.json` with the SHA-256 of every source file and every copy, and
// `functions/test/booking-sync.test.ts` recomputes them on every run of
// `npm run test:functions`. Edit `src/lib/booking/`, forget to re-sync, and the
// Functions suite goes red naming the file.
//
// Usage:
//   node scripts/sync-booking-pricing.mjs           # write the mirror
//   node scripts/sync-booking-pricing.mjs --check    # verify it; exit 1 if stale
// ----------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = join(ROOT, 'src', 'lib', 'booking')
const TARGET_DIR = join(ROOT, 'functions', 'src', 'booking')

const HEADER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '//',
  '// @ts-nocheck — deliberate. This copy is *transpiled* here and *checked* where',
  '// it is authored: `npx tsc -b` type-checks src/lib/booking under the web',
  "// project's own settings, and `npm test` runs its tests. The Functions project",
  '// sets `noUncheckedIndexedAccess`, which this module was not written against,',
  '// and re-checking a mirror is how a generated file ends up being "fixed" here',
  '// and drifted from the source. The freshness of the copy is what is enforced,',
  '// by functions/test/booking-sync.test.ts.',
  '// Source: src/lib/booking/<this file>.',
  "// Regenerate with `npm run sync:pricing`; `npm run check:pricing` proves it is current.",
  '// The Functions bundle cannot import the web tree at runtime, so the canonical',
  '// pricing module is mirrored here. Change the arithmetic in src/lib/booking and',
  '// re-sync — never edit this copy.',
  '',
  '',
].join('\n')

/**
 * Where the walk starts: `rates.ts` is the quote, `money.ts` the split and the
 * plan options, `availability.ts` the Date-hold and overlap arithmetic, and
 * `leadTime.ts` the 30-day rule — so the server's lead-time refusal is the same
 * sentence the website and `firestore.rules` produce, from one implementation.
 * Everything else arrives transitively through their relative imports.
 */
const ENTRIES = ['rates.ts', 'money.ts', 'availability.ts', 'leadTime.ts']

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** Relative `./x` specifiers, resolved to files inside the booking module. */
function localImports(text) {
  const found = []
  for (const match of text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
    if (!match[1].startsWith('./')) continue
    found.push(`${match[1].slice(2)}.ts`)
  }
  return found
}

function closure(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    for (const next of localImports(readFileSync(join(SOURCE_DIR, name), 'utf8'))) queue.push(next)
  }
  return [...seen].sort()
}

const check = process.argv.includes('--check')
const files = closure(ENTRIES)
const manifestFiles = {}

for (const name of files) {
  const source = readFileSync(join(SOURCE_DIR, name), 'utf8')
  const body = HEADER + source
  manifestFiles[name] = { source_sha256: sha256(source), copy_sha256: sha256(body), bytes: Buffer.byteLength(body) }
  if (check) {
    const target = join(TARGET_DIR, name)
    if (!existsSync(target) || readFileSync(target, 'utf8') !== body) {
      console.error(`stale mirror: functions/src/booking/${name}`)
      process.exitCode = 1
    }
  } else {
    mkdirSync(dirname(join(TARGET_DIR, name)), { recursive: true })
    writeFileSync(join(TARGET_DIR, name), body)
  }
}

const manifestText = `${JSON.stringify({
  note: 'Written by scripts/sync-booking-pricing.mjs. Checked by functions/test/booking-sync.test.ts.',
  source_dir: 'src/lib/booking',
  entries: ENTRIES,
  files: manifestFiles,
}, null, 2)}\n`

if (check) {
  const manifestPath = join(TARGET_DIR, 'manifest.json')
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifestText) {
    console.error('stale mirror: functions/src/booking/manifest.json')
    process.exitCode = 1
  }
  // Named, so `npm run check:pricing` in CI has something to show for a pass
  // besides silence — and so a human can tell "clean" from "did nothing".
  if (!process.exitCode) {
    console.log(`functions/src/booking is in step with the website's src/lib/booking (${Object.keys(manifestFiles).length} mirrored files)`)
  }
} else {
  mkdirSync(TARGET_DIR, { recursive: true })
  // Nothing the closure has outgrown may stay in the bundle: an orphan the web
  // tree has already deleted would still compile, and someone would still find
  // it, wondering which of the two is authoritative.
  for (const entry of readdirSync(TARGET_DIR)) {
    if (entry.endsWith('.ts') && !(entry in manifestFiles)) rmSync(join(TARGET_DIR, entry))
  }
  writeFileSync(join(TARGET_DIR, 'manifest.json'), manifestText)
  console.log(`functions/src/booking ← ${files.join(', ')}`)
}
