import assert from 'node:assert/strict'
import test from 'node:test'
import { SERVER_TIMESTAMP } from '../../functions/src/firestoreLike'
import {
  decodeFirestoreValue,
  encodeFirestoreValue,
  FirestoreRestClient,
} from '../src/firestoreRest'
import type { AccessTokenProvider } from '../src/googleAuth'

const tokenProvider: AccessTokenProvider = {
  async getAccessToken() { return 'test-access-token' },
  invalidateAccessToken() {},
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestBody(init?: RequestInit): Record<string, any> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, any>
}

test('Firestore REST value codec round-trips the types the Booking core uses', () => {
  const date = new Date('2027-01-01T00:00:00.000Z')
  const values: unknown[] = [
    null,
    true,
    'Casita',
    42,
    12.5,
    date,
    [1, 'two'],
    { nested: { count: 3 } },
    new Uint8Array([1, 2, 3]),
  ]
  for (const value of values) {
    assert.deepEqual(decodeFirestoreValue(encodeFirestoreValue(value)), value)
  }
})

test('reads a document and reports a true 404 as a missing snapshot', async () => {
  const urls: string[] = []
  const fetchFn = async (url: string | URL | Request) => {
    urls.push(String(url))
    if (String(url).includes('missing')) {
      return jsonResponse({ error: { status: 'NOT_FOUND', message: 'missing' } }, 404)
    }
    return jsonResponse({
      name: 'projects/demo/databases/(default)/documents/site_config/rates',
      fields: {
        version: { stringValue: 'rates-v1' },
        units: { integerValue: '2' },
      },
    })
  }
  const db = new FirestoreRestClient('demo', '(default)', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
    baseUrl: 'https://firestore.test/v1',
  })

  assert.deepEqual((await db.doc('site_config/rates').get()).data(), { version: 'rates-v1', units: 2 })
  assert.equal((await db.doc('site_config/missing').get()).exists, false)
  assert.match(urls[0]!, /projects\/demo\/databases\/\(default\)\/documents\/site_config\/rates/)
})

test('URL-encodes paths but keeps JSON resource names raw for IDs with spaces', async () => {
  let seenUrl = ''
  let commitBody: Record<string, any> = {}
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      seenUrl = String(url)
      return jsonResponse({
        name: 'projects/demo/databases/(default)/documents/booking_inventory_locks/The Casita',
        fields: { revision: { integerValue: '7' } },
      })
    }
    commitBody = requestBody(init)
    return jsonResponse({})
  }
  const db = new FirestoreRestClient('demo', '(default)', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
    baseUrl: 'https://firestore.test/v1',
  })
  const reference = db.doc('booking_inventory_locks/The Casita')

  assert.equal((await reference.get()).id, 'The Casita')
  assert.match(seenUrl, /booking_inventory_locks\/The%20Casita$/)
  await reference.set({ revision: 8 })
  assert.equal(
    commitBody.writes[0].update.name,
    'projects/demo/databases/(default)/documents/booking_inventory_locks/The Casita',
  )
})

test('builds the overlap query under the bookings collection', async () => {
  let body: Record<string, any> = {}
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /documents:runQuery$/)
    body = requestBody(init)
    return jsonResponse([{
      document: {
        name: 'projects/demo/databases/(default)/documents/bookings/b1',
        fields: {
          check_in: { stringValue: '2027-01-01' },
          check_out: { stringValue: '2027-01-02' },
        },
      },
    }])
  }
  const db = new FirestoreRestClient('demo', '(default)', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
    baseUrl: 'https://firestore.test/v1',
  })

  const snapshot = await db.collection('bookings')
    .where('accommodation', '==', 'Casita')
    .where('check_out', '>', '2026-12-31')
    .where('check_in', '<', '2027-01-31')
    .get()

  assert.equal(snapshot.size, 1)
  assert.equal(snapshot.docs[0]?.data().check_in, '2027-01-01')
  assert.equal(body.structuredQuery.from[0].collectionId, 'bookings')
  assert.equal(body.structuredQuery.where.compositeFilter.filters.length, 3)
})

test('turns nested server timestamps into same-commit REQUEST_TIME transforms', async () => {
  let body: Record<string, any> = {}
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    body = requestBody(init)
    return jsonResponse({})
  }
  const db = new FirestoreRestClient('demo', '(default)', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
    baseUrl: 'https://firestore.test/v1',
  })

  await db.doc('bookings/b1').update({
    money_checked: { at: SERVER_TIMESTAMP, matches: true },
  })

  assert.equal(body.writes.length, 2)
  assert.equal(body.writes[0].update.fields.money_checked.mapValue.fields.at, undefined)
  assert.deepEqual(body.writes[0].updateMask.fieldPaths, ['money_checked'])
  assert.equal(body.writes[1].transform.fieldTransforms[0].fieldPath, 'money_checked.at')
  assert.equal(body.writes[1].transform.fieldTransforms[0].setToServerValue, 'REQUEST_TIME')
})

test('retries a transaction only when Firestore reports ABORTED', async () => {
  let beginCount = 0
  let commitCount = 0
  let callbackCount = 0
  const fetchFn = async (urlValue: string | URL | Request) => {
    const url = String(urlValue)
    if (url.endsWith(':beginTransaction')) {
      beginCount += 1
      return jsonResponse({ transaction: `tx-${beginCount}` })
    }
    if (url.endsWith(':batchGet')) {
      return jsonResponse([{
        found: {
          name: 'projects/demo/databases/(default)/documents/booking_inventory_locks/Casita',
          fields: { revision: { integerValue: String(beginCount) } },
        },
      }])
    }
    if (url.endsWith(':commit')) {
      commitCount += 1
      if (commitCount === 1) {
        return jsonResponse({ error: { status: 'ABORTED', message: ' contention' } }, 409)
      }
      return jsonResponse({})
    }
    if (url.endsWith(':rollback')) return jsonResponse({})
    throw new Error(`Unexpected Firestore URL ${url}`)
  }
  const db = new FirestoreRestClient('demo', '(default)', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
    baseUrl: 'https://firestore.test/v1',
  })

  const revision = await db.runTransaction(async (transaction) => {
    callbackCount += 1
    const ref = db.doc('booking_inventory_locks/Casita')
    const snapshot = await transaction.get(ref)
    if (!('exists' in snapshot)) throw new Error('expected document snapshot')
    const next = Number(snapshot.data()?.revision ?? 0) + 1
    transaction.set(ref, { revision: next })
    return next
  })

  assert.equal(revision, 3)
  assert.equal(callbackCount, 2)
  assert.equal(beginCount, 2)
  assert.equal(commitCount, 2)
})
