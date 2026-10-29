/**
 * Unit and multi-instance concurrency tests for `takePersistentQuota` and
 * `spendCallableQuota` (`functions/src/rateLimit.ts`).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MinuteBudget } from '../src/pricing'
import {
  CALLABLE_RATE_LIMITS_COLLECTION,
  rateLimitBucketId,
  spendCallableQuota,
  takePersistentQuota,
} from '../src/rateLimit'

function createFakeFirestore() {
  const store = new Map<string, Record<string, unknown>>()
  let txReads = 0
  let txWrites = 0
  let queue: Promise<unknown> = Promise.resolve()

  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

  const makeRef = (path: string) => ({
    id: path.split('/').at(-1)!,
    path,
    async get() {
      return {
        exists: store.has(path),
        id: path.split('/').at(-1)!,
        data: () => clone(store.get(path)),
      }
    },
  })

  const firestore = {
    collection(name: string) {
      return {
        doc(id: string) {
          assert.equal(id.includes('/'), false, `Bucket document ID must not contain slashes: ${id}`)
          return makeRef(`${name}/${id}`)
        },
      }
    },
    runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const next = queue.then(async () => {
        let writing = false
        const pending: Array<() => void> = []
        const tx = {
          async get(ref: ReturnType<typeof makeRef>) {
            assert.equal(writing, false, 'Firestore forbids transaction reads after writes')
            txReads += 1
            return ref.get()
          },
          set(ref: ReturnType<typeof makeRef>, data: Record<string, unknown>) {
            writing = true
            pending.push(() => {
              txWrites += 1
              store.set(ref.path, clone(data))
            })
          },
        }
        const result = await fn(tx)
        for (const write of pending) write()
        return result
      })
      queue = next.catch(() => {})
      return next
    },
  }

  return {
    firestore: firestore as never,
    store,
    stats: () => ({ txReads, txWrites }),
  }
}

describe('persistent Firestore callable rate limiter', () => {
  const T0 = Date.parse('2026-10-29T04:00:15.000Z')

  it('closes the maxInstances=5 gap so 40 distributed requests yield exactly 8 successes', async () => {
    const { firestore, stats } = createFakeFirestore()
    // 5 independent warm instances, each with its own MinuteBudget(8), sharing Firestore.
    const instances = Array.from({ length: 5 }, () => new MinuteBudget(8))

    let allowed = 0
    let exhausted = 0
    for (let i = 0; i < 40; i++) {
      const budget = instances[i % instances.length]!
      try {
        await spendCallableQuota({
          firestore,
          budget,
          scope: 'submitBooking',
          key: 'guest-uid-42',
          limit: 8,
          label: 'Booking',
          now: T0 + i * 10,
        })
        allowed += 1
      } catch (error) {
        const err = error as { code?: string; message?: string }
        assert.equal(err.code, 'resource-exhausted')
        assert.match(String(err.message), /Too many Booking requests\. Wait \d+ seconds/)
        exhausted += 1
      }
    }

    assert.equal(allowed, 8)
    assert.equal(exhausted, 32)
    // 8 allowed writes; instance 2 already observed count=8 on the 8th write,
    // the remaining 4 instances each observe count=8 once without writing, and
    // the remaining 28 hits are dropped in memory!
    assert.equal(stats().txWrites, 8)
    assert.equal(stats().txReads, 8 + 4)
  })

  it('drops a single-instance flood in memory after the ceiling without extra Firestore I/O', async () => {
    const { firestore, stats } = createFakeFirestore()
    const budget = new MinuteBudget(8)

    for (let i = 0; i < 8; i++) {
      await spendCallableQuota({
        firestore,
        budget,
        scope: 'submitBooking',
        key: 'flood-caller',
        limit: 8,
        now: T0,
      })
    }
    assert.deepEqual(stats(), { txReads: 8, txWrites: 8 })

    for (let i = 0; i < 100; i++) {
      await assert.rejects(
        spendCallableQuota({
          firestore,
          budget,
          scope: 'submitBooking',
          key: 'flood-caller',
          limit: 8,
          now: T0 + 100,
        }),
        (error: { code?: string }) => error.code === 'resource-exhausted',
      )
    }
    // Zero additional Firestore reads or writes for all 100 rejected requests.
    assert.deepEqual(stats(), { txReads: 8, txWrites: 8 })
  })

  it('reuses a single bucket document per (scope, caller) across window rollovers with TTL metadata', async () => {
    const { firestore, store } = createFakeFirestore()

    const first = await takePersistentQuota(firestore, {
      scope: 'quoteBooking',
      key: 'guest-1',
      limit: 2,
      now: T0,
    })
    const second = await takePersistentQuota(firestore, {
      scope: 'quoteBooking',
      key: 'guest-1',
      limit: 2,
      now: T0 + 1_000,
    })
    const blocked = await takePersistentQuota(firestore, {
      scope: 'quoteBooking',
      key: 'guest-1',
      limit: 2,
      now: T0 + 1_000,
    })

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(blocked.ok, false)
    assert.equal(blocked.retryAfterMs, 44_000)

    // Roll over to the next minute window: same document is overwritten in place.
    const nextWindow = await takePersistentQuota(firestore, {
      scope: 'quoteBooking',
      key: 'guest-1',
      limit: 2,
      now: T0 + 60_000,
    })
    assert.equal(nextWindow.ok, true)
    assert.equal(nextWindow.count, 1)
    assert.equal(store.size, 1)

    const docPath = `${CALLABLE_RATE_LIMITS_COLLECTION}/${rateLimitBucketId('quoteBooking', 'guest-1')}`
    const stored = store.get(docPath)!
    assert.equal(stored.scope, 'quoteBooking')
    assert.equal(stored.count, 1)
    assert.ok(stored.expires_at instanceof Date)
    assert.equal(JSON.stringify(stored).includes('guest-1'), false)
  })

  it('hashes raw IPs and path-unsafe caller strings into flat PII-free bucket IDs', () => {
    for (const rawKey of [
      '2001:db8:85a3::8a2e:370:7334',
      '../bookings/secret',
      'caller/with/slashes',
      '   ',
    ]) {
      const id = rateLimitBucketId('bookingAvailability', rawKey)
      assert.match(id, /^bookingAvailability_[a-f0-9]{32}$/)
      assert.equal(id.includes('/'), false)
      assert.equal(id.includes(':'), false)
    }
  })

  it('buffers light reads in memory when persistAfter > 0 and caps multi-instance scraping', async () => {
    const { firestore, stats } = createFakeFirestore()
    const instances = Array.from({ length: 5 }, () => new MinuteBudget(40))

    // Casual Guest browsing: 5 reads across instances triggers zero Firestore transactions.
    for (let i = 0; i < 5; i++) {
      await spendCallableQuota({
        firestore,
        budget: instances[i]!,
        scope: 'bookingAvailability',
        key: '203.0.113.9',
        limit: 40,
        persistAfter: 6,
        now: T0,
      })
    }
    assert.deepEqual(stats(), { txReads: 0, txWrites: 0 })

    // Scraper continues hammering across all 5 instances: persistent quota caps total below 5 * 40 = 200.
    let allowed = 5
    for (let i = 5; i < 80; i++) {
      try {
        await spendCallableQuota({
          firestore,
          budget: instances[i % 5]!,
          scope: 'bookingAvailability',
          key: '203.0.113.9',
          limit: 40,
          persistAfter: 6,
          now: T0 + i,
        })
        allowed += 1
      } catch (error) {
        assert.equal((error as { code?: string }).code, 'resource-exhausted')
      }
    }
    assert.ok(allowed <= 46, `expected global cap near 40 with 6 buffered, got ${allowed}`)
  })
})
