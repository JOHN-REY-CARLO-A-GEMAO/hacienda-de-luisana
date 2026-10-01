#!/usr/bin/env node
// Preparation, NOT a test: download the pinned CLI's public emulator binaries.
// No login, project provisioning, application SDK execution or remote data API.
//
// Afterwards (and also when the download is impossible, e.g. an air-gapped
// machine where the JARs were copied into .cache/phase0/emulators by hand) every
// artefact is checked against the SHA-256 pinned inside the locked
// firebase-tools package. A missing or mismatched artefact exits 78 (BLOCKED).
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertSafeInputs, ROOT } from './boundary.mjs'
import { EMULATOR_CACHE, REQUIRED_EMULATORS, resolveJava, verifyEmulatorArtifacts } from './toolchain.mjs'

try {
  assertSafeInputs()
  const java = resolveJava()
  const cli = path.join(ROOT, 'node_modules/firebase-tools/lib/bin/firebase.js')
  const env = { ...process.env, GCLOUD_PROJECT: 'demo-hacienda', FIREBASE_PROJECT: 'demo-hacienda',
    FIREBASE_EMULATORS_PATH: EMULATOR_CACHE,
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', NO_UPDATE_NOTIFIER: '1', CI: '1' }
  if (java?.home) Object.assign(env, { JAVA_HOME: java.home, PATH: `${path.dirname(java.bin)}${path.delimiter}${process.env.PATH}` })
  const before = verifyEmulatorArtifacts()
  for (const service of REQUIRED_EMULATORS) {
    if (before.rows.find(row => row.emulator === service)?.state === 'verified') continue
    const result = spawnSync(process.execPath, [cli, `setup:emulators:${service}`, '--project', 'demo-hacienda'], { cwd: ROOT, env, stdio: 'inherit' })
    if (result.error || result.status) console.error(`[Phase0] download of the pinned ${service} emulator failed`)
  }
  const after = verifyEmulatorArtifacts()
  for (const row of after.rows) console.log(`[Phase0] ${row.emulator} v${row.version}: ${row.state.toUpperCase()} (${row.file})`)
  if (!after.ok) { console.error('[Phase0 BLOCKED] pinned emulator artefacts are not all present and checksum-verified'); process.exitCode = 78 }
} catch (error) { console.error(error.message); process.exitCode = 78 }
