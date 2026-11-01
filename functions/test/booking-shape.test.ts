/**
 * The OCR evidence boundary of `submitBooking` (NOT emulator verification).
 *
 * The website files what OCR read off the downpayment screenshot beside the
 * Guest's claim. Firestore rules do not run for the Admin-SDK write, so
 * `validateGuestBookingShape` is the only boundary between a browser and the
 * `ocr_*` fields the Admin app decides with: the evidence is admitted, bounded,
 * and the fields that are not evidence stay refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const Module = require('node:module');
const loader = Module._load;
const store = new Map<string, any>();
const clone = (x: any) => x === undefined ? undefined : structuredClone(x);
class Reference {
  id: string;
  constructor(readonly path: string) { this.id = path.split('/').at(-1)!; }
  async get() { return { ref: this, id: this.id, exists: store.has(this.path), data: () => clone(store.get(this.path)) }; }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async set(data: any) { store.set(this.path, clone(data)); }
}
class Query {
  constructor(readonly path: string) {}
  doc(id?: string) { return new Reference(`${this.path}/${id ?? 'generated'}`); }
  where() { return this; }
  orderBy() { return this; }
  limit() { return this; }
  async get() { return { docs: [], empty: true, size: 0 }; }
}
const database = {
  doc: (path: string) => new Reference(path),
  collection: (path: string) => new Query(path),
  runTransaction: async (fn: (tx: any) => any) => fn({
    get: async (ref: Reference) => ref.get(),
    set: (ref: Reference, data: any) => store.set(ref.path, clone(data)),
  }),
};
class FakeHttpsError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
Module._load = function(name: string, ...rest: any[]) {
  if (name === 'firebase-admin/app') return { initializeApp: () => {} };
  if (name === 'firebase-admin/firestore') return { getFirestore: () => database, FieldValue: { serverTimestamp: () => 'server-timestamp' } };
  if (name === 'firebase-admin/auth') return { getAuth: () => ({ getUser: async (uid: string) => ({ uid }) }) };
  if (name === 'firebase-functions/v2/https') return { onCall: (_: any, run: any) => ({ run }), HttpsError: FakeHttpsError };
  return loader.call(this, name, ...rest);
};
process.env.FUNCTIONS_EMULATOR = 'true';
const { validateGuestBookingShape } = require('../src/availability');
Module._load = loader;

/** The smallest booking `validateGuestBookingShape` accepts, sans evidence. */
function baseBooking(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guest_name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.test',
    check_in: '2026-12-16', check_out: '2026-12-17', guests: 2, accommodation: 'main-house',
    special_requests: '', pet_count: 0, late_checkout_hours: 0,
    uid: 'guest-one', source: 'web', payment_proof_url: 'payments/guest-one/proof.png',
    paymentProofUrl: 'payments/guest-one/proof.png', payment_status: 'pending',
    amount_claimed: 3000, payment_plan: 'down-payment', nights: 1,
    rate_amount: 6000, rate_unit: 'standard_stay', rate_classification: 'weekday',
    stay_total: 6000, amount_due: 3000, balance_due: 3000, security_deposit: 500,
    policy_version: 'availability-v1', policy_effective_date: '2026-01-01',
    refund_policy_snapshot: null,
    ...extra,
  };
}

/** The evidence `/book/pay` files when the browser read the screenshot. */
const EVIDENCE = {
  payment_reference: '8159662488150',
  extractedRefNumber: '8159662488150',
  ocr_reference: '8159662488150',
  ocr_amount: '7500.00',
  ocr_sender_name: 'JUAN DELA CRUZ',
  ocr_payment_date: '2026-11-01',
  ocr_proof_url: 'payments/guest-one/proof.png',
  ocr_engine: 'tesseract',
  ocr_confidence: 'high',
};

function invalidArgument(error: unknown): boolean {
  return error instanceof FakeHttpsError && error.code === 'invalid-argument';
}

test('accepts the website OCR evidence a Guest read off their own screenshot', () => {
  const shaped = validateGuestBookingShape(baseBooking(EVIDENCE), 'guest-one');
  assert.equal(shaped.ocr_reference, '8159662488150');
  assert.equal(shaped.ocr_amount, '7500.00');
  assert.equal(shaped.ocr_payment_date, '2026-11-01');
});

test('refuses OCR evidence that is not shaped like evidence', () => {
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_amount: 'all of it' }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_payment_date: '01/11/2026' }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_confidence: 'very sure' }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_reference: 'R'.repeat(41) }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_amount: 7500 as unknown as string }), 'guest-one'), invalidArgument);
});

test('still refuses fields that are not the Guest\'s to file', () => {
  // The Admin app's own read metadata and the verified-money marker stay
  // outside the vocabulary even though the provenance triple is inside it.
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_extracted_at: '2026-11-01T00:00:00Z' }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ ocr_recipient_name: 'MARIA SANTOS' }), 'guest-one'), invalidArgument);
  assert.throws(() => validateGuestBookingShape(baseBooking({ amount_verified: 3000 }), 'guest-one'), invalidArgument);
});
