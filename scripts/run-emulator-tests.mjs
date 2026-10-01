#!/usr/bin/env node
// Compatibility entry point, now fail-closed and scoped to an owned namespace.
// No global process sweep, arbitrary project or shell-command override.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const runner = fileURLToPath(new URL('./phase0/run.mjs', import.meta.url))
const result = spawnSync(process.execPath, [runner, 'emulator'], { stdio: 'inherit' })
process.exitCode = result.error ? 78 : (result.status ?? 1)
