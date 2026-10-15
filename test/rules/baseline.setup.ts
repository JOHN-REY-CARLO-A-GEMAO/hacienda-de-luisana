/** Baseline reads pinned Git objects, never writes rules or contacts GitHub. */
import { vi } from 'vitest'
vi.mock('node:fs', async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { resolve } = await import('node:path')
  const commit = 'e5155dec0e2255c3f6b29dbec7b1f5e063f1d878'
  const original = new Map([
    ['firestore.rules', execFileSync('git', ['show', `${commit}:firestore.rules`])],
    ['storage.rules', execFileSync('git', ['show', `${commit}:storage.rules`])],
  ])
  return { ...fs, readFileSync: ((file: Parameters<typeof fs.readFileSync>[0], options?: any) => {
    for (const [name, buffer] of original) if (typeof file === 'string' && resolve(file) === resolve(name)) {
      const encoding = typeof options === 'string' ? options : options?.encoding
      return encoding ? buffer.toString(encoding) : buffer
    }
    return fs.readFileSync(file, options)
  }) }
})
