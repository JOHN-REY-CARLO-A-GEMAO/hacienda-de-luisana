// Phase 0 only. Pinned, repository-local verification toolchain.
//
// Nothing here is configurable from the environment or the command line: the
// Java runtime location, its pinned artefact hash, and the emulator artefacts'
// expected checksums are fixed. The emulator checksums are NOT restated here —
// they are read from the locked firebase-tools package's own
// downloadableEmulatorInfo.json, so the Emulator Suite version cannot drift
// silently from package-lock.json.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT } from './boundary.mjs'

// Eclipse Temurin 21.0.8+9 runtime image, as redistributed on PyPI by the
// `jdk4py` project (the only Java 21 distribution reachable from this sandbox).
export const JAVA_PIN = Object.freeze({
  distribution: 'jdk4py==21.0.8.2 (Eclipse Temurin 21.0.8+9 runtime image)',
  requirement: 'jdk4py==21.0.8.2',
  wheel: 'jdk4py-21.0.8.2-py3-none-manylinux_2_17_x86_64.whl',
  sha256: '85addfcb57c7051dad6145b9f816fc519337e9a0c705ef01edc9dc7818ee0356',
  majorVersion: 21,
})
export const JAVA_DIR = path.join(ROOT, '.cache/phase0/java')
export const JAVA_HOME = path.join(JAVA_DIR, 'jdk4py/java-runtime')
export const JAVA_BIN = path.join(JAVA_HOME, 'bin/java')
export const EMULATOR_CACHE = path.join(ROOT, '.cache/phase0/emulators')
export const REQUIRED_EMULATORS = Object.freeze(['firestore', 'database', 'storage'])

export function sha256(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1 << 20)
    let read
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read))
  } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}

/** Resolve Java: the pinned repository-local runtime first, then PATH. */
export function resolveJava() {
  const candidates = fs.existsSync(JAVA_BIN) ? [{ bin: JAVA_BIN, home: JAVA_HOME, source: 'pinned .cache/phase0/java' }] : []
  candidates.push({ bin: 'java', home: null, source: 'PATH' })
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.bin, ['-version'], { encoding: 'utf8' })
    if (probe.error || probe.status !== 0) continue
    const banner = `${probe.stderr}${probe.stdout}`.trim()
    const match = banner.match(/version "(\d+)(?:\.[^"]*)?"/)
    const major = match ? Number(match[1]) : NaN
    return { ...candidate, banner: banner.split('\n'), major }
  }
  return null
}

export function pinnedEmulatorInfo() {
  const file = path.join(ROOT, 'node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json')
  const cliVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/firebase-tools/package.json'), 'utf8')).version
  return { cliVersion, info: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

/**
 * Verify that each required emulator artefact is present at the exact pinned
 * name AND matches the pinned SHA-256 and size. A file that is present but
 * wrong is reported as `mismatched` — callers must treat that as BLOCKED, never
 * run it.
 */
export function verifyEmulatorArtifacts() {
  const { cliVersion, info } = pinnedEmulatorInfo()
  const rows = REQUIRED_EMULATORS.map(name => {
    const pin = info[name]
    const file = path.join(EMULATOR_CACHE, pin.downloadPathRelativeToCacheDir)
    const row = { emulator: name, version: pin.version, file: path.relative(ROOT, file), expectedSha256: pin.expectedChecksumSHA256, expectedSize: pin.expectedSize }
    if (!fs.existsSync(file)) return { ...row, state: 'missing' }
    const size = fs.statSync(file).size
    const actual = sha256(file)
    return { ...row, actualSha256: actual, size, state: actual === pin.expectedChecksumSHA256 && size === pin.expectedSize ? 'verified' : 'mismatched' }
  })
  return { cliVersion, rows, ok: rows.every(row => row.state === 'verified') }
}
