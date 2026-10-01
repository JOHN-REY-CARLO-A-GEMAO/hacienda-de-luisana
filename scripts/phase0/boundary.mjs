// Phase 0 only. No cloud SDK imports; error messages never include values.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DEMO_PROJECT = 'demo-hacienda'
export const EMULATOR_HOSTS = Object.freeze({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  FIREBASE_EMULATOR_HUB: '127.0.0.1:4400',
})
const projectNames = new Set(['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT', 'FIREBASE_PROJECT_ID', 'GCP_PROJECT', 'CLOUDSDK_CORE_PROJECT'])
const deniedNames = new Set([
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CREDENTIALS',
  'FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT',
  'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY',
  'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'EMULATOR_TEST_COMMAND',
  'NODE_OPTIONS', 'npm_config_node_options', 'NODE_PATH',
  'PLAYWRIGHT_MODULE', 'CHROMIUM_MODULE', 'DOCKER_HOST',
])
// `firebase emulators:exec` injects FIREBASE_CONFIG into the script it runs
// (firebase-tools lib/emulator/commandUtils.js runScript). Only this exact
// demo-derived value is accepted; any other value (another project, an extra
// key, different whitespace) is refused. It carries no credential.
export const EMULATOR_EXEC_FIREBASE_CONFIG = JSON.stringify({
  projectId: DEMO_PROJECT,
  storageBucket: `${DEMO_PROJECT}.appspot.com`,
  databaseURL: `https://${DEMO_PROJECT}.firebaseio.com`,
})
const excludedDirs = new Set(['.git', 'node_modules', '.cache', '.arena', '.local', '.npm', '.dart_tool', '.pub-cache', 'dist', 'build', 'coverage', '.scratch'])

export class IsolationError extends Error {
  constructor(reason) { super(`[Phase0 BLOCKED] ${reason}`); this.name = 'IsolationError'; this.code = 'PHASE0_ISOLATION' }
}

// Exported arguments are for negative unit fixtures; launchers always use the
// real environment, repository and home. There is no CLI override for them.
export function assertSafeInputs({ env = process.env, root = ROOT, home = os.homedir() } = {}) {
  const refused = []
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue
    if (projectNames.has(name)) {
      if (value !== DEMO_PROJECT) refused.push(name)
    } else if (name === 'FIREBASE_CONFIG') {
      if (value !== EMULATOR_EXEC_FIREBASE_CONFIG) refused.push(name)
    } else if (name in EMULATOR_HOSTS) {
      if (value !== EMULATOR_HOSTS[name]) refused.push(name)
    } else if (deniedNames.has(name) || /^(VITE_FIREBASE_|VITE_SUPABASE_|SUPABASE_|FIREBASE_ADMIN_|GOOGLE_SERVICE_ACCOUNT)/i.test(name)) {
      refused.push(name)
    } else if (/^(HTTPS?_PROXY|ALL_PROXY)$/i.test(name)) {
      refused.push(name)
    } else if (name === 'VITE_USE_FIREBASE_EMULATORS' || name === 'FIREBASE_EMULATOR_HOST' || name === 'FIREBASE_ENV_STRICT') {
      refused.push(name)
    } else if (name === 'BASE_URL') {
      // Vitest exposes Vite's exact public base path '/' to workers. It is
      // not a network endpoint; protocol-relative or other URLs still fail.
      if (value === '/') continue
      let url
      try { url = new URL(value) } catch { refused.push(name); continue }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) refused.push(name)
    }
  }
  if (env.NODE_ENV === 'production') refused.push('NODE_ENV')
  if (refused.length) throw new IsolationError(`unsafe inherited variable name(s): ${[...new Set(refused)].sort().join(', ')}`)

  function scan(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!excludedDirs.has(entry.name)) scan(path.join(dir, entry.name)); continue }
      if (/^\.env(?:\.|$)/.test(entry.name) && !entry.name.endsWith('.example')) {
        throw new IsolationError(`non-example dotenv file present: ${path.relative(root, path.join(dir, entry.name))}`)
      }
      if (/(?:service[-_]?account|application_default_credentials|credentials)[^/]*\.json$/i.test(entry.name) && !entry.name.endsWith('.example')) {
        throw new IsolationError(`credential-like file present: ${path.relative(root, path.join(dir, entry.name))}`)
      }
    }
  }
  scan(root)
  for (const relative of ['.config/gcloud/application_default_credentials.json', '.config/gcloud/credentials.db', '.supabase/access-token']) {
    if (fs.existsSync(path.join(home, relative))) throw new IsolationError(`cloud credential location present: ~/${relative}`)
  }
  for (const relative of ['.config/configstore/firebase-tools.json', '.config/firebase/firebase-tools.json']) {
    const file = path.join(home, relative)
    if (!fs.existsSync(file)) continue
    let data
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new IsolationError(`unreadable CLI credential configuration: ~/${relative}`) }
    if (data.tokens || data.user || data.accounts?.length) throw new IsolationError(`authenticated Firebase CLI configuration present: ~/${relative}`)
  }
  if (fs.existsSync('/var/run/docker.sock')) throw new IsolationError('host Docker socket present; orchestration escape has not been isolated')
  return true
}

export function assertIsolatedProcess() {
  assertSafeInputs()
  if (process.platform !== 'linux') throw new IsolationError('Linux network namespace required; no weaker fallback is permitted')
  const parent = Number(process.env.HDL_PHASE0_PARENT_NETNS)
  const current = fs.statSync('/proc/self/ns/net').ino
  if (!Number.isSafeInteger(parent) || parent === current || parent <= 0) throw new IsolationError('not running in the launcher-owned fresh network namespace')
  const interfaces = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').filter(line => line.includes(':')).map(line => line.split(':')[0].trim())
  if (interfaces.length !== 1 || interfaces[0] !== 'lo') throw new IsolationError('namespace has a non-loopback network interface')
  const routes = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1).filter(Boolean)
  if (routes.some(line => line.trim().split(/\s+/)[0] !== 'lo')) throw new IsolationError('namespace has a non-loopback IPv4 route')
  for (const entries of Object.values(os.networkInterfaces())) {
    if (entries?.some(entry => !entry.internal)) throw new IsolationError('kernel reports a non-loopback interface address')
  }
  if (process.env.GCLOUD_PROJECT !== DEMO_PROJECT || process.env.FIREBASE_PROJECT !== DEMO_PROJECT) throw new IsolationError('explicit demo project binding missing')
  return { project: DEMO_PROJECT, interfaces, parentNetns: parent, testNetns: current }
}

export function assertEmulatorEnvironment() {
  const report = assertIsolatedProcess()
  for (const [name, host] of Object.entries(EMULATOR_HOSTS)) {
    if (process.env[name] !== host) throw new IsolationError(`owned loopback emulator binding missing: ${name}`)
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertSafeInputs(); console.log('[Phase0] preflight inputs safe; this alone is NOT runtime network isolation') }
  catch (error) { console.error(error.message); process.exitCode = 78 }
}
