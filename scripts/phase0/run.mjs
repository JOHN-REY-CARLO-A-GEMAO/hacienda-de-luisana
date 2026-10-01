#!/usr/bin/env node
// Fixed actions only. No project, endpoint, shell-command or safety overrides.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { assertSafeInputs, DEMO_PROJECT, ROOT } from './boundary.mjs'

export const ACTIONS = new Set(['safety', 'web', 'watch', 'rules', 'e2e', 'characterization', 'invariants', 'emulator', 'emulator-invariants', 'emulator-auth', 'supabase-rls', 'typecheck', 'build', 'flutter', 'flutter-invariants', 'flutter-analyze', 'qa-booking', 'qa-site', 'qa-tutorial'])

const action = process.argv[2]
try {
  if (!ACTIONS.has(action) || process.argv.length !== 3) throw new Error('[Phase0 BLOCKED] use one documented fixed action; arbitrary flags/commands are refused')
  assertSafeInputs()
  if (process.platform !== 'linux') throw new Error('[Phase0 BLOCKED] Linux unprivileged user/network namespaces are required')
  const env = { ...process.env,
    HDL_PHASE0_PARENT_NETNS: String(fs.statSync('/proc/self/ns/net').ino),
    HDL_PHASE0_ACTION: action,
    GCLOUD_PROJECT: DEMO_PROJECT, FIREBASE_PROJECT: DEMO_PROJECT,
    GOOGLE_CLOUD_PROJECT: DEMO_PROJECT,
    NODE_ENV: ['build', 'typecheck'].includes(action) ? 'development' : 'test',
    CI: action === 'watch' ? '' : '1',
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
    NO_UPDATE_NOTIFIER: '1',
  }
  fs.mkdirSync(path.join(ROOT, '.cache/phase0/results'), { recursive: true })
  const child = spawn('unshare', ['--user', '--map-root-user', '--net', 'python3', path.join(ROOT, 'scripts/phase0/netns.py'), process.execPath, action], {
    cwd: ROOT, env, stdio: 'inherit', detached: true,
  })
  let finished = false
  function cleanup() { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  child.on('error', (error) => { finished = true; console.error(`[Phase0 BLOCKED] launcher unavailable: ${error.code ?? 'unknown'}`); process.exitCode = 78 })
  child.on('exit', (code, signal) => {
    finished = true
    cleanup() // Only OUR process group; never scan/kill other emulator processes.
    process.exitCode = signal ? 1 : (code ?? 1)
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cleanup(); process.exitCode = 130 })
  process.on('exit', () => { if (!finished) cleanup() })
} catch (error) { console.error(error.message); process.exitCode = 78 }
