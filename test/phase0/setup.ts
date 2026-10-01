import { assertIsolatedProcess } from '../../scripts/phase0/boundary.mjs'
import { beforeEach, afterEach, vi } from 'vitest'

assertIsolatedProcess()
// Deterministic Phase 0 browser/model fixtures only. Existing suites keep their
// own clocks and are not silently altered. Timers remain real except Date.
beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T04:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (typeof localStorage !== 'undefined') localStorage.clear()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
})
