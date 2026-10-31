/**
 * Trusted server-side Admin push notification pipeline (Firebase Cloud Messaging).
 *
 * Security & privacy invariants:
 *   1. Triggered exclusively from verified domain writes (`bookings`,
 *      `conversations/{id}/messages`, `access_logs`) — NEVER from the client-
 *      writable `notifications` collection (`user_id == 'admin'` is untrusted).
 *   2. Every target token in `admin_device_tokens` is re-validated against
 *      Firebase Auth (`!disabled`, verified bootstrap email) or `profiles/{uid}`
 *      (`role === 'admin'`) before any push is sent. Demoted, disabled, stale,
 *      or FCM-rejected tokens are pruned automatically.
 *   3. Payloads carry opaque identifiers (`booking_id`, `conversation_id`,
 *      `event_id`) and concise generic copy only — never guest names, emails,
 *      phone numbers, peso figures, payment proof URLs, references, message
 *      bodies, or RFID card UIDs. Never log raw FCM tokens.
 *   4. At-least-once trigger delivery is deduplicated transactionally through
 *      the server-only `notification_dispatches/{dispatchId}` ledger.
 *   5. Delivery failures are isolated and caught so notification transport can
 *      never break or roll back any booking workflow.
 */

import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging'
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { createHash } from 'node:crypto'
import { normalizeStatus } from './booking/statuses'
import { MinuteBudget } from './pricing'
import { spendCallableQuota } from './rateLimit'

const REGION = 'asia-southeast1'
const TRIGGER_REGION = process.env.FIRESTORE_TRIGGER_REGION?.trim() || REGION

const callableOptions = {
  region: REGION,
  maxInstances: 5,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
}

const triggerOptions = {
  region: TRIGGER_REGION,
  maxInstances: 5,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
}

export const ADMIN_DEVICE_TOKENS_COLLECTION = 'admin_device_tokens'
export const NOTIFICATION_DISPATCHES_COLLECTION = 'notification_dispatches'
export const NOTIFICATION_CONTRACT_VERSION = '1'
export const ANDROID_NOTIFICATION_ICON = 'ic_stat_notification'

export const ANDROID_CHANNELS = {
  bookings: 'hdl_admin_bookings',
  payments: 'hdl_admin_payments',
  messages: 'hdl_admin_messages',
  security: 'hdl_admin_security',
} as const

export type AndroidChannelId = (typeof ANDROID_CHANNELS)[keyof typeof ANDROID_CHANNELS]

export type AdminPushEventType =
  | 'booking_submitted'
  | 'payment_proof_submitted'
  | 'guest_message'
  | 'guest_cancellation'
  | 'reschedule_request'
  | 'booking_status_changed'
  | 'smart_lock_security'

export type AdminPushTarget =
  | 'booking_detail'
  | 'payment_queue'
  | 'refund_queue'
  | 'chat_thread'
  | 'smart_lock'
  | 'notifications'

export interface AdminPushEvent {
  eventId: string
  type: AdminPushEventType
  channelId: AndroidChannelId
  target: AdminPushTarget
  title: string
  body: string
  bookingId?: string
  conversationId?: string
  guestUid?: string
  accommodation?: string
}

// Keep in sync with functions/src/quotes.ts, firestore.rules adminEmails(),
// storage.rules, database.rules.json, src/config/admin-roles.json, and
// lib/services/auth_store.dart kAdminEmails.
const bootstrapAdminEmails = ['gemaojohnreyarguilles@gmail.com']

const CANONICAL_ACCOMMODATIONS = new Set(['main-house', 'annex', 'house-a-camping'])
const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_CONVO_ID = /^[A-Za-z0-9_:-]{1,160}$/
// Bounded to 1,024 ASCII bytes so `where('token', '==', ...)` always stays well
// below Firestore's 1,500-byte single-field index limit.
const SAFE_FCM_TOKEN = /^[\x21-\x7E]{20,1024}$/

const IMPORTANT_STATUSES = new Set([
  'Approved',
  'Rejected',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Checked-In',
  'Staying',
  'Checked-Out',
  'Completed',
  'Cancelled',
  'Expired',
])

const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
])

const SENDING_LEASE_MS = 2 * 60_000
const MULTICAST_BATCH_SIZE = 500

const tokenStaleMs = (): number => {
  const days = Number(process.env.FCM_TOKEN_STALE_DAYS ?? 60)
  const validDays = Number.isFinite(days) && days >= 1 && days <= 365 ? days : 60
  return validDays * 86_400_000
}

let firestoreInstance: ReturnType<typeof getFirestore> | null = null
const db = () => (firestoreInstance ??= getFirestore())

let authInstance: ReturnType<typeof getAuth> | null = null
const auth = () => (authInstance ??= getAuth())

let messagingInstance: ReturnType<typeof getMessaging> | null = null
const messaging = () => (messagingInstance ??= getMessaging())

const registerBudget = new MinuteBudget(20)
const unregisterBudget = new MinuteBudget(20)

/** Test seam to reset in-memory rate limits and cached SDK singletons. */
export function resetNotificationStateForTests(): void {
  registerBudget.reset()
  unregisterBudget.reset()
  firestoreInstance = null
  authInstance = null
  messagingInstance = null
}

/** Deterministic `${uid}:${sha256_32}` document ID for an Admin device registration. */
export function adminDeviceTokenDocId(uid: string, token: string): string {
  const cleanUid = uid.trim()
  const digest = createHash('sha256')
    .update(`${cleanUid}:${token.trim()}`)
    .digest('hex')
    .slice(0, 32)
  return `${cleanUid}:${digest}`
}

/** Deterministic document ID for the server-only idempotency ledger. */
export function dispatchDocId(eventId: string): string {
  return createHash('sha256').update(eventId).digest('hex').slice(0, 40)
}

/** Short non-reversible fingerprint safe for operational logs (never logs raw token). */
export function redactTokenForLog(token: string): string {
  return `fcm:${createHash('sha256').update(token).digest('hex').slice(0, 10)}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function isSafeDocId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_DOC_ID.test(value)
}

function isSafeConvoId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CONVO_ID.test(value)
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function canonicalAccommodation(value: unknown): string | undefined {
  const trimmed = trimmedString(value)
  return CANONICAL_ACCOMMODATIONS.has(trimmed) ? trimmed : undefined
}

function timestampToMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown }
    if (typeof candidate.toMillis === 'function') {
      const ms = candidate.toMillis()
      if (Number.isFinite(ms)) return ms
    }
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate()
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.getTime()
    }
    if (typeof candidate.seconds === 'number' && Number.isFinite(candidate.seconds)) {
      return candidate.seconds * 1000
    }
  }
  return null
}

function dateOnly(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 10)
  const ms = timestampToMillis(value)
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10)
}

/**
 * Authoritative server-side Admin check.
 *
 * Requires an active (non-disabled) Firebase Auth user whose verified email is
 * on the bootstrap allowlist OR whose `profiles/{uid}` document carries
 * `role === 'admin'`. Never trusts client claims or `user_id: 'admin'`.
 */
export async function isVerifiedAdmin(uid: string): Promise<boolean> {
  if (!isSafeDocId(uid)) return false
  try {
    const [user, profileSnap] = await Promise.all([
      auth().getUser(uid),
      db().doc(`profiles/${uid}`).get(),
    ])
    if (!user || user.disabled) return false
    const email = (user.email || '').trim().toLowerCase()
    if (user.emailVerified && bootstrapAdminEmails.includes(email)) {
      return true
    }
    return profileSnap.data()?.role === 'admin'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Device-token registration contract (callables)
// ---------------------------------------------------------------------------

export interface TokenRegistrationInput {
  token: string
  platform: 'android' | 'ios'
  previousToken?: string
  appVersion?: string
}

export function parseTokenRegistrationInput(
  raw: unknown,
  callerUid: string,
): TokenRegistrationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'A device token payload is required.')
  }
  const input = raw as Record<string, unknown>

  if (input.uid !== undefined && input.uid !== callerUid) {
    throw new HttpsError(
      'permission-denied',
      'Cannot register a device token for another account.',
    )
  }

  const token = trimmedString(input.token)
  if (!SAFE_FCM_TOKEN.test(token)) {
    throw new HttpsError('invalid-argument', 'A valid FCM registration token is required.')
  }

  const platform = trimmedString(input.platform).toLowerCase()
  if (platform !== 'android' && platform !== 'ios') {
    throw new HttpsError('invalid-argument', 'Platform must be android or ios.')
  }

  const previousRaw = trimmedString(input.previousToken ?? input.previous_token)
  const previousToken =
    previousRaw && SAFE_FCM_TOKEN.test(previousRaw) && previousRaw !== token
      ? previousRaw
      : undefined

  const appVersionRaw = trimmedString(input.appVersion ?? input.app_version)
  if (appVersionRaw.length > 64) {
    throw new HttpsError('invalid-argument', 'App version is too long.')
  }

  return {
    token,
    platform,
    ...(previousToken ? { previousToken } : {}),
    ...(appVersionRaw ? { appVersion: appVersionRaw } : {}),
  }
}

export const registerAdminDeviceToken = onCall(
  callableOptions,
  async (request: CallableRequest) => {
    const callerUid = request.auth?.uid ?? ''
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in as an Admin to register push alerts.')
    }

    const parsed = parseTokenRegistrationInput(request.data, callerUid)

    if (!(await isVerifiedAdmin(callerUid))) {
      throw new HttpsError(
        'permission-denied',
        'Only verified Admin accounts may register device tokens.',
      )
    }

    await spendCallableQuota({
      firestore: db(),
      budget: registerBudget,
      scope: 'registerAdminDeviceToken',
      key: callerUid,
      limit: 20,
      label: 'device token registration',
    })

    const tokenId = adminDeviceTokenDocId(callerUid, parsed.token)
    const tokenRef = db().doc(`${ADMIN_DEVICE_TOKENS_COLLECTION}/${tokenId}`)

    // Remove rotated token for this Admin, plus any stale association of the
    // same physical FCM token under a prior account on the same device.
    const sameTokenSnap = await db()
      .collection(ADMIN_DEVICE_TOKENS_COLLECTION)
      .where('token', '==', parsed.token)
      .get()

    const staleDeletions: Promise<unknown>[] = []
    for (const docSnap of sameTokenSnap.docs) {
      if (docSnap.id !== tokenId) {
        staleDeletions.push(docSnap.ref.delete().catch(() => undefined))
      }
    }
    if (parsed.previousToken) {
      const prevId = adminDeviceTokenDocId(callerUid, parsed.previousToken)
      if (prevId !== tokenId) {
        staleDeletions.push(
          db()
            .doc(`${ADMIN_DEVICE_TOKENS_COLLECTION}/${prevId}`)
            .delete()
            .catch(() => undefined),
        )
      }
    }
    if (staleDeletions.length > 0) {
      await Promise.all(staleDeletions)
    }

    await db().runTransaction(async (tx) => {
      const existing = await tx.get(tokenRef)
      const now = FieldValue.serverTimestamp()
      const payload: Record<string, unknown> = {
        uid: callerUid,
        token: parsed.token,
        platform: parsed.platform,
        enabled: true,
        ...(parsed.appVersion ? { app_version: parsed.appVersion } : {}),
        created_at: existing.exists ? (existing.data()?.created_at ?? now) : now,
        updated_at: now,
        last_seen_at: now,
      }
      tx.set(tokenRef, payload)
    })

    return { registered: true, token_id: tokenId }
  },
)

export const unregisterAdminDeviceToken = onCall(
  callableOptions,
  async (request: CallableRequest) => {
    const callerUid = request.auth?.uid ?? ''
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in to unregister a device token.')
    }

    if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
      throw new HttpsError('invalid-argument', 'A device token payload is required.')
    }
    const input = request.data as Record<string, unknown>
    if (input.uid !== undefined && input.uid !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'Cannot unregister a device token for another account.',
      )
    }

    const token = trimmedString(input.token)
    if (!SAFE_FCM_TOKEN.test(token)) {
      throw new HttpsError('invalid-argument', 'A valid FCM registration token is required.')
    }

    await spendCallableQuota({
      firestore: db(),
      budget: unregisterBudget,
      scope: 'unregisterAdminDeviceToken',
      key: callerUid,
      limit: 20,
      label: 'device token removal',
    })

    const tokenId = adminDeviceTokenDocId(callerUid, token)
    const tokenRef = db().doc(`${ADMIN_DEVICE_TOKENS_COLLECTION}/${tokenId}`)
    const snap = await tokenRef.get()
    if (snap.exists && snap.data()?.uid === callerUid) {
      await tokenRef.delete()
      return { unregistered: true, removed: true, token_id: tokenId }
    }

    if (!(await isVerifiedAdmin(callerUid))) {
      throw new HttpsError(
        'permission-denied',
        'Only verified Admin accounts may unregister device tokens.',
      )
    }

    return { unregistered: true, removed: false, token_id: tokenId }
  },
)

// ---------------------------------------------------------------------------
// Pure event evaluators (deterministic, PII-free)
// ---------------------------------------------------------------------------

export function buildFcmDataPayload(
  event: AdminPushEvent,
  sentAtIso: string,
): Record<string, string> {
  const data: Record<string, string> = {
    v: NOTIFICATION_CONTRACT_VERSION,
    event_id: event.eventId,
    type: event.type,
    channel_id: event.channelId,
    target: event.target,
    title: event.title,
    body: event.body,
    sent_at: sentAtIso,
  }
  if (event.bookingId && isSafeDocId(event.bookingId)) {
    data.booking_id = event.bookingId
  }
  if (event.conversationId && isSafeConvoId(event.conversationId)) {
    data.conversation_id = event.conversationId
  }
  if (event.guestUid && isSafeDocId(event.guestUid)) {
    data.guest_uid = event.guestUid
  }
  if (event.accommodation && CANONICAL_ACCOMMODATIONS.has(event.accommodation)) {
    data.accommodation = event.accommodation
  }
  return data
}

export function evaluateBookingCreated(
  bookingId: string,
  data: Record<string, unknown> | undefined,
): AdminPushEvent | null {
  if (!isSafeDocId(bookingId) || !data) return null
  const status = normalizeStatus(trimmedString(data.status || 'Pending'))
  if (status !== 'Pending') return null

  const proof = trimmedString(data.payment_proof_url ?? data.paymentProofUrl)
  const accommodation = canonicalAccommodation(data.accommodation)

  return {
    eventId: `booking_submitted:${bookingId}`,
    type: 'booking_submitted',
    channelId: ANDROID_CHANNELS.bookings,
    target: 'booking_detail',
    bookingId,
    ...(accommodation ? { accommodation } : {}),
    title: 'New booking submitted',
    body: proof
      ? 'A new booking request with payment proof is awaiting review.'
      : 'A new booking request is awaiting review.',
  }
}

function pendingRequestSignature(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const req = raw as Record<string, unknown>
  if (trimmedString(req.status).toLowerCase() !== 'pending') return null
  return JSON.stringify({
    status: 'pending',
    hours: req.hours ?? null,
    check_in: req.check_in ?? req.new_check_in ?? null,
    check_out: req.check_out ?? req.new_check_out ?? null,
    requested_at: req.requested_at ?? null,
  })
}

export interface BookingUpdateContext {
  /** Whether the latest Cancel entry in `bookings/{id}/activity` was written by an Admin. */
  cancelledByAdmin?: boolean
}

export function evaluateBookingUpdated(
  bookingId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  context: BookingUpdateContext = {},
): AdminPushEvent[] {
  if (!isSafeDocId(bookingId) || !before || !after) return []

  const events: AdminPushEvent[] = []
  const accommodation = canonicalAccommodation(after.accommodation)

  const beforeStatus = normalizeStatus(trimmedString(before.status || 'Pending'))
  const afterStatus = normalizeStatus(trimmedString(after.status || 'Pending'))

  const beforeProof = trimmedString(before.payment_proof_url ?? before.paymentProofUrl)
  const afterProof = trimmedString(after.payment_proof_url ?? after.paymentProofUrl)
  const beforePaymentStatus = trimmedString(before.payment_status).toLowerCase()
  const afterPaymentStatus = trimmedString(after.payment_status).toLowerCase()
  // Only an Admin (`RejectPaymentProof` with `guestResubmits: false`) can set
  // `payment_status: 'rejected'` while transitioning `status` to `'Cancelled'`.
  const adminRejectedProofToCancel =
    afterPaymentStatus === 'rejected' && beforePaymentStatus !== 'rejected'

  // 1. New / resubmitted payment proof on an existing booking.
  if (afterProof !== '' && afterProof !== beforeProof && afterPaymentStatus === 'pending') {
    events.push({
      eventId: `payment_proof_submitted:${bookingId}:${shortHash(afterProof)}`,
      type: 'payment_proof_submitted',
      channelId: ANDROID_CHANNELS.payments,
      target: 'payment_queue',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: 'New payment proof submitted',
      body: 'A payment proof was uploaded and is ready for verification.',
    })
  }

  // 2. Structured pending cancellation request (if present) or Guest cancellation transition.
  const beforeCancelReq = pendingRequestSignature(before.cancellation_request)
  const afterCancelReq = pendingRequestSignature(after.cancellation_request)
  let handledCancellationTransition = false

  if (afterCancelReq !== null && afterCancelReq !== beforeCancelReq) {
    events.push({
      eventId: `guest_cancellation:${bookingId}:req_${shortHash(afterCancelReq)}`,
      type: 'guest_cancellation',
      channelId: ANDROID_CHANNELS.bookings,
      target: 'booking_detail',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: 'Cancellation request received',
      body: 'A Guest requested cancellation on an active booking.',
    })
  } else if (
    beforeStatus !== 'Cancelled' &&
    afterStatus === 'Cancelled' &&
    !context.cancelledByAdmin &&
    !adminRejectedProofToCancel
  ) {
    handledCancellationTransition = true
    const refundInitiated = trimmedString(after.refund_status).toLowerCase() === 'initiated'
    events.push({
      eventId: `guest_cancellation:${bookingId}`,
      type: 'guest_cancellation',
      channelId: refundInitiated ? ANDROID_CHANNELS.payments : ANDROID_CHANNELS.bookings,
      target: refundInitiated ? 'refund_queue' : 'booking_detail',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: refundInitiated
        ? 'Guest cancelled — refund pending'
        : 'Guest cancelled booking',
      body: refundInitiated
        ? 'A Guest cancelled a booking and a refund is waiting for review.'
        : 'A booking was cancelled by the Guest.',
    })
  }

  // 3. Guest reschedule request or stay-extension (late checkout) request.
  const beforeReschedReq = pendingRequestSignature(before.reschedule_request)
  const afterReschedReq = pendingRequestSignature(after.reschedule_request)
  if (afterReschedReq !== null && afterReschedReq !== beforeReschedReq) {
    events.push({
      eventId: `reschedule_request:${bookingId}:${shortHash(afterReschedReq)}`,
      type: 'reschedule_request',
      channelId: ANDROID_CHANNELS.bookings,
      target: 'booking_detail',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: 'Reschedule request received',
      body: 'A Guest requested new stay dates for an existing booking.',
    })
  }

  const beforeLateReq = pendingRequestSignature(before.late_checkout_request)
  const afterLateReq = pendingRequestSignature(after.late_checkout_request)
  if (afterLateReq !== null && afterLateReq !== beforeLateReq) {
    events.push({
      eventId: `reschedule_request:${bookingId}:late_${shortHash(afterLateReq)}`,
      type: 'reschedule_request',
      channelId: ANDROID_CHANNELS.bookings,
      target: 'booking_detail',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: 'Late checkout requested',
      body: 'A Guest requested a checkout extension that needs review.',
    })
  }

  // 4. Important booking status, schedule, or refund state changes.
  if (
    beforeStatus !== afterStatus &&
    IMPORTANT_STATUSES.has(afterStatus) &&
    !handledCancellationTransition
  ) {
    const refundInitiated =
      afterStatus === 'Cancelled' &&
      trimmedString(after.refund_status).toLowerCase() === 'initiated'
    events.push({
      eventId: `booking_status_changed:${bookingId}:${afterStatus}`,
      type: 'booking_status_changed',
      channelId: refundInitiated ? ANDROID_CHANNELS.payments : ANDROID_CHANNELS.bookings,
      target: refundInitiated ? 'refund_queue' : 'booking_detail',
      bookingId,
      ...(accommodation ? { accommodation } : {}),
      title: refundInitiated
        ? 'Booking cancelled — refund pending'
        : `Booking ${afterStatus}`,
      body: refundInitiated
        ? 'Booking was cancelled and has a pending refund to settle.'
        : `Booking status changed to ${afterStatus}.`,
    })
  } else {
    const beforeRefund = trimmedString(before.refund_status).toLowerCase()
    const afterRefund = trimmedString(after.refund_status).toLowerCase()
    if (beforeRefund !== afterRefund && afterRefund === 'initiated' && !handledCancellationTransition) {
      events.push({
        eventId: `booking_status_changed:${bookingId}:refund_initiated`,
        type: 'booking_status_changed',
        channelId: ANDROID_CHANNELS.payments,
        target: 'refund_queue',
        bookingId,
        ...(accommodation ? { accommodation } : {}),
        title: 'Refund processing pending',
        body: 'A booking refund is waiting for manual settlement.',
      })
    }

    const beforeIn = dateOnly(before.check_in)
    const afterIn = dateOnly(after.check_in)
    const beforeOut = dateOnly(before.check_out)
    const afterOut = dateOnly(after.check_out)
    const terminal = new Set(['Rejected', 'Cancelled', 'Completed', 'Expired'])
    if (
      !terminal.has(afterStatus) &&
      afterIn !== '' &&
      afterOut !== '' &&
      (beforeIn !== afterIn || beforeOut !== afterOut)
    ) {
      events.push({
        eventId: `booking_status_changed:${bookingId}:dates_${afterIn}_${afterOut}`,
        type: 'booking_status_changed',
        channelId: ANDROID_CHANNELS.bookings,
        target: 'booking_detail',
        bookingId,
        ...(accommodation ? { accommodation } : {}),
        title: 'Booking dates rescheduled',
        body: 'Stay dates were updated on an active booking.',
      })
    }
  }

  return events
}

export function bookingIdFromConversationId(convoId: string): string | undefined {
  if (!convoId.startsWith('booking-')) return undefined
  const candidate = convoId.slice('booking-'.length)
  return isSafeDocId(candidate) ? candidate : undefined
}

export function evaluateGuestMessageCreated(
  convoId: string,
  messageId: string,
  messageData: Record<string, unknown> | undefined,
  conversationData?: Record<string, unknown> | null,
): AdminPushEvent | null {
  if (!isSafeConvoId(convoId) || !isSafeDocId(messageId) || !messageData) return null

  const senderRole = trimmedString(messageData.sender_role).toLowerCase()
  const senderUid = trimmedString(messageData.sender_uid)
  if (senderRole !== 'guest' || !isSafeDocId(senderUid)) return null

  // If the parent conversation exists and names a different guest_uid, refuse.
  if (conversationData) {
    const ownerUid = trimmedString(conversationData.guest_uid)
    if (ownerUid && ownerUid !== senderUid) return null
  }

  const text = trimmedString(messageData.text)
  const hasAttachment = Boolean(
    messageData.attachment && typeof messageData.attachment === 'object',
  )
  if (!text && !hasAttachment) return null

  const explicitBookingId = conversationData
    ? trimmedString(conversationData.booking_id)
    : ''
  const bookingId = isSafeDocId(explicitBookingId)
    ? explicitBookingId
    : bookingIdFromConversationId(convoId)

  return {
    eventId: `guest_message:${convoId}:${messageId}`,
    type: 'guest_message',
    channelId: ANDROID_CHANNELS.messages,
    target: 'chat_thread',
    conversationId: convoId,
    guestUid: senderUid,
    ...(bookingId ? { bookingId } : {}),
    title: 'New guest message',
    body: hasAttachment && !text
      ? 'A Guest sent an image attachment in chat.'
      : 'A Guest sent a new message.',
  }
}

export function evaluateAccessLogCreated(
  logId: string,
  data: Record<string, unknown> | undefined,
): AdminPushEvent | null {
  if (!isSafeDocId(logId) || !data) return null

  const result = trimmedString(data.result).toLowerCase()
  const action = trimmedString(data.action).toLowerCase()
  const explicitFailure = data.isSuccess === false || data.success === false
  const isDenied = result === 'denied' || action === 'denied' || explicitFailure
  const isMasterOverride =
    action === 'master_override' || action === 'masteroverride' || action === 'master'

  if (!isDenied && !isMasterOverride) return null

  const simulated = data.simulated === true

  return {
    eventId: `smart_lock_security:${logId}`,
    type: 'smart_lock_security',
    channelId: ANDROID_CHANNELS.security,
    target: 'smart_lock',
    title: isDenied ? 'Smart lock access denied' : 'Smart lock master override',
    body: simulated
      ? 'A simulated smart-lock security event was recorded.'
      : isDenied
        ? 'An unauthorized door access attempt was recorded.'
        : 'A physical or master override event was recorded.',
  }
}

// ---------------------------------------------------------------------------
// Idempotent multicast dispatcher & token hygiene
// ---------------------------------------------------------------------------

interface CandidateTokenDoc {
  docId: string
  uid: string
  token: string
  lastSeenMs: number
}

/**
 * Claims an event ID in `notification_dispatches/{dispatchId}` so duplicate
 * Cloud Function trigger invocations never emit duplicate FCM pushes.
 */
async function claimEventDispatch(event: AdminPushEvent, nowMs: number): Promise<boolean> {
  const id = dispatchDocId(event.eventId)
  const ref = db().doc(`${NOTIFICATION_DISPATCHES_COLLECTION}/${id}`)

  return db().runTransaction(async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists) {
      const data = existing.data() ?? {}
      const status = trimmedString(data.status)
      const claimedAtMs = typeof data.claimed_at_ms === 'number' ? data.claimed_at_ms : 0
      if (status === 'sent' || status === 'no_recipients') {
        return false
      }
      if (status === 'sending' && nowMs - claimedAtMs < SENDING_LEASE_MS) {
        return false
      }
    }

    tx.set(ref, {
      event_id: event.eventId,
      type: event.type,
      target: event.target,
      status: 'sending',
      claimed_at_ms: nowMs,
      updated_at: FieldValue.serverTimestamp(),
    })
    return true
  })
}

async function finalizeEventDispatch(
  eventId: string,
  status: 'sent' | 'no_recipients' | 'failed',
  sentCount: number,
  failedCount: number,
): Promise<void> {
  const id = dispatchDocId(eventId)
  await db()
    .doc(`${NOTIFICATION_DISPATCHES_COLLECTION}/${id}`)
    .set(
      {
        event_id: eventId,
        status,
        sent_count: sentCount,
        failed_count: failedCount,
        completed_at_ms: Date.now(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
}

/**
 * Loads active Admin device tokens, pruning stale entries and tokens belonging
 * to demoted or disabled accounts before any message leaves the server.
 */
async function loadAuthorizedAdminTokens(nowMs: number): Promise<CandidateTokenDoc[]> {
  const snap = await db()
    .collection(ADMIN_DEVICE_TOKENS_COLLECTION)
    .where('enabled', '==', true)
    .get()

  if (snap.empty) return []

  const staleCutoffMs = nowMs - tokenStaleMs()
  const staleDocIds: string[] = []
  const rawDocs: CandidateTokenDoc[] = []
  const uniqueUids = new Set<string>()

  for (const docSnap of snap.docs) {
    const data = docSnap.data() ?? {}
    const uid = trimmedString(data.uid)
    const token = trimmedString(data.token)
    const lastSeenMs =
      timestampToMillis(data.last_seen_at) ??
      timestampToMillis(data.updated_at) ??
      timestampToMillis(data.created_at) ??
      nowMs

    if (!isSafeDocId(uid) || !SAFE_FCM_TOKEN.test(token) || lastSeenMs < staleCutoffMs) {
      staleDocIds.push(docSnap.id)
      continue
    }

    uniqueUids.add(uid)
    rawDocs.push({ docId: docSnap.id, uid, token, lastSeenMs })
  }

  // Verify every distinct UID is still an active Admin right now.
  const adminVerdicts = new Map<string, boolean>()
  await Promise.all(
    [...uniqueUids].map(async (uid) => {
      adminVerdicts.set(uid, await isVerifiedAdmin(uid))
    }),
  )

  // Deduplicate by physical FCM token, keeping the freshest record.
  const byToken = new Map<string, CandidateTokenDoc>()
  for (const entry of rawDocs) {
    if (!adminVerdicts.get(entry.uid)) {
      staleDocIds.push(entry.docId)
      continue
    }
    const prior = byToken.get(entry.token)
    if (!prior) {
      byToken.set(entry.token, entry)
    } else if (entry.lastSeenMs > prior.lastSeenMs) {
      staleDocIds.push(prior.docId)
      byToken.set(entry.token, entry)
    } else {
      staleDocIds.push(entry.docId)
    }
  }

  if (staleDocIds.length > 0) {
    await Promise.all(
      staleDocIds.map((id) =>
        db()
          .doc(`${ADMIN_DEVICE_TOKENS_COLLECTION}/${id}`)
          .delete()
          .catch(() => undefined),
      ),
    )
  }

  return [...byToken.values()]
}

export interface DispatchOutcome {
  status: 'duplicate' | 'no_recipients' | 'sent' | 'failed'
  sentCount: number
  failedCount: number
  prunedCount: number
}

export async function dispatchAdminPush(
  event: AdminPushEvent,
  options: { nowMs?: number } = {},
): Promise<DispatchOutcome> {
  const nowMs = options.nowMs ?? Date.now()
  try {
    const claimed = await claimEventDispatch(event, nowMs)
    if (!claimed) {
      return { status: 'duplicate', sentCount: 0, failedCount: 0, prunedCount: 0 }
    }

    const recipients = await loadAuthorizedAdminTokens(nowMs)
    if (recipients.length === 0) {
      await finalizeEventDispatch(event.eventId, 'no_recipients', 0, 0)
      return { status: 'no_recipients', sentCount: 0, failedCount: 0, prunedCount: 0 }
    }

    const sentAtIso = new Date(nowMs).toISOString()
    const dataPayload = buildFcmDataPayload(event, sentAtIso)
    const notificationTag = `hdl:${shortHash(event.eventId)}`

    let sentCount = 0
    let failedCount = 0
    const invalidDocIds: string[] = []

    for (let offset = 0; offset < recipients.length; offset += MULTICAST_BATCH_SIZE) {
      const batch = recipients.slice(offset, offset + MULTICAST_BATCH_SIZE)
      let response: BatchResponse
      try {
        response = await messaging().sendEachForMulticast({
          tokens: batch.map((r) => r.token),
          notification: {
            title: event.title,
            body: event.body,
          },
          data: dataPayload,
          android: {
            priority: 'high',
            notification: {
              channelId: event.channelId,
              icon: ANDROID_NOTIFICATION_ICON,
              tag: notificationTag,
              priority: 'high',
              visibility: 'private',
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
              'apns-collapse-id': notificationTag,
            },
            payload: {
              aps: {
                sound: 'default',
              },
            },
          },
        })
      } catch (batchErr) {
        failedCount += batch.length
        console.error(
          `[notifications] multicast batch failed for ${event.type} (${shortHash(event.eventId)}):`,
          batchErr instanceof Error ? batchErr.message : String(batchErr),
        )
        continue
      }

      response.responses.forEach((res, idx) => {
        if (res.success) {
          sentCount += 1
          return
        }
        failedCount += 1
        const code = res.error?.code ?? 'unknown'
        const target = batch[idx]
        if (!target) return
        if (PERMANENT_TOKEN_ERROR_CODES.has(code)) {
          invalidDocIds.push(target.docId)
        } else {
          console.warn(
            `[notifications] transient FCM error (${code}) for ${redactTokenForLog(target.token)}`,
          )
        }
      })
    }

    if (invalidDocIds.length > 0) {
      await Promise.all(
        invalidDocIds.map((docId) =>
          db()
            .doc(`${ADMIN_DEVICE_TOKENS_COLLECTION}/${docId}`)
            .delete()
            .catch(() => undefined),
        ),
      )
    }

    const finalStatus = sentCount > 0 || invalidDocIds.length === recipients.length ? 'sent' : 'failed'
    await finalizeEventDispatch(event.eventId, finalStatus, sentCount, failedCount)
    return {
      status: finalStatus,
      sentCount,
      failedCount,
      prunedCount: invalidDocIds.length,
    }
  } catch (err) {
    console.error(
      `[notifications] dispatch failed safely for ${event.type}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { status: 'failed', sentCount: 0, failedCount: 0, prunedCount: 0 }
  }
}

async function wasCancelledByAdmin(bookingId: string): Promise<boolean> {
  try {
    const snap = await db().collection(`bookings/${bookingId}/activity`).get()
    if (snap.empty) return false
    let highestSeq = -1
    let latestCancelActor = ''
    for (const docSnap of snap.docs) {
      const data = docSnap.data() ?? {}
      const action = trimmedString(data.action)
      if (action !== 'Cancel' && action !== 'RejectPaymentProof') continue
      const seq = typeof data.seq === 'number' ? data.seq : 0
      if (seq >= highestSeq) {
        highestSeq = seq
        latestCancelActor = trimmedString(data.actor).toLowerCase()
      }
    }
    return latestCancelActor === 'admin'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Cloud Functions v2 Firestore Triggers
// ---------------------------------------------------------------------------

export const onBookingCreatedNotifyAdmin = onDocumentCreated(
  { ...triggerOptions, document: 'bookings/{bookingId}' },
  async (event) => {
    try {
      const bookingId = event.params.bookingId
      const data = event.data?.data() as Record<string, unknown> | undefined
      const pushEvent = evaluateBookingCreated(bookingId, data)
      if (!pushEvent) return
      await dispatchAdminPush(pushEvent)
    } catch (err) {
      console.error(
        '[notifications] onBookingCreatedNotifyAdmin error:',
        err instanceof Error ? err.message : String(err),
      )
    }
  },
)

export const onBookingUpdatedNotifyAdmin = onDocumentUpdated(
  { ...triggerOptions, document: 'bookings/{bookingId}' },
  async (event) => {
    try {
      const bookingId = event.params.bookingId
      const before = event.data?.before.data() as Record<string, unknown> | undefined
      const after = event.data?.after.data() as Record<string, unknown> | undefined
      if (!before || !after) return

      const beforeStatus = normalizeStatus(trimmedString(before.status || 'Pending'))
      const afterStatus = normalizeStatus(trimmedString(after.status || 'Pending'))
      const cancelledByAdmin =
        beforeStatus !== 'Cancelled' && afterStatus === 'Cancelled'
          ? await wasCancelledByAdmin(bookingId)
          : false

      const pushEvents = evaluateBookingUpdated(bookingId, before, after, {
        cancelledByAdmin,
      })
      for (const pushEvent of pushEvents) {
        await dispatchAdminPush(pushEvent)
      }
    } catch (err) {
      console.error(
        '[notifications] onBookingUpdatedNotifyAdmin error:',
        err instanceof Error ? err.message : String(err),
      )
    }
  },
)

export const onGuestMessageCreatedNotifyAdmin = onDocumentCreated(
  { ...triggerOptions, document: 'conversations/{convoId}/messages/{messageId}' },
  async (event) => {
    try {
      const { convoId, messageId } = event.params
      const messageData = event.data?.data() as Record<string, unknown> | undefined
      if (!messageData) return
      if (trimmedString(messageData.sender_role).toLowerCase() !== 'guest') return

      let convoData: Record<string, unknown> | null = null
      try {
        const convoSnap = await db().doc(`conversations/${convoId}`).get()
        convoData = convoSnap.exists ? (convoSnap.data() ?? null) : null
      } catch {
        convoData = null
      }

      const pushEvent = evaluateGuestMessageCreated(
        convoId,
        messageId,
        messageData,
        convoData,
      )
      if (!pushEvent) return
      await dispatchAdminPush(pushEvent)
    } catch (err) {
      console.error(
        '[notifications] onGuestMessageCreatedNotifyAdmin error:',
        err instanceof Error ? err.message : String(err),
      )
    }
  },
)

export const onAccessLogCreatedNotifyAdmin = onDocumentCreated(
  { ...triggerOptions, document: 'access_logs/{logId}' },
  async (event) => {
    try {
      const logId = event.params.logId
      const data = event.data?.data() as Record<string, unknown> | undefined
      const pushEvent = evaluateAccessLogCreated(logId, data)
      if (!pushEvent) return
      await dispatchAdminPush(pushEvent)
    } catch (err) {
      console.error(
        '[notifications] onAccessLogCreatedNotifyAdmin error:',
        err instanceof Error ? err.message : String(err),
      )
    }
  },
)
