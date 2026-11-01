import assert from 'node:assert/strict'
import test from 'node:test'
import { base64UrlToString, bytesToBase64 } from '../src/encoding'
import { GoogleAccessTokenProvider } from '../src/googleAuth'

async function testPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const exportedKey = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const pkcs8 = new Uint8Array(exportedKey as ArrayBuffer)
  const lines = bytesToBase64(pkcs8).match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`
}

test('signs a service-account assertion once and caches the access token', async () => {
  const privateKeyPem = await testPrivateKeyPem()
  let calls = 0
  let assertion = ''
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1
    const body = new URLSearchParams(String(init?.body ?? ''))
    assertion = body.get('assertion') ?? ''
    return Response.json({ access_token: 'access-token-1', expires_in: 3600 })
  }

  const provider = new GoogleAccessTokenProvider(
    {
      projectId: 'demo-project',
      clientEmail: 'worker@demo-project.iam.gserviceaccount.com',
      privateKeyPem,
      privateKeyId: 'key-1',
    },
    { fetchFn: fetchFn as typeof fetch, now: () => 1_700_000_000_000 },
  )

  assert.equal(await provider.getAccessToken(), 'access-token-1')
  assert.equal(await provider.getAccessToken(), 'access-token-1')
  assert.equal(calls, 1)

  const [header, claims, signature] = assertion.split('.')
  assert.ok(header && claims && signature)
  assert.deepEqual(JSON.parse(base64UrlToString(header)), { alg: 'RS256', typ: 'JWT', kid: 'key-1' })
  const parsedClaims = JSON.parse(base64UrlToString(claims)) as Record<string, unknown>
  assert.equal(parsedClaims.iss, 'worker@demo-project.iam.gserviceaccount.com')
  assert.match(String(parsedClaims.scope), /auth\/datastore/)
  assert.match(String(parsedClaims.scope), /auth\/identitytoolkit/)

  provider.invalidateAccessToken()
  assert.equal(await provider.getAccessToken(), 'access-token-1')
  assert.equal(calls, 2)
})
