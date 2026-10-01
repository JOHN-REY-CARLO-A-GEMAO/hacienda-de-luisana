#!/usr/bin/env node
// Preparation, NOT a test. Installs the pinned Java 21 runtime into the
// gitignored .cache/phase0/java. The wheel is fetched with pip and accepted only
// if its SHA-256 equals JAVA_PIN.sha256; no system package is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertSafeInputs } from './boundary.mjs'
import { JAVA_DIR, JAVA_PIN, JAVA_BIN, resolveJava, sha256 } from './toolchain.mjs'

try {
  assertSafeInputs()
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phase0-java-'))
  const pip = spawnSync('python3', ['-m', 'pip', 'download', '--no-deps', '--only-binary=:all:', '--dest', work, JAVA_PIN.requirement], { stdio: 'inherit' })
  if (pip.error || pip.status) throw new Error('[Phase0 BLOCKED] pinned Java wheel could not be downloaded')
  const wheel = path.join(work, JAVA_PIN.wheel)
  if (!fs.existsSync(wheel)) throw new Error('[Phase0 BLOCKED] pip returned an unexpected artefact name')
  if (sha256(wheel) !== JAVA_PIN.sha256) throw new Error('[Phase0 BLOCKED] Java wheel SHA-256 does not match the pin; refusing to install')
  fs.rmSync(JAVA_DIR, { recursive: true, force: true })
  fs.mkdirSync(JAVA_DIR, { recursive: true })
  const unzip = spawnSync('python3', ['-m', 'zipfile', '-e', wheel, JAVA_DIR], { stdio: 'inherit' })
  if (unzip.error || unzip.status) throw new Error('[Phase0 BLOCKED] could not extract the Java wheel')
  for (const file of fs.readdirSync(path.dirname(JAVA_BIN))) fs.chmodSync(path.join(path.dirname(JAVA_BIN), file), 0o755)
  fs.rmSync(work, { recursive: true, force: true })
  const java = resolveJava()
  if (!java || java.major !== JAVA_PIN.majorVersion) throw new Error('[Phase0 BLOCKED] installed runtime is not Java 21')
  console.log(`[Phase0] Java ready (${java.source}): ${java.banner.join(' | ')}`)
} catch (error) { console.error(error.message); process.exitCode = 78 }
