import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccessTokenProvider } from '../src/googleAuth'
import { IdentityToolkitAuthUsers } from '../src/identityToolkit'

test('looks up the Admin-check fields by Firebase local ID', async () => {
  let seenUrl = ''
  let seenBody: Record<string, unknown> = {}
  let authorization = ''
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url)
    seenBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    authorization = new Headers(init?.headers).get('Authorization') ?? ''
    return Response.json({
      users: [{
        localId: 'Admin-uid',
        disabled: false,
        email: 'Admin@example.com',
        emailVerified: true,
      }],
    })
  }
  const tokenProvider: AccessTokenProvider = {
    async getAccessToken() { return 'access-token' },
    invalidateAccessToken() {},
  }
  const users = new IdentityToolkitAuthUsers('demo-project', tokenProvider, {
    fetchFn: fetchFn as typeof fetch,
  })

  assert.deepEqual(await users.getUser('Admin-uid'), {
    disabled: false,
    email: 'Admin@example.com',
    emailVerified: true,
  })
  assert.match(seenUrl, /projects\/demo-project\/accounts:lookup$/)
  assert.deepEqual(seenBody, { localId: ['Admin-uid'] })
  assert.equal(authorization, 'Bearer access-token')
})
