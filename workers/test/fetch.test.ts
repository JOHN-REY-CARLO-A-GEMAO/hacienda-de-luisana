import assert from 'node:assert/strict'
import test from 'node:test'
import { bindGlobalFetch } from '../src/fetch'

function receiverSensitiveFetch(
  this: unknown,
  _input: RequestInfo | URL,
  _init?: RequestInit,
): Promise<Response> {
  // Workerd's platform fetch throws `TypeError: Illegal invocation` when a
  // client instance, rather than the realm global, becomes its receiver.
  if (this !== globalThis) throw new TypeError('Illegal invocation')
  return Promise.resolve(new Response('ok'))
}

test('bindGlobalFetch keeps a stored fetch callable as a client method', async () => {
  const client = {
    fetchFn: bindGlobalFetch(receiverSensitiveFetch as typeof fetch),
  }

  const response = await client.fetchFn('https://example.invalid/resource')

  assert.equal(await response.text(), 'ok')
})
