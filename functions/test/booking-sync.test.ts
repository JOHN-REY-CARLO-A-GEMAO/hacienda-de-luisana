/**
 * The mirror that makes ADR-0019's claim of one arithmetic true.
 *
 * `functions/src/booking/` is not a reimplementation and must never be edited. Its
 * whole purpose is that the Cloud Function and the website run *the same* pricing
 * module, so a hand-corrected copy — one that fixes a bug, or quietly changes a
 * rate — is the failure mode this file exists to catch. Everything here reads the
 * committed manifest produced by `scripts/sync-booking-pricing.mjs` and compares it
 * to what is actually on disk.
 *
 * Run with `npm run test:functions`, or directly: `cd functions && npm test`.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const MIRROR_DIR = path.resolve(__dirname, '..', '..', 'src', 'booking')
const manifest = JSON.parse(readFileSync(path.join(MIRROR_DIR, 'manifest.json'), 'utf8')) as {
  /** The files the closure was seeded from — the pricing modules, by name. */
  entries: string[]
  /** Every mirrored file, by name, with the hashes that make the mirror checkable. */
  files: Record<string, { source_sha256: string; copy_sha256: string; bytes: number }>
}
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

describe('the mirrored pricing module is the website’s, byte for byte', () => {
  const entries = Object.entries(manifest.files)

  it('is not an empty mirror pretending to be one', () => {
    // The test would pass trivially if the manifest were emptied out, so its
    // contents are asserted first: the pricing modules are all there.
    assert.ok(entries.length >= 4, `only ${entries.length} files in the manifest`)
    for (const required of ['rates.ts', 'money.ts', 'availability.ts', 'leadTime.ts']) {
      assert.ok(manifest.entries.includes(required), `${required} is not mirrored`)
      assert.ok(entries.some(([file]) => file === required), `${required} has no recorded hash`)
    }
  })

  for (const [file, recorded] of entries) {
    it(`${file} hashes to what the manifest recorded`, () => {
      const sourcePath = path.join(REPO_ROOT, 'src', 'lib', 'booking', file)
      const copyPath = path.join(MIRROR_DIR, file)
      assert.ok(existsSync(sourcePath), `the website no longer has src/lib/booking/${file} — the mirror is stale`)
      const source = readFileSync(sourcePath)
      const copy = readFileSync(copyPath)
      // The source may move or be edited; the manifest may not be edited to match a
      // copy somebody hand-corrected. Both hashes must agree with the record.
      assert.equal(sha256(source), recorded.source_sha256, `src/lib/booking/${file} changed without re-running the sync`)
      assert.equal(sha256(copy), recorded.copy_sha256, `functions/src/booking/${file} was edited — restore it with the sync script`)
      // Freshness alone is not enough: the manifest could have been re-generated
      // *after* a hand edit. The stronger claim is that the copy is the source with
      // a banner on top and nothing else — so the mirrored body is verified here,
      // byte for byte, independently of the manifest.
      const body = copy.toString('utf8')
      assert.ok(body.endsWith(source.toString('utf8')), `functions/src/booking/${file} is not the website's file verbatim`)
      const banner = body.slice(0, body.length - source.length)
      assert.match(banner, /GENERATED FILE — DO NOT EDIT/, `${file} has no generated banner explaining what may edit it`)
      assert.match(banner, /sync:pricing/, `${file}'s banner does not say how to regenerate it`)
    })
  }

  it('has no stray file the manifest does not account for', () => {
    const onDisk = readdirSync(MIRROR_DIR).filter((f) => f.endsWith('.ts')).sort()
    const recorded = Object.keys(manifest.files).sort()
    assert.deepEqual(onDisk, recorded, 'functions/src/booking holds a file the sync script did not write')
  })

  it('is the module the price is actually computed from', () => {
    // A mirror nothing imports would be theatre: the whole point is that the
    // function's figure comes out of the website's own code.
    const pricing = readFileSync(path.resolve(MIRROR_DIR, '..', 'pricing.ts'), 'utf8')
    for (const file of ['rates', 'money', 'leadTime']) {
      assert.match(pricing, new RegExp(`from '\\./booking/${file}'`), `pricing.ts does not import ./booking/${file}`)
    }
    const quotes = readFileSync(path.resolve(MIRROR_DIR, '..', 'quotes.ts'), 'utf8')
    assert.match(quotes, /from '\.\/pricing'/, 'quotes.ts does not use the pricing module')
    // The rest of the mirror is the closure those three pull in. If a mirrored file
    // is reachable from nothing, it is not a dependency — it is a second copy of
    // something nobody reads, and it should be deleted rather than kept fresh.
    const mirrored = new Map(Object.keys(manifest.files).map((f) => [f.replace(/\.ts$/, ''), readFileSync(path.join(MIRROR_DIR, f), 'utf8')]))
    for (const [name, text] of mirrored) {
      if (pricing.includes(`./booking/${name}'`)) continue
      const importedBy = [...mirrored.entries()].filter(([other, otherText]) => other !== name && otherText.includes(`./${name}'`)).map(([other]) => other)
      assert.ok(importedBy.length > 0, `functions/src/booking/${name}.ts is mirrored but nothing in the bundle imports it`)
    }
  })

  it('reports no drift when the sync script checks', () => {
    // The same comparison the CI gate runs, from here, so the gate cannot be
    // described as green while the tests say otherwise.
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-booking-pricing.mjs'), '--check'], { encoding: 'utf8' })
    assert.match(out, /in step with the website/, out)
  })
})
