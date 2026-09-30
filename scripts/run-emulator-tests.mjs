#!/usr/bin/env node
// Run the emulator suites, and guarantee the emulators are gone afterwards.
//
// `firebase emulators:exec` prints "Shutting down emulators" and signals the
// hub, but the emulator services are separate java processes. On Windows that
// signal never reaches them: the hub exits, the java children are reparented and
// keep holding 8080, so the *next* `test:emulator` dies before a single test
// runs with
//
//     Error: Could not start Firestore Emulator, port taken.
//
// The same happens on Ctrl-C, and when vitest exits non-zero, because the
// teardown belongs to the parent that is already on its way out.
//
// So this wrapper owns the lifecycle: sweep whatever is left over from a
// previous run, start the run, and sweep again on every exit path — success,
// failure, or signal. The sweep matches the emulator jars by command line
// rather than by port, so an unrelated service on 8080 is reported rather than
// killed.

import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'demo-hacienda'
const SERVICES = 'auth,firestore,database,storage'
// Overridable so one file can be run against the emulators while debugging:
//   EMULATOR_TEST_COMMAND="vitest run --config vitest.emulator.config.ts test/emulator/rules.emulator.test.ts"
const VITEST = process.env.EMULATOR_TEST_COMMAND ?? 'vitest run --config vitest.emulator.config.ts'

/** Ports `firebase.json` gives the emulators. Used only to report, never to kill. */
const PORTS = { firestore: 8080, database: 9000, auth: 9099, storage: 9199 }

const isWindows = process.platform === 'win32'

/** PID of every running Firebase emulator service, orphaned or not. */
function findEmulators() {
  try {
    if (isWindows) {
      const script = [
        "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\"",
        "| Where-Object { $_.CommandLine -like '*firebase*emulator*' }",
        '| ForEach-Object { $_.ProcessId }',
      ].join(' ')
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return pids(out.split(/\r?\n/))
    }
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out
      .split('\n')
      .filter((line) => /firebase[\\/]emulators[\\/].*emulator.*\.jar/.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    // A sweep that cannot see the process table must not fail the run.
    return []
  }
}

const pids = (values) =>
  values
    .map((value) => Number(String(value).trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)

function killEmulators(label) {
  const found = findEmulators()
  if (found.length === 0) return []
  for (const pid of found) {
    try {
      // `/T` takes the service's own children with it on Windows.
      if (isWindows) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone, or not ours to kill. The port report below is the truth.
    }
  }
  console.log(`[emulators] swept ${found.length} leftover service(s) ${label} (${found.join(', ')})`)
  return found
}

/** Whether something is still bound to an emulator port. Probed, not parsed. */
function isBound(port) {
  const probe = net.createServer()
  return new Promise((resolve) => {
    probe.once('error', () => resolve(true))
    probe.once('listening', () => probe.close(() => resolve(false)))
    try {
      probe.listen(port, '127.0.0.1')
    } catch {
      resolve(true)
    }
  })
}

/** Which emulator ports are still bound. Reported, never killed — see the header. */
async function reportPorts() {
  const probes = await Promise.all(
    Object.entries(PORTS).map(async ([name, port]) => ((await isBound(port)) ? `${name} (${port})` : null)),
  )
  const taken = probes.filter(Boolean)
  if (taken.length > 0) {
    console.warn(
      `[emulators] still listening: ${taken.join(', ')}. Something other than a Firebase emulator ` +
        'is holding these — kill it before the next run.',
    )
  }
  return taken
}

// ---------------------------------------------------------------------------

killEmulators('from a previous run')

// The CLI's own entry point, run by this Node. Going through `firebase` /
// `firebase.cmd` needs `shell: true` on Windows, and a shell re-concatenates the
// arguments — which breaks the quoted vitest command and lands the CLI with
// "Too many arguments".
const firebaseCli = createRequire(import.meta.url).resolve('firebase-tools/lib/bin/firebase.js')
const child = spawn(
  process.execPath,
  [firebaseCli, 'emulators:exec', '--project', PROJECT, '--only', SERVICES, VITEST],
  { stdio: 'inherit' },
)

let finished = false
async function finish(code) {
  if (finished) return
  finished = true
  killEmulators('after the run')
  await reportPorts()
  process.exit(code)
}

// Cleanup has to happen on the way out of *every* path, including a Ctrl-C that
// arrives while the suite is running.
process.on('exit', (code) => {
  if (!finished) {
    killEmulators('after the run')
    process.exitCode = code
  }
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal)
    finish(130)
  })
}

child.on('error', (error) => {
  console.error(`[emulators] could not start: ${error.message}`)
  finish(127)
})
child.on('exit', (code, signal) => finish(signal ? 1 : (code ?? 1)))
