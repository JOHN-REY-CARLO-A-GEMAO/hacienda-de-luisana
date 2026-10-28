/**
 * One email per inquiry, through Resend.
 * ----------------------------------------------------------------------------
 * The worker's whole output. What arrives in the Admin's inbox is built here,
 * field by field, from values the schema has already normalised — never by
 * spreading the request body, which would let a caller choose the `from`, the
 * recipient or the reply address.
 *
 * Two facts about Resend's free tier worth knowing before deploying (both in
 * README.md): `onboarding@resend.dev` works without a verified domain but only
 * delivers to the Resend account owner's own address, and a verified domain is
 * what lets `from` be `Website Inquiry <inquiries@haciendadeluisana.com>`.
 */
import type { Env } from './env'
import type { Inquiry } from './schema'

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'
export const RESEND_TIMEOUT_MS = 10_000

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not-configured' | 'rejected' | 'unavailable'; status?: number; detail?: string }

/**
 * The email body, as text.
 *
 * The client IP is included because the brief asks for it and an Admin reading a
 * suspicious inquiry benefits from it. It is personal data on its way to a third
 * party, so it is one line to delete if that trade is ever the wrong way round.
 */
export function inquiryText(inquiry: Inquiry, meta: { ip: string; receivedAt: string }): string {
  return [
    'A new inquiry was sent from the website.',
    '',
    `Name:     ${inquiry.name}`,
    `Email:    ${inquiry.email}`,
    ...(inquiry.phone ? [`Phone:    ${inquiry.phone}`] : []),
    ...(inquiry.subject ? [`Subject:  ${inquiry.subject}`] : []),
    `IP:       ${meta.ip}`,
    `Received: ${meta.receivedAt}`,
    '',
    'Message',
    '-------',
    inquiry.message,
    '',
    'Reply to this email to answer the Guest directly.',
  ].join('\n')
}

/** The payload Resend's API expects, from validated values only. */
export function inquiryPayload(env: Env, inquiry: Inquiry, meta: { ip: string; receivedAt: string }) {
  const to = (env.NOTIFICATION_EMAIL ?? '').trim()
  return {
    from: (env.FROM_EMAIL ?? '').trim() || 'Website Inquiry <onboarding@resend.dev>',
    to: [to],
    reply_to: inquiry.email,
    subject: `New Inquiry from ${inquiry.name}`,
    text: inquiryText(inquiry, meta),
  }
}

/**
 * Send it.
 *
 * A 2xx with no `id` is treated as a failure: the form's promise is that the
 * Hacienda received the inquiry, and "Resend said 200" is not that promise being
 * kept if nothing was queued. A non-2xx is reported by *status*, never by echoing
 * Resend's body — that body can carry the recipient address, and it is not
 * something a Guest should see.
 */
export async function sendInquiry(
  env: Env,
  inquiry: Inquiry,
  meta: { ip: string; receivedAt: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SendResult> {
  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const to = (env.NOTIFICATION_EMAIL ?? '').trim()
  if (apiKey === '' || to === '') return { ok: false, reason: 'not-configured' }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inquiryPayload(env, inquiry, meta)),
      signal: AbortSignal.timeout(options.timeoutMs ?? RESEND_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, reason: 'unavailable', detail: error instanceof Error ? error.name : 'network-error' }
  }

  if (!response.ok) return { ok: false, reason: 'rejected', status: response.status }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const id = payload && typeof payload === 'object' ? (payload as { id?: unknown }).id : undefined
  return typeof id === 'string' && id !== '' ? { ok: true, id } : { ok: false, reason: 'rejected', status: response.status, detail: 'no-id' }
}
