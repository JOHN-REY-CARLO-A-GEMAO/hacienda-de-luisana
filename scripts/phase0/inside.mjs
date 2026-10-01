// Executed only after netns.py has established the kernel boundary.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { ROOT, EMULATOR_HOSTS, assertIsolatedProcess, assertEmulatorEnvironment } from './boundary.mjs'
import { EMULATOR_CACHE, JAVA_PIN, resolveJava, verifyEmulatorArtifacts } from './toolchain.mjs'

const action = process.argv[2]
const info = assertIsolatedProcess()
console.log(`[Phase0 TEST] ${action}; project=${info.project}; network=loopback-only; netns=${info.testNetns}`)
const node = process.execPath
const binary = name => path.join(ROOT, 'node_modules', name)
const result = name => path.join(ROOT, '.cache/phase0/results', `${name}.json`)
const log = name => path.join(ROOT, '.cache/phase0/results', `${name}.log`)
const startedAt = new Date().toISOString()
const historyDir = path.join(ROOT, '.cache/phase0/results/history', `${action}-${startedAt.replace(/[^0-9]/g, '')}-${process.pid}`)
fs.mkdirSync(historyDir, { recursive: true })
const steps = []
let exitCode = 0
let status = 'NOT TESTED'
let reason = ''
let command = ''

function requireFile(file, prerequisite) {
  if (!fs.existsSync(file)) throw Object.assign(new Error(`${prerequisite} missing; prepare dependencies outside TEST first`), { blocked: true })
}
async function execute(executable, args, { env = process.env, logName = action } = {}) {
  command = [executable, ...args].join(' ')
  const stepCommand = [executable, ...args].join(' ')
  const out = fs.createWriteStream(path.join(historyDir, `${steps.length}-${logName}.log`))
  const child = spawn(executable, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { process.stdout.write(data); out.write(data) })
  child.stderr.on('data', data => { process.stderr.write(data); out.write(data) })
  return await new Promise((resolve, reject) => {
    child.on('error', error => { out.end(); reject(error) })
    child.on('close', code => { out.end(); steps.push({ command: stepCommand, exitCode: code ?? 1 }); resolve(code ?? 1) })
  })
}
async function vitest(config) {
  const file = binary('vitest/vitest.mjs')
  requireFile(file, 'locked npm dependencies')
  return execute(node, [file, 'run', '--config', config, '--reporter=default', '--reporter=json', `--outputFile=${result(action)}`])
}

try {
  if (action === 'safety') {
    exitCode = await execute(node, ['--test', '--test-reporter=tap', 'test/phase0/safety.test.mjs'])
  } else if (action === 'supabase-rls') {
    // SUPPLEMENTAL: real Postgres policy engine, not Supabase staging.
    requireFile(path.join(ROOT, '.cache/phase0/tools/node_modules/@electric-sql/pglite/package.json'), 'PGlite (prepare:phase0:supabase-rls)')
    exitCode = await execute(node, ['--test', '--test-reporter=tap', 'test/phase0/supabase/storage-rls.postgres.test.mjs'])
  } else if (['web', 'rules', 'e2e', 'characterization', 'invariants'].includes(action)) {
    const configs = { web: 'vitest.config.ts', rules: 'vitest.rules.config.ts', e2e: 'vitest.e2e.config.ts', characterization: 'vitest.phase0.config.ts', invariants: 'vitest.phase0.config.ts' }
    exitCode = await vitest(configs[action])
  } else if (action === 'watch') {
    requireFile(binary('vitest/vitest.mjs'), 'locked npm dependencies')
    exitCode = await execute(node, [binary('vitest/vitest.mjs'), '--config', 'vitest.config.ts'])
  } else if (action === 'typecheck' || action === 'build') {
    requireFile(binary('typescript/bin/tsc'), 'locked TypeScript')
    exitCode = await execute(node, [binary('typescript/bin/tsc'), '-b'])
    if (!exitCode) exitCode = await execute(node, [binary('typescript/bin/tsc'), '-p', 'tsconfig.phase0.json', '--noEmit'], { logName: 'phase0-typecheck' })
    if (!exitCode && action === 'build') {
      requireFile(binary('vite/bin/vite.js'), 'locked Vite')
      // Compile the genuine production bundle, without executing it or
      // deploying it. This process still has no external network interface.
      exitCode = await execute(node, [binary('vite/bin/vite.js'), 'build'], { env: { ...process.env, NODE_ENV: 'production' }, logName: 'build-vite' })
    }
  } else if (action === 'emulator' || action === 'emulator-invariants' || action === 'emulator-auth') {
    requireFile(binary('firebase-tools/lib/bin/firebase.js'), 'locked Firebase CLI')
    const authOnly = action === 'emulator-auth'
    const toolchain = { action }
    // Java: the pinned repository-local runtime first (fixed path, not env-overridable).
    const java = resolveJava()
    if (!authOnly) {
      if (!java) throw Object.assign(new Error('Java runtime missing; local Firebase rules evaluation is BLOCKED (run prepare:phase0:java)'), { blocked: true })
      if (java.major < JAVA_PIN.majorVersion) throw Object.assign(new Error(`Java ${java.major} found; the pinned Emulator Suite requires Java ${JAVA_PIN.majorVersion}+`), { blocked: true })
    }
    if (java) toolchain.java = { source: java.source, banner: java.banner }
    if (java?.home) Object.assign(process.env, { JAVA_HOME: java.home, PATH: `${path.dirname(java.bin)}${path.delimiter}${process.env.PATH}` })
    // Emulator JARs: present at the pinned name AND matching the pinned SHA-256.
    const artefacts = verifyEmulatorArtifacts()
    toolchain.firebaseTools = artefacts.cliVersion
    toolchain.emulators = artefacts.rows.map(({ emulator, version, state }) => ({ emulator, version, state }))
    fs.writeFileSync(path.join(historyDir, 'toolchain.json'), JSON.stringify(toolchain, null, 2) + '\n')
    console.log(`[Phase0 TEST] toolchain ${JSON.stringify(toolchain)}`)
    if (!authOnly && !artefacts.ok) {
      const bad = artefacts.rows.filter(row => row.state !== 'verified').map(row => `${row.emulator} v${row.version} ${row.state}`).join(', ')
      throw Object.assign(new Error(`pinned emulator artefacts not verified (${bad}); run prepare:phase0:emulators outside TEST`), { blocked: true })
    }
    Object.assign(process.env, EMULATOR_HOSTS, { FIREBASE_EMULATORS_PATH: EMULATOR_CACHE })
    assertEmulatorEnvironment()
    const config = {
      firestore: { rules: path.join(ROOT, 'firestore.rules'), indexes: path.join(ROOT, 'firestore.indexes.json') },
      database: { rules: path.join(ROOT, 'database.rules.json') },
      storage: { rules: path.join(ROOT, 'storage.rules') },
      emulators: {
        auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 },
        database: { host: '127.0.0.1', port: 9000 }, storage: { host: '127.0.0.1', port: 9199 },
        hub: { host: '127.0.0.1', port: 4400 }, logging: { host: '127.0.0.1', port: 4500 },
        ui: { enabled: false }, singleProjectMode: true,
      },
    }
    const configFile = path.join(ROOT, '.cache/phase0/firebase.test.json')
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
    // Fixed shell payload imposed by Firebase emulators:exec, no env override.
    const payload = `${JSON.stringify(node)} ${JSON.stringify(binary('vitest/vitest.mjs'))} run --config vitest.emulator.config.ts --reporter=default --reporter=json --outputFile=${JSON.stringify(result(action))}`
    exitCode = await execute(node, [binary('firebase-tools/lib/bin/firebase.js'), 'emulators:exec', '--config', configFile, '--project', 'demo-hacienda', '--only', authOnly ? 'auth' : 'auth,firestore,database,storage', payload])
  } else if (action.startsWith('flutter')) {
    const version = spawnSync('flutter', ['--version'], { encoding: 'utf8' })
    if (version.error || version.status !== 0) throw Object.assign(new Error('Flutter/Dart SDK missing; native tests/build analysis are BLOCKED'), { blocked: true })
    if (!fs.existsSync(path.join(ROOT, '.dart_tool/package_config.json'))) throw Object.assign(new Error('locked Flutter dependencies not prepared; do not pub-get with application execution'), { blocked: true })
    let args
    if (action === 'flutter-analyze') args = ['analyze', '--no-pub']
    else if (action === 'flutter-invariants') args = ['test', '--no-pub', 'test/phase0/dart/invariants_test.dart', '--reporter=json']
    else args = ['test', '--no-pub', ...fs.readdirSync(path.join(ROOT, 'test')).filter(file => file.endsWith('_test.dart')).map(file => `test/${file}`), 'test/phase0/dart/characterization_test.dart', '--reporter=json']
    exitCode = await execute('flutter', args)
  } else if (action.startsWith('qa-')) {
    // Browser binaries are optional preparation, not installed by test code.
    requireFile(binary('playwright/package.json'), 'Playwright (optional browser QA tooling)')
    requireFile(binary('vite/bin/vite.js'), 'locked Vite')
    const vite = spawn(node, [binary('vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { cwd: ROOT, env: process.env, stdio: 'ignore' })
    try {
      const controller = new AbortController()
      const ready = new Promise((resolve, reject) => {
        vite.once('error', reject)
        vite.once('exit', code => reject(new Error(`owned demo server exited (${code})`)))
        // A bounded readiness check within TEST; never poll a remote hostname.
        const timer = setInterval(async () => {
          try { const response = await fetch('http://127.0.0.1:3000', { signal: controller.signal }); if (response.ok) { clearInterval(timer); resolve() } } catch {}
        }, 100)
        setTimeout(() => { clearInterval(timer); reject(new Error('owned demo server did not start')) }, 10_000).unref()
      })
      await ready
      const scripts = { 'qa-booking': 'docs/qa/booking-lead-time-browser-test.mjs', 'qa-site': 'docs/qa/site-browser-test.mjs', 'qa-tutorial': 'docs/qa/tutorial-browser-test.mjs' }
      exitCode = await execute(node, [scripts[action], ...(action === 'qa-booking' ? [] : ['desktop'])], { env: { ...process.env, BASE_URL: 'http://127.0.0.1:3000' } })
      controller.abort()
    } finally { vite.kill('SIGTERM') }
  } else {
    throw Object.assign(new Error('unknown fixed action'), { blocked: true })
  }
  status = exitCode ? 'FAIL' : 'PASS'
} catch (error) {
  exitCode = error.blocked || error.code === 'ENOENT' ? 78 : 1
  status = exitCode === 78 ? 'BLOCKED' : 'FAIL'
  reason = error.message
  console.error(`[Phase0 ${status}] ${reason}`)
} finally {
  const record = {
    action, command, environment: 'TEST / Linux loopback-only network namespace', project: info.project,
    testNetns: info.testNetns, startedAt, endedAt: new Date().toISOString(), status, exitCode, reason, steps,
  }
  fs.writeFileSync(path.join(ROOT, '.cache/phase0/results', `${action}.command.json`), JSON.stringify(record, null, 2) + '\n')
  fs.writeFileSync(path.join(historyDir, 'command.json'), JSON.stringify(record, null, 2) + '\n')
  fs.appendFileSync(path.join(ROOT, '.cache/phase0/results', 'commands.ndjson'), JSON.stringify(record) + '\n')
  if (fs.existsSync(result(action))) fs.copyFileSync(result(action), path.join(historyDir, 'vitest.json'))
  process.exitCode = exitCode
}
