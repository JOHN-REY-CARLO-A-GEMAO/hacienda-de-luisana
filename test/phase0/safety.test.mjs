import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { assertSafeInputs, assertIsolatedProcess, ROOT, DEMO_PROJECT } from '../../scripts/phase0/boundary.mjs'

const temp = fs.mkdtempSync(path.join(ROOT, '.cache/phase0/safety-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))
const safe = { env: {}, root: temp, home: path.join(temp, 'home') }

// Every negative fixture is synthetic. The safety tests themselves execute in
// the namespace; no control reaches a real cloud hostname.
test('kernel namespace is different from launcher and has loopback only', () => {
  const report = assertIsolatedProcess()
  assert.notEqual(report.parentNetns, report.testNetns)
  assert.deepEqual(report.interfaces, ['lo'])
  assert.equal(report.project, DEMO_PROJECT)
})
test('loopback positive control is reachable', async () => {
  const server = net.createServer(socket => socket.end('synthetic-only'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const value = await new Promise((resolve, reject) => {
      const client = net.connect(port, '127.0.0.1')
      let body = ''
      client.on('data', chunk => { body += chunk })
      client.on('end', () => resolve(body))
      client.on('error', reject)
    })
    assert.equal(value, 'synthetic-only')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
for (const host of ['203.0.113.10', '2001:db8::10']) test(`reserved external-address control has no route: ${host}`, async () => {
  await new Promise((resolve, reject) => {
    const client = net.connect({ host, port: 443 })
    client.setTimeout(1000, () => { client.destroy(); reject(new Error('isolation inconclusive: timed out instead of no-route')) })
    client.on('connect', () => { client.destroy(); reject(new Error('external connection unexpectedly established')) })
    client.on('error', error => {
      client.destroy()
      if (['ENETUNREACH', 'EHOSTUNREACH'].includes(error.code)) resolve()
      else reject(new Error(`isolation inconclusive: ${error.code}`))
    })
  })
})
test('native subprocess also inherits no external route (not a fetch mock)', () => {
  const child = spawnSync('python3', ['-c', "import socket; s=socket.socket(); e=s.connect_ex(('203.0.113.10',443)); assert e in (101,113); print('native no-route')"], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /native no-route/)
})
test('an arbitrary marker cannot substitute for actual namespace separation', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import {assertIsolatedProcess} from './scripts/phase0/boundary.mjs'; assertIsolatedProcess()"], {
    cwd: ROOT, env: { ...process.env, HDL_PHASE0_PARENT_NETNS: String(fs.statSync('/proc/self/ns/net').ino), HDL_PHASE0_ALLOW_PRODUCTION: 'true' }, encoding: 'utf8',
  })
  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /fresh network namespace/)
})
for (const name of ['GCLOUD_PROJECT', 'FIREBASE_PROJECT', 'FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) test(`non-demo project fails closed: ${name}`, () => {
  assert.throws(() => assertSafeInputs({ ...safe, env: { [name]: 'synthetic-nondemo-project' } }), new RegExp(name))
})
for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'ADMIN_PASSWORD', 'NODE_OPTIONS', 'EMULATOR_TEST_COMMAND', 'HTTPS_PROXY', 'DOCKER_HOST']) test(`configured credentials/unsafe input refused by name only: ${name}`, () => {
  const synthetic = 'phase0-private-sentinel-never-echo'
  let caught
  try { assertSafeInputs({ ...safe, env: { [name]: synthetic } }) } catch (error) { caught = error }
  assert.ok(caught)
  assert.ok(caught.message.includes(name))
  assert.ok(!caught.message.includes(synthetic))
})
test('unexpected hosted emulator host is refused', () => {
  assert.throws(() => assertSafeInputs({ ...safe, env: { FIRESTORE_EMULATOR_HOST: 'example.invalid:8080' } }), /FIRESTORE_EMULATOR_HOST/)
})
test('production credentials remain refused even with a fake allow flag', () => {
  const result = spawnSync(process.execPath, ['scripts/phase0/run.mjs', 'web'], {
    cwd: ROOT, env: { ...process.env, FIREBASE_SERVICE_ACCOUNT_JSON: 'phase0-private-sentinel-never-echo', HDL_PHASE0_ALLOW_PRODUCTION: 'true' }, encoding: 'utf8',
  })
  assert.equal(result.status, 78)
  assert.match(result.stderr, /FIREBASE_SERVICE_ACCOUNT_JSON/)
  assert.ok(!result.stderr.includes('phase0-private-sentinel-never-echo'))
})
test('non-example dotenv file blocks instead of being silently cleared', () => {
  const file = path.join(temp, '.env.local')
  fs.writeFileSync(file, 'VITE_SUPABASE_ANON_KEY=synthetic-only\n')
  try { assert.throws(() => assertSafeInputs(safe), /dotenv file present/) }
  finally { fs.unlinkSync(file) }
})
test('credential-file presence blocks and examples alone are not credentials', () => {
  fs.writeFileSync(path.join(temp, '.env.example'), 'VITE_SUPABASE_ANON_KEY=\n')
  assert.equal(assertSafeInputs(safe), true)
  const file = path.join(temp, 'service-account.json')
  fs.writeFileSync(file, '{"private_key":"synthetic-only"}')
  try { assert.throws(() => assertSafeInputs(safe), /credential-like file present/) }
  finally { fs.unlinkSync(file) }
})
test('authenticated Firebase CLI cache is refused without printing tokens', () => {
  const dir = path.join(safe.home, '.config/configstore')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'firebase-tools.json')
  fs.writeFileSync(file, JSON.stringify({ tokens: { refresh_token: 'synthetic-only' } }))
  try { assert.throws(() => assertSafeInputs(safe), /authenticated Firebase CLI configuration/) }
  finally { fs.unlinkSync(file) }
})
test('no arbitrary payload can be supplied to runner', () => {
  const child = spawnSync(process.execPath, ['scripts/phase0/run.mjs', 'web', '--config', 'somewhere.ts'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(child.status, 78)
  assert.match(child.stderr, /arbitrary flags\/commands are refused/)
})

test('Vite worker base path is not mistaken for a hosted API endpoint', () => {
  assert.equal(assertSafeInputs({ ...safe, env: { BASE_URL: '/' } }), true)
})
test('protocol-relative hosted QA base cannot bypass endpoint refusal', () => {
  assert.throws(() => assertSafeInputs({ ...safe, env: { BASE_URL: '//example.invalid' } }), /BASE_URL/)
})

// --- Canonical-verification additions (Phase 0 completion gate) -------------
test('emulators:exec FIREBASE_CONFIG is accepted only as the exact demo-derived value', async () => {
  const { EMULATOR_EXEC_FIREBASE_CONFIG } = await import('../../scripts/phase0/boundary.mjs')
  assert.equal(assertSafeInputs({ ...safe, env: { FIREBASE_CONFIG: EMULATOR_EXEC_FIREBASE_CONFIG } }), true)
  const variants = [
    JSON.stringify({ projectId: 'hacienda-de-luisana', storageBucket: 'hacienda-de-luisana.appspot.com', databaseURL: 'https://hacienda-de-luisana.firebaseio.com' }),
    JSON.stringify({ ...JSON.parse(EMULATOR_EXEC_FIREBASE_CONFIG), apiKey: 'phase0-private-sentinel-never-echo' }),
    JSON.stringify(JSON.parse(EMULATOR_EXEC_FIREBASE_CONFIG), null, 1),
    'phase0-private-sentinel-never-echo',
  ]
  for (const value of variants) {
    let caught
    try { assertSafeInputs({ ...safe, env: { FIREBASE_CONFIG: value } }) } catch (error) { caught = error }
    assert.ok(caught, 'non-demo FIREBASE_CONFIG must be refused')
    assert.ok(!caught.message.includes('phase0-private-sentinel-never-echo'))
  }
})
for (const name of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'ALL_PROXY']) test(`proxy escape route refused in any case: ${name}`, () => {
  assert.throws(() => assertSafeInputs({ ...safe, env: { [name]: 'http://127.0.0.1:3128' } }), new RegExp(name))
})
for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) test(`Supabase configuration refused by name: ${name}`, () => {
  assert.throws(() => assertSafeInputs({ ...safe, env: { [name]: 'phase0-private-sentinel-never-echo' } }), new RegExp(name))
})
test('a present-but-wrong emulator artefact is reported mismatched, never verified', async () => {
  const { verifyEmulatorArtifacts, EMULATOR_CACHE, pinnedEmulatorInfo } = await import('../../scripts/phase0/toolchain.mjs')
  const pin = pinnedEmulatorInfo().info.database
  const file = path.join(EMULATOR_CACHE, pin.downloadPathRelativeToCacheDir)
  if (fs.existsSync(file)) return // genuine artefact present; covered by verification output
  fs.mkdirSync(EMULATOR_CACHE, { recursive: true })
  fs.writeFileSync(file, 'not the pinned emulator')
  try {
    const report = verifyEmulatorArtifacts()
    assert.equal(report.rows.find(row => row.emulator === 'database').state, 'mismatched')
    assert.equal(report.ok, false)
  } finally { fs.unlinkSync(file) }
})
test('Java resolution uses the fixed repository-local path, not an environment override', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/phase0/toolchain.mjs'), 'utf8')
  assert.doesNotMatch(source, /process\.env\.(JAVA_HOME|HDL_)/)
})
