import assert from 'node:assert/strict'
import test from 'node:test'
import { CallableError, type CallableContext } from '../../functions/src/callable'
import type { FirebaseIdTokenClaims } from '../src/firebaseToken'
import worker, { handleCallableRequest, type WorkerServices } from '../src/index'

const ALLOWED_ORIGIN = 'https://haciendadeluisana.com'
const seenContexts: CallableContext[] = []

const services: WorkerServices = {
  async bookingAvailability(context) {
    seenContexts.push(context)
    return {
      accommodation: 'Casita',
      from: '2027-01-01',
      to: '2027-01-02',
      days: [{ date: '2027-01-01', remainingUnits: 1 }],
      received: context.data,
    } as never
  },
  async submitBooking(context) {
    seenContexts.push(context)
    return { bookingId: 'booking-1', status: 'Pending' } as never
  },
  async paymentReferenceStatus(context) {
    seenContexts.push(context)
    return { duplicate: true, bookingId: 'booking-9', key: '7044357122304' }
  },
  async quoteBooking() {
    throw new CallableError('failed-precondition', 'Quote refused for this test.', { cause: 'TEST' })
  },
  async verifyBookingMoney(context) {
    seenContexts.push(context)
    return { bookingId: 'booking-1', matches: true } as never
  },
}

async function verifyIdToken(token: string): Promise<FirebaseIdTokenClaims> {
  if (token !== 'good-token') throw new Error('bad token')
  return {
    sub: 'guest-uid',
    aud: 'demo-project',
    iss: 'https://securetoken.google.com/demo-project',
    iat: 1,
    exp: 4_102_444_800,
  }
}

function callableRequest(endpoint: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.test/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ALLOWED_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function invoke(request: Request): Promise<Response> {
  return handleCallableRequest(request, {
    services,
    verifyIdToken,
    allowedOrigins: [ALLOWED_ORIGIN],
  })
}

test('returns Firebase callable results with exact-origin CORS and verified identity', async () => {
  seenContexts.length = 0
  const response = await invoke(callableRequest('verifyBookingMoney', {
    data: { bookingId: 'booking-1' },
  }, {
    Authorization: 'Bearer good-token',
    'CF-Connecting-IP': '203.0.113.8',
  }))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
  assert.deepEqual(await response.json(), { result: { bookingId: 'booking-1', matches: true } })
  assert.equal(seenContexts[0]?.authUid, 'guest-uid')
  assert.equal(seenContexts[0]?.ip, '203.0.113.8')
})

test('routes paymentReferenceStatus so the duplicate popup can see other Guests', async () => {
  seenContexts.length = 0
  const response = await invoke(callableRequest('paymentReferenceStatus', {
    data: { reference: '7044 357 122304' },
  }, {
    Authorization: 'Bearer good-token',
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    result: { duplicate: true, bookingId: 'booking-9', key: '7044357122304' },
  })
  assert.equal(seenContexts[0]?.authUid, 'guest-uid')
  assert.deepEqual(seenContexts[0]?.data, { reference: '7044 357 122304' })
})

test('decodes Firebase Int64 wrappers before the Booking core sees data', async () => {
  const response = await invoke(callableRequest('bookingAvailability', {
    data: {
      count: {
        '@type': 'type.googleapis.com/google.protobuf.Int64Value',
        value: '42',
      },
    },
  }))
  const body = await response.json() as { result: { received: { count: unknown } } }
  assert.equal(body.result.received.count, 42)
})

test('refuses malformed callable envelopes and invalid supplied credentials', async () => {
  const malformed = await invoke(callableRequest('bookingAvailability', { data: {}, extra: true }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json() as { error: { status: string } }).error.status, 'INVALID_ARGUMENT')

  const badAuth = await invoke(callableRequest('bookingAvailability', { data: {} }, {
    Authorization: 'Bearer bad-token',
  }))
  assert.equal(badAuth.status, 401)
  assert.equal((await badAuth.json() as { error: { status: string } }).error.status, 'UNAUTHENTICATED')
})

test('maps shared-core errors to Firebase callable status and HTTP code', async () => {
  const response = await invoke(callableRequest('quoteBooking', { data: {} }, {
    Authorization: 'Bearer good-token',
  }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: {
      message: 'Quote refused for this test.',
      status: 'FAILED_PRECONDITION',
      details: { cause: 'TEST' },
    },
  })
})

test('answers CORS preflights only for allowed origins', async () => {
  const allowed = await invoke(new Request('https://worker.test/quoteBooking', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }))
  assert.equal(allowed.status, 204)
  assert.match(allowed.headers.get('Access-Control-Allow-Headers') ?? '', /X-Firebase-AppCheck/)

  const denied = await invoke(callableRequest('quoteBooking', { data: {} }, {
    Origin: 'https://evil.example',
  }))
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null)
})

test('health reports an unconfigured Worker without pretending it is live', async () => {
  const response = await worker.fetch(new Request('https://worker.test/health'), {})
  assert.equal(response.status, 503)
  const body = await response.json() as { configured: boolean; endpoints: string[] }
  assert.equal(body.configured, false)
  assert.ok(body.endpoints.includes('submitBooking'))
})
