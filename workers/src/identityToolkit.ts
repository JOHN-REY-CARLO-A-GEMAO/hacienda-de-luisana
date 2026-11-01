/**
 * Minimal Identity Platform user lookup used by `verifyBookingMoney` to
 * reproduce the Admin SDK `getUser(uid)` checks (disabled account, email,
 * and email verification).
 */

import type { AuthUserLookup, AuthUserRecordLike } from '../../functions/src/quotesCore'
import { bindGlobalFetch } from './fetch'
import type { AccessTokenProvider } from './googleAuth'

export interface IdentityToolkitOptions {
  fetchFn?: typeof fetch
  baseUrl?: string
}

export class IdentityToolkitAuthUsers implements AuthUserLookup {
  private readonly fetchFn: typeof fetch
  private readonly baseUrl: string

  constructor(
    private readonly projectId: string,
    private readonly tokenProvider: AccessTokenProvider,
    options: IdentityToolkitOptions = {},
  ) {
    this.fetchFn = bindGlobalFetch(options.fetchFn)
    this.baseUrl = (options.baseUrl ?? 'https://identitytoolkit.googleapis.com/v1').replace(/\/$/, '')
  }

  async getUser(uid: string): Promise<AuthUserRecordLike> {
    const accessToken = await this.tokenProvider.getAccessToken()
    const url = `${this.baseUrl}/projects/${encodeURIComponent(this.projectId)}/accounts:lookup`
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [uid] }),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.tokenProvider.invalidateAccessToken()
      }
      throw new Error(`Identity Toolkit user lookup failed (${response.status}).`)
    }

    const payload = (await response.json()) as {
      users?: Array<{
        localId?: unknown
        disabled?: unknown
        email?: unknown
        emailVerified?: unknown
      }>
    }
    const user = payload.users?.find((candidate) => candidate.localId === uid) ?? payload.users?.[0]
    if (!user || user.localId !== uid) {
      throw new Error('Identity Toolkit user was not found.')
    }
    return {
      disabled: user.disabled === true,
      email: typeof user.email === 'string' ? user.email : null,
      emailVerified: user.emailVerified === true,
    }
  }
}
