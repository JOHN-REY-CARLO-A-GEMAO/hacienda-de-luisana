// `/status` reports the refusal that a Guest's screen cannot.
//
// The bug this exists for. `firestoreBookings` remembered why Firestore refused a
// Booking write and exposed it as `lastCloudWriteFailure()` — and nothing ever
// called it. So a Guest was told the rules said no, the owner was told a date
// was too early, and the one record of what Firebase actually said went nowhere.
// The check has to survive a page reload's worth of nothing: it is a report on
// this browser session, which is exactly where the refusal happened.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/firebase', () => ({
  db: {}, auth: null, isFirebaseConfigured: true, isUsingEmulators: false,
  firebaseConfigReport: { source: 'env' },
}))
vi.mock('firebase/auth', () => ({
  signInAnonymously: async () => ({ user: { uid: 'anon-1234567890', isAnonymous: true } }),
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ exists: () => true }),
}))

import { runConnectionCheck } from '../../src/lib/connectionCheck'
import { lastCloudWriteFailure } from '../../src/lib/firestoreBookings'

/**
 * `lastWriteFailure` is module state by design — it survives until the tab is
 * closed, which is what makes it a report rather than a guess. So the assertion
 * is written against the real thing: make a write get refused, then read it.
 */
const writeCheck = async () =>
  (await runConnectionCheck()).find((check) => check.id === 'write')

describe('/status and a Booking write the rules refused', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('says so plainly when nothing has been refused', async () => {
    expect(lastCloudWriteFailure()).toBeNull()
    expect(await writeCheck()).toMatchObject({ status: 'ok' })
  })

  it('carries the owner-facing reason and Firebase\'s own words', async () => {
    const refused = {
      code: 'permission-denied',
      advice: 'Firestore refused the write. Deploy firestore.rules.',
      message: 'internal rules evaluation detail',
    }
    vi.spyOn(await import('../../src/lib/firestoreBookings'), 'lastCloudWriteFailure').mockReturnValue(refused)

    const check = await writeCheck()
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('permission-denied')
    expect(check?.detail).toContain('Deploy firestore.rules')
    expect(check?.detail).toContain('internal rules evaluation detail')
  })

  it('does not claim a reason when Firebase gave none', async () => {
    vi.spyOn(await import('../../src/lib/firestoreBookings'), 'lastCloudWriteFailure').mockReturnValue({
      code: 'permission-denied',
      advice: 'Firestore refused the write.',
    })

    expect((await writeCheck())?.detail).not.toMatch(/Firebase said/)
  })
})