/**
 * Request contexts for the rules suites.
 *
 * Every payload here is the shape the applications actually write — read off
 * `src/lib/firestoreBookings.ts` (web), `src/lib/chatCloud.ts`,
 * `src/lib/reviewsCloud.ts`, `lib/services/booking_lifecycle.dart` (Admin app)
 * and `lib/services/firestore_service.dart` — so a suite decision says something
 * about the app, not about an invented document.
 */
import type { DocData, RuleRequest, Store } from './engine'

export const ADMIN_EMAIL = 'haciendadeluisiana@gmail.com'
export const GUEST_UID = 'guest-uid-1'
export const OTHER_GUEST_UID = 'guest-uid-2'
export const ADMIN_UID = 'admin-uid-1'

/** Firebase's anonymous sign-in: a uid, and a token with no email claim. */
export const anonymousGuest = (uid = GUEST_UID) => ({ uid, token: { firebase: { sign_in_provider: 'anonymous' } } })
/** A Guest who signed up with an email address. */
export const emailGuest = (uid = GUEST_UID, email = 'guest@example.com') => ({
  uid,
  token: { email, email_verified: true, firebase: { sign_in_provider: 'password' } },
})
/** The bootstrap Admin: allowlisted address, no Profile needed. */
export const allowlistedAdmin = (uid = ADMIN_UID) => ({
  uid,
  token: { email: ADMIN_EMAIL, email_verified: true, firebase: { sign_in_provider: 'password' } },
})
/** An Admin promoted by a Profile rather than the allowlist. */
export const promotedAdmin = (uid = 'promoted-admin-1') => ({
  uid,
  token: { email: 'staff@example.com', firebase: { sign_in_provider: 'password' } },
})

export const BOOKING_ID = 'booking-1'
export const CONVO_ID = 'convo-1'

/** A Booking as `cloudBookingsDB.add` writes it (web, after /book). */
export const bookingDoc = (overrides: DocData = {}): DocData => ({
  guest_name: 'Ana Reyes',
  phone: '09171234567',
  email: 'ana@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guests: 2,
  accommodation: 'Main House',
  special_requests: '',
  status: 'Pending',
  kyc_status: 'required',
  payment_status: 'unpaid',
  created_at: '2026-09-24T02:00:00.000Z',
  hold_expires_at: '2026-09-25T02:00:00.000Z',
  uid: GUEST_UID,
  ref_id: BOOKING_ID,
  source: 'web',
  ...overrides,
})

/** A Booking whose money the Admin has already verified: Reserved and marked. */
export const paidBookingDoc = (overrides: DocData = {}): DocData =>
  bookingDoc({
    status: 'Reserved',
    kyc_status: 'approved',
    payment_status: 'verified',
    amount_verified: 8500,
    payment_verified_at: '2026-09-24T03:00:00.000Z',
    payment_verified_by: ADMIN_UID,
    payment_proof_url: `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`,
    payment_reference: 'GCASH-123456',
    ...overrides,
  })

/** The self-serve patch of `cloudBookingsDB.transition` for a Guest upload. */
export const guestPaymentPatch = (overrides: DocData = {}): DocData => ({
  ...bookingDoc({ status: 'Payment Pending' }),
  payment_plan: 'Full Payment',
  payment_status: 'pending',
  payment_proof_url: 'https://storage.example/payments/guest-uid-1/booking-1/proof.jpg',
  amount_claimed: 8500,
  payment_reference: 'GCASH-123456',
  ocr_reference: 'GCASH-123456',
  ocr_amount: '8500',
  ...overrides,
})

/**
 * The Admin patch of `applyAdminAction(verifyPayment)` — the web's
 * `src/lib/booking/actions.ts` and the app's `booking_lifecycle.dart`, which
 * write the same four fields: the status money buys, the amount, the instant,
 * and the verifier. The rule layer refuses a `verified` document without them.
 */
export const adminVerifyPatch = (overrides: DocData = {}): DocData => ({
  ...guestPaymentPatch(),
  status: 'Reserved',
  payment_status: 'verified',
  amount_verified: 8500,
  payment_verified_at: '2026-09-24T03:00:00.000Z',
  payment_verified_by: ADMIN_UID,
  ...overrides,
})

export const conversationDoc = (overrides: DocData = {}): DocData => ({
  guest_uid: GUEST_UID,
  category: 'booking-inquiry',
  created_at: '2026-09-24T02:00:00.000Z',
  updated_at: '2026-09-24T02:00:00.000Z',
  last_message: 'Hello',
  unread_admin: 0,
  unread_guest: 0,
  ...overrides,
})

export const messageDoc = (uid = GUEST_UID, role = 'guest', overrides: DocData = {}): DocData => ({
  sender_uid: uid,
  sender_role: role,
  text: 'Is the Main House free on the 1st?',
  created_at: '2026-09-24T02:00:00.000Z',
  ...overrides,
})

export const reviewDoc = (overrides: DocData = {}): DocData => ({
  booking_id: BOOKING_ID,
  uid: GUEST_UID,
  stars: 5,
  text: 'Lovely stay.',
  created_at: '2026-10-05T02:00:00.000Z',
  ...overrides,
})

export const accessLogDoc = (overrides: DocData = {}): DocData => ({
  timestamp: '2026-10-01T09:00:00.000Z',
  uid: GUEST_UID,
  ref_id: BOOKING_ID,
  result: 'granted',
  reason: 'mobile-key',
  ...overrides,
})

/** A store whose `profiles/{uid}` documents decide roles. */
export function storeWith(profiles: Record<string, DocData | null>, extra: Store = {}): Store {
  const store: Store = { ...extra }
  for (const [uid, data] of Object.entries(profiles)) store[`profiles/${uid}`] = data
  return store
}

/** A request, with sensible defaults, so a test only states what it is about. */
export function request(partial: Partial<RuleRequest> & { path: string; method: RuleRequest['method'] }): RuleRequest {
  return { auth: null, resourceData: null, requestData: null, ...partial }
}
