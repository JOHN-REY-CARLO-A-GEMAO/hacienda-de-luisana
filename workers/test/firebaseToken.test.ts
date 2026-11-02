import assert from 'node:assert/strict'
import test from 'node:test'
import { base64UrlToBytes, bytesToBase64Url, stringToBase64Url } from '../src/encoding'
import { FirebaseTokenError, FirebaseTokenVerifier } from '../src/firebaseToken'

const NOW_SECONDS = 1_800_000_000

async function makeVerifier() {
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
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey
  let jwksCalls = 0
  const fetchFn = async () => {
    jwksCalls += 1
    return Response.json(
      { keys: [{ ...jwk, kid: 'test-key-1' }] },
      { headers: { 'Cache-Control': 'public, max-age=300' } },
    )
  }

  async function sign(overrides: Record<string, unknown> = {}): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' }
    const claims = {
      sub: 'guest-uid-1',
      aud: 'demo-project',
      iss: 'https://securetoken.google.com/demo-project',
      iat: NOW_SECONDS - 10,
      exp: NOW_SECONDS + 3600,
      auth_time: NOW_SECONDS - 10,
      user_id: 'guest-uid-1',
      ...overrides,
    }
    const input = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(claims))}`
    const signature = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      pair.privateKey,
      new TextEncoder().encode(input),
    )
    return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`
  }

  return {
    sign,
    getJwksCalls: () => jwksCalls,
    verifier: new FirebaseTokenVerifier('demo-project', {
      fetchFn: fetchFn as typeof fetch,
      now: () => NOW_SECONDS * 1000,
    }),
  }
}

test('accepts a correctly signed Firebase ID token and caches its JWKS', async () => {
  const { verifier, sign, getJwksCalls } = await makeVerifier()
  const token = await sign()

  assert.equal((await verifier.verify(token)).sub, 'guest-uid-1')
  assert.equal((await verifier.verify(token)).sub, 'guest-uid-1')
  assert.equal(getJwksCalls(), 1)
})

test('refuses wrong audience, expiry, and tampered signatures', async () => {
  const { verifier, sign } = await makeVerifier()

  await assert.rejects(verifier.verify(await sign({ aud: 'other-project' })), FirebaseTokenError)
  await assert.rejects(verifier.verify(await sign({ exp: NOW_SECONDS - 1000 })), FirebaseTokenError)

  const token = await sign()
  const [header, claims, signature] = token.split('.')
  const signatureBytes = base64UrlToBytes(signature!)
  // Flip a significant signature byte. Changing only the final base64url
  // character can alter discarded padding bits and leave the RSA signature
  // byte-for-byte unchanged, which made this assertion flaky.
  signatureBytes[0] = signatureBytes[0]! ^ 0x01
  const tampered = `${header}.${claims}.${bytesToBase64Url(signatureBytes)}`
  await assert.rejects(verifier.verify(tampered), FirebaseTokenError)
})
