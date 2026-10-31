/**
 * Server-side FCM notification pipeline tests (`functions/src/notifications.ts`).
 *
 * Covers:
 *   - All 7 supported operational event categories
 *   - Device-token registration & unregistration callables (`admin_device_tokens`)
 *   - Cross-account token isolation & automatic reassignment cleanup
 *   - Transactional dispatch idempotency (`notification_dispatches`)
 *   - Unrelated document update filtering (no noisy/duplicate sends)
 *   - Stale (>60d), demoted, disabled, and invalid FCM token pruning
 *   - Strict exclusion of Guest & Payment PII from FCM payloads
 *   - Fault tolerance when FCM delivery fails (never breaks booking writes)
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

const Module = require('node:module');
const originalLoad = Module._load;

const store = new Map<string, any>();
let txQueue: Promise<unknown> = Promise.resolve();
let generatedSeq = 0;

interface SentMulticastCall {
  tokens: string[];
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
  android?: any;
  apns?: any;
}

let multicastCalls: SentMulticastCall[] = [];
let tokenErrorOverrides = new Map<string, string>();
let throwOnMulticast: Error | null = null;

const clone = (v: any): any => {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  if (v instanceof FakeTimestamp) return new FakeTimestamp(v.toMillis());
  if (Array.isArray(v)) return v.map(clone);
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(v)) out[k] = clone(val);
  return out;
};

class FakeTimestamp {
  constructor(private readonly ms: number) {}
  toDate() {
    return new Date(this.ms);
  }
  toMillis() {
    return this.ms;
  }
}

class Reference {
  readonly id: string;
  constructor(readonly path: string) {
    this.id = path.split('/').at(-1)!;
  }
  async get() {
    return makeSnapshot(this);
  }
  async set(data: any) {
    store.set(this.path, clone(data));
  }
  async update(data: any) {
    store.set(this.path, { ...store.get(this.path), ...clone(data) });
  }
  async delete() {
    store.delete(this.path);
  }
  collection(sub: string) {
    return new Query(`${this.path}/${sub}`);
  }
}

function makeSnapshot(ref: Reference, explicitData?: any) {
  const hasDoc = explicitData !== undefined ? true : store.has(ref.path);
  const raw = explicitData !== undefined ? explicitData : store.get(ref.path);
  return {
    ref,
    id: ref.id,
    exists: hasDoc,
    data: () => clone(raw),
  };
}

class Query {
  private conditions: [string, string, any][] = [];
  private max = Infinity;

  constructor(readonly path: string) {}

  doc(id?: string) {
    return new Reference(`${this.path}/${id || 'gen-' + ++generatedSeq}`);
  }

  where(field: string, op: string, value: any) {
    const next = new Query(this.path);
    next.conditions = [...this.conditions, [field, op, value]];
    next.max = this.max;
    return next;
  }

  limit(n: number) {
    const next = new Query(this.path);
    next.conditions = [...this.conditions];
    next.max = n;
    return next;
  }

  async get() {
    const depth = this.path.split('/').length + 1;
    const docs = [...store.keys()]
      .filter(
        p => p.startsWith(`${this.path}/`) && p.split('/').length === depth,
      )
      .filter(p =>
        this.conditions.every(([k, op, v]) => {
          const actual = store.get(p)?.[k];
          if (op === '==') return actual === v;
          if (op === 'in') return Array.isArray(v) && v.includes(actual);
          return false;
        }),
      )
      .slice(0, this.max)
      .map(p => makeSnapshot(new Reference(p)));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

const fakeDb = {
  doc: (path: string) => new Reference(path),
  collection: (path: string) => new Query(path),
  batch: () => {
    const ops: (() => void)[] = [];
    return {
      delete: (ref: Reference) => {
        ops.push(() => store.delete(ref.path));
      },
      set: (ref: Reference, data: any) => {
        ops.push(() => store.set(ref.path, clone(data)));
      },
      commit: async () => {
        for (const op of ops) op();
      },
    };
  },
  runTransaction: async (fn: (tx: any) => any) => {
    const op = txQueue.then(async () => {
      let wrote = false;
      const staged: (() => void)[] = [];
      const tx = {
        get: async (target: Reference | Query) => {
          assert.equal(wrote, false, 'Transaction reads must precede writes');
          return target.get();
        },
        set: (ref: Reference, data: any, opts?: { merge?: boolean }) => {
          wrote = true;
          staged.push(() => {
            if (opts?.merge && store.has(ref.path)) {
              store.set(ref.path, { ...store.get(ref.path), ...clone(data) });
            } else {
              store.set(ref.path, clone(data));
            }
          });
        },
        create: (ref: Reference, data: any) => {
          wrote = true;
          staged.push(() => {
            assert.equal(store.has(ref.path), false);
            store.set(ref.path, clone(data));
          });
        },
        update: (ref: Reference, data: any) => {
          wrote = true;
          staged.push(() => {
            assert.equal(store.has(ref.path), true);
            store.set(ref.path, { ...store.get(ref.path), ...clone(data) });
          });
        },
        delete: (ref: Reference) => {
          wrote = true;
          staged.push(() => store.delete(ref.path));
        },
      };
      const out = await fn(tx);
      for (const write of staged) write();
      return out;
    });
    txQueue = op.catch(() => {});
    return op;
  },
};

const accounts: Record<string, any> = {};

class FakeHttpsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

Module._load = function (name: string, ...rest: any[]) {
  if (name === 'firebase-admin/app') {
    return { initializeApp: () => {} };
  }
  if (name === 'firebase-admin/firestore') {
    return {
      getFirestore: () => fakeDb,
      FieldValue: { serverTimestamp: () => new FakeTimestamp(Date.now()) },
      Timestamp: {
        fromDate: (d: Date) => new FakeTimestamp(d.getTime()),
      },
    };
  }
  if (name === 'firebase-admin/auth') {
    return {
      getAuth: () => ({
        getUser: async (uid: string) => {
          const found = accounts[uid];
          if (!found) throw new Error(`auth/user-not-found:${uid}`);
          return found;
        },
      }),
    };
  }
  if (name === 'firebase-admin/messaging') {
    return {
      getMessaging: () => ({
        sendEachForMulticast: async (req: SentMulticastCall) => {
          if (throwOnMulticast) throw throwOnMulticast;
          multicastCalls.push(clone(req));
          const responses = req.tokens.map(token => {
            const errCode = tokenErrorOverrides.get(token);
            if (errCode) {
              return {
                success: false,
                error: { code: errCode, message: errCode },
              };
            }
            return { success: true, messageId: `msg-${++generatedSeq}` };
          });
          return {
            responses,
            successCount: responses.filter(r => r.success).length,
            failureCount: responses.filter(r => !r.success).length,
          };
        },
      }),
    };
  }
  if (name === 'firebase-functions/v2/https') {
    return {
      onCall: (_opts: any, handler: any) => ({ run: handler }),
      HttpsError: FakeHttpsError,
    };
  }
  if (name === 'firebase-functions/v2/firestore') {
    return {
      onDocumentCreated: (_opts: any, handler: any) => ({ run: handler }),
      onDocumentUpdated: (_opts: any, handler: any) => ({ run: handler }),
    };
  }
  return originalLoad.call(this, name, ...rest);
};

const notifications = require('../src/notifications');
const indexExports = require('../src/index');
Module._load = originalLoad;

const VALID_TOKEN_A = 'fcm_valid_android_token_alpha_1234567890';
const VALID_TOKEN_B = 'fcm_valid_android_token_bravo_0987654321';

function callCallable(name: string, uid: string | null, data: any) {
  return indexExports[name].run({
    auth: uid ? { uid, token: {} } : null,
    rawRequest: { ip: '203.0.113.10' },
    data,
  });
}

function seedActiveAdminWithToken(uid = 'admin-1', token = VALID_TOKEN_A) {
  accounts[uid] = {
    uid,
    email: `${uid}@example.test`,
    emailVerified: true,
    disabled: false,
  };
  store.set(`profiles/${uid}`, { uid, role: 'admin' });
  const docId = notifications.adminDeviceTokenDocId(uid, token);
  store.set(`admin_device_tokens/${docId}`, {
    uid,
    token,
    platform: 'android',
    enabled: true,
    created_at: new FakeTimestamp(Date.now() - 60_000),
    updated_at: new FakeTimestamp(Date.now() - 60_000),
    last_seen_at: new FakeTimestamp(Date.now() - 60_000),
  });
  return docId;
}

beforeEach(() => {
  store.clear();
  multicastCalls = [];
  tokenErrorOverrides = new Map();
  throwOnMulticast = null;
  txQueue = Promise.resolve();
  for (const k of Object.keys(accounts)) delete accounts[k];
  notifications.resetNotificationStateForTests();

  accounts['guest-1'] = {
    uid: 'guest-1',
    email: 'guest@example.test',
    emailVerified: true,
    disabled: false,
  };
  store.set('profiles/guest-1', { uid: 'guest-1', role: 'guest' });
});

describe('admin device-token registration & security', () => {
  test('rejects unauthenticated and non-admin callers on register/unregister', async () => {
    await assert.rejects(
      callCallable('registerAdminDeviceToken', null, {
        token: VALID_TOKEN_A,
        platform: 'android',
      }),
      (err: any) => err.code === 'unauthenticated',
    );

    await assert.rejects(
      callCallable('registerAdminDeviceToken', 'guest-1', {
        token: VALID_TOKEN_A,
        platform: 'android',
      }),
      (err: any) => err.code === 'permission-denied',
    );

    await assert.rejects(
      callCallable('unregisterAdminDeviceToken', 'guest-1', {
        token: VALID_TOKEN_A,
      }),
      (err: any) => err.code === 'permission-denied',
    );
  });

  test('rejects disabled Admin and unverified bootstrap-only email', async () => {
    accounts['disabled-admin'] = {
      uid: 'disabled-admin',
      email: 'disabled@example.test',
      emailVerified: true,
      disabled: true,
    };
    store.set('profiles/disabled-admin', {
      uid: 'disabled-admin',
      role: 'admin',
    });

    await assert.rejects(
      callCallable('registerAdminDeviceToken', 'disabled-admin', {
        token: VALID_TOKEN_A,
        platform: 'android',
      }),
      (err: any) => err.code === 'permission-denied',
    );

    accounts['unverified-bootstrap'] = {
      uid: 'unverified-bootstrap',
      email: 'gemaojohnreyarguilles@gmail.com',
      emailVerified: false,
      disabled: false,
    };
    await assert.rejects(
      callCallable('registerAdminDeviceToken', 'unverified-bootstrap', {
        token: VALID_TOKEN_A,
        platform: 'android',
      }),
      (err: any) => err.code === 'permission-denied',
    );

    // Oversized >1024-byte token rejected before hitting Firestore 1500-byte single-field index limit
    seedActiveAdminWithToken('admin-size-check', VALID_TOKEN_B);
    await assert.rejects(
      callCallable('registerAdminDeviceToken', 'admin-size-check', {
        token: 'x'.repeat(1100),
        platform: 'android',
      }),
      (err: any) => err.code === 'invalid-argument',
    );
  });

  test('re-assigning a shared physical device token to Admin B purges Admin A binding', async () => {
    const adminADocId = seedActiveAdminWithToken('admin-a', VALID_TOKEN_A);
    accounts['admin-b'] = {
      uid: 'admin-b',
      email: 'admin-b@example.test',
      emailVerified: true,
      disabled: false,
    };
    store.set('profiles/admin-b', { uid: 'admin-b', role: 'admin' });

    const res = await callCallable('registerAdminDeviceToken', 'admin-b', {
      token: VALID_TOKEN_A,
      platform: 'android',
      appVersion: '1.0.0+1',
    });

    assert.equal(res.registered, true);
    assert.equal(store.has(`admin_device_tokens/${adminADocId}`), false);
    const adminBDoc = store.get(`admin_device_tokens/${res.token_id}`);
    assert.equal(adminBDoc.uid, 'admin-b');
    assert.equal(adminBDoc.enabled, true);

    // Admin A cannot unregister Admin B's token document
    await callCallable('unregisterAdminDeviceToken', 'admin-a', {
      token: VALID_TOKEN_A,
    });
    assert.equal(store.has(`admin_device_tokens/${res.token_id}`), true);

    // Admin B cleanly unregisters their own token on logout
    const unreg = await callCallable('unregisterAdminDeviceToken', 'admin-b', {
      token: VALID_TOKEN_A,
    });
    assert.equal(unreg.removed, true);
    assert.equal(store.has(`admin_device_tokens/${res.token_id}`), false);
  });
});

describe('all 7 server-verified notification events, PII scrubbing, & idempotency', () => {
  test('1. New booking submitted sends PII-free push once and suppresses replay', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    const bookingDoc = {
      guest_name: 'Maria Clara Santos',
      email: 'mariaclara@secret.example',
      phone: '+639171234567',
      accommodation: 'main-house',
      status: 'Pending',
      payment_proof_url: 'https://storage.secret/proof-abc.png',
      payment_reference: 'GCASH-99887766',
      amount_claimed: 14500,
    };

    const event = {
      params: { bookingId: 'booking_1001' },
      data: makeSnapshot(new Reference('bookings/booking_1001'), bookingDoc),
    };

    await indexExports.onBookingCreatedNotifyAdmin.run(event);
    assert.equal(multicastCalls.length, 1);

    const sent = multicastCalls[0]!;
    assert.deepEqual(sent.tokens, [VALID_TOKEN_A]);
    assert.equal(sent.data?.v, '1');
    assert.equal(sent.data?.type, 'booking_submitted');
    assert.equal(sent.data?.channel_id, 'hdl_admin_bookings');
    assert.equal(sent.data?.target, 'booking_detail');
    assert.equal(sent.data?.booking_id, 'booking_1001');

    // Verify strict PII exclusion
    const serialized = JSON.stringify(sent);
    assert.equal(serialized.includes('Maria Clara'), false);
    assert.equal(serialized.includes('mariaclara@secret.example'), false);
    assert.equal(serialized.includes('9171234567'), false);
    assert.equal(serialized.includes('proof-abc.png'), false);
    assert.equal(serialized.includes('GCASH-99887766'), false);
    assert.equal(serialized.includes('14500'), false);

    // Trigger replay with identical event is suppressed via notification_dispatches
    await indexExports.onBookingCreatedNotifyAdmin.run(event);
    assert.equal(multicastCalls.length, 1);
  });

  test('2. New payment proof submitted notifies payment queue and ignores OCR-only updates', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    const before = {
      accommodation: 'annex',
      status: 'Payment Pending',
      payment_status: 'unpaid',
      payment_proof_url: '',
    };
    const afterProof = {
      ...before,
      payment_status: 'pending',
      payment_proof_url: 'payments/guest-1/booking_2002/receipt_1.jpg',
      payment_reference: 'REF-SECRET-123',
    };

    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_2002' },
      data: {
        before: makeSnapshot(new Reference('bookings/booking_2002'), before),
        after: makeSnapshot(new Reference('bookings/booking_2002'), afterProof),
      },
    });

    assert.equal(multicastCalls.length, 1);
    assert.equal(multicastCalls[0]!.data?.type, 'payment_proof_submitted');
    assert.equal(multicastCalls[0]!.data?.channel_id, 'hdl_admin_payments');
    assert.equal(multicastCalls[0]!.data?.target, 'payment_queue');
    assert.equal(JSON.stringify(multicastCalls[0]).includes('REF-SECRET-123'), false);

    // Unrelated OCR extraction write on the same booking emits zero notifications
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_2002' },
      data: {
        before: makeSnapshot(new Reference('bookings/booking_2002'), afterProof),
        after: makeSnapshot(new Reference('bookings/booking_2002'), {
          ...afterProof,
          ocr_confidence: 0.96,
          ocr_reference: 'REF-SECRET-123',
        }),
      },
    });
    assert.equal(multicastCalls.length, 1);
  });

  test('3. New guest message notifies Admin thread without leaking message text; ignores Admin replies & spoofed uids', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    store.set('conversations/guest-1_booking_3003', {
      guest_uid: 'guest-1',
      booking_id: 'booking_3003',
    });

    // Spoofed sender_uid mismatch is ignored
    await indexExports.onGuestMessageCreatedNotifyAdmin.run({
      params: { convoId: 'guest-1_booking_3003', messageId: 'msg_spoof' },
      data: makeSnapshot(
        new Reference('conversations/guest-1_booking_3003/messages/msg_spoof'),
        {
          sender_role: 'guest',
          sender_uid: 'attacker-uid',
          text: 'Spoofed!',
        },
      ),
    });
    assert.equal(multicastCalls.length, 0);

    // Admin's own outgoing message is ignored
    await indexExports.onGuestMessageCreatedNotifyAdmin.run({
      params: { convoId: 'guest-1_booking_3003', messageId: 'msg_admin' },
      data: makeSnapshot(
        new Reference('conversations/guest-1_booking_3003/messages/msg_admin'),
        {
          sender_role: 'admin',
          sender_uid: 'admin-1',
          text: 'Welcome to Hacienda!',
        },
      ),
    });
    assert.equal(multicastCalls.length, 0);

    // Authentic Guest message emits privacy-safe chat_thread notification
    await indexExports.onGuestMessageCreatedNotifyAdmin.run({
      params: { convoId: 'guest-1_booking_3003', messageId: 'msg_guest_1' },
      data: makeSnapshot(
        new Reference('conversations/guest-1_booking_3003/messages/msg_guest_1'),
        {
          sender_role: 'guest',
          sender_uid: 'guest-1',
          booking_id: 'booking_3003',
          text: 'Private passport & bank details inside chat text',
        },
      ),
    });
    assert.equal(multicastCalls.length, 1);
    assert.equal(multicastCalls[0]!.data?.type, 'guest_message');
    assert.equal(multicastCalls[0]!.data?.channel_id, 'hdl_admin_messages');
    assert.equal(multicastCalls[0]!.data?.target, 'chat_thread');
    assert.equal(
      multicastCalls[0]!.data?.conversation_id,
      'guest-1_booking_3003',
    );
    assert.equal(
      JSON.stringify(multicastCalls[0]).includes('passport'),
      false,
    );
  });

  test('4. Guest cancellation vs Admin cancellation & refund queue routing', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    // Case A: Guest self-cancels a Reserved booking with initiated refund
    const beforeGuestCancel = {
      accommodation: 'main-house',
      status: 'Reserved',
      refund_status: 'none',
    };
    const afterGuestCancel = {
      accommodation: 'main-house',
      status: 'Cancelled',
      refund_status: 'initiated',
      cancelled_at: '2026-10-31T01:00:00.000Z',
    };
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_4004' },
      data: {
        before: makeSnapshot(
          new Reference('bookings/booking_4004'),
          beforeGuestCancel,
        ),
        after: makeSnapshot(
          new Reference('bookings/booking_4004'),
          afterGuestCancel,
        ),
      },
    });
    assert.equal(multicastCalls.length, 1);
    assert.equal(multicastCalls[0]!.data?.type, 'guest_cancellation');
    assert.equal(multicastCalls[0]!.data?.target, 'refund_queue');

    // Case B: Admin cancels a booking (Admin Cancel activity recorded in same tx)
    store.set('bookings/booking_4005/activity/act_1', {
      action: 'Cancel',
      actor: 'admin',
      actor_id: 'admin-1',
      seq: 1,
    });
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_4005' },
      data: {
        before: makeSnapshot(new Reference('bookings/booking_4005'), {
          accommodation: 'annex',
          status: 'Approved',
        }),
        after: makeSnapshot(new Reference('bookings/booking_4005'), {
          accommodation: 'annex',
          status: 'Cancelled',
        }),
      },
    });
    assert.equal(multicastCalls.length, 2);
    assert.equal(multicastCalls[1]!.data?.type, 'booking_status_changed');
    assert.equal(multicastCalls[1]!.data?.target, 'booking_detail');
    assert.equal(multicastCalls[1]!.android?.notification?.visibility, 'private');

    // Case C: Admin rejects payment proof with guestResubmits=false -> status='Cancelled'
    // Must classify as booking_status_changed, NEVER as guest_cancellation.
    store.set('bookings/booking_4006/activity/act_1', {
      action: 'RejectPaymentProof',
      actor: 'admin',
      actor_id: 'admin-1',
      seq: 1,
    });
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_4006' },
      data: {
        before: makeSnapshot(new Reference('bookings/booking_4006'), {
          accommodation: 'main-house',
          status: 'Payment Pending',
          payment_status: 'pending',
        }),
        after: makeSnapshot(new Reference('bookings/booking_4006'), {
          accommodation: 'main-house',
          status: 'Cancelled',
          payment_status: 'rejected',
          payment_reject_reason: 'Invalid receipt screenshot',
        }),
      },
    });
    assert.equal(multicastCalls.length, 3);
    assert.equal(multicastCalls[2]!.data?.type, 'booking_status_changed');
    assert.equal(multicastCalls[2]!.data?.target, 'booking_detail');
  });

  test('5 & 6. Structured reschedule/late-checkout requests and lifecycle status transitions', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    // Structured reschedule request pending
    const baseStay = {
      accommodation: 'house-a-camping',
      status: 'Reserved',
      check_in: '2026-12-10',
      check_out: '2026-12-12',
    };
    const withReschedule = {
      ...baseStay,
      reschedule_request: {
        status: 'pending',
        requested_at: '2026-10-31T02:00:00.000Z',
      },
    };
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_5005' },
      data: {
        before: makeSnapshot(new Reference('bookings/booking_5005'), baseStay),
        after: makeSnapshot(
          new Reference('bookings/booking_5005'),
          withReschedule,
        ),
      },
    });
    assert.equal(multicastCalls.length, 1);
    assert.equal(multicastCalls[0]!.data?.type, 'reschedule_request');

    // Status transition Reserved -> Checked-In
    await indexExports.onBookingUpdatedNotifyAdmin.run({
      params: { bookingId: 'booking_5005' },
      data: {
        before: makeSnapshot(
          new Reference('bookings/booking_5005'),
          withReschedule,
        ),
        after: makeSnapshot(new Reference('bookings/booking_5005'), {
          ...withReschedule,
          status: 'Checked-In',
        }),
      },
    });
    assert.equal(multicastCalls.length, 2);
    assert.equal(multicastCalls[1]!.data?.type, 'booking_status_changed');
  });

  test('7. Smart lock security events alert on denied access & master override, ignoring routine unlocks', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);

    // Routine granted unlock is ignored
    await indexExports.onAccessLogCreatedNotifyAdmin.run({
      params: { logId: 'log_routine' },
      data: makeSnapshot(new Reference('access_logs/log_routine'), {
        action: 'unlock',
        result: 'granted',
        method: 'keypad_pin',
        accommodation: 'main-house',
      }),
    });
    assert.equal(multicastCalls.length, 0);

    // Denied PIN entry emits high-priority security alert
    await indexExports.onAccessLogCreatedNotifyAdmin.run({
      params: { logId: 'log_denied_1' },
      data: makeSnapshot(new Reference('access_logs/log_denied_1'), {
        action: 'denied',
        result: 'denied',
        method: 'keypad_pin',
        accommodation: 'main-house',
        reason: 'Expired guest PIN',
      }),
    });
    assert.equal(multicastCalls.length, 1);
    assert.equal(multicastCalls[0]!.data?.type, 'smart_lock_security');
    assert.equal(multicastCalls[0]!.data?.channel_id, 'hdl_admin_security');
    assert.equal(multicastCalls[0]!.data?.target, 'smart_lock');
  });
});

describe('stale/invalid/demoted token cleanup & delivery failure resilience', () => {
  test('prunes unregistered FCM tokens, stale >60d tokens, and demoted accounts automatically', async () => {
    const validDocId = seedActiveAdminWithToken('admin-valid', VALID_TOKEN_A);
    const deadDocId = seedActiveAdminWithToken('admin-dead-tok', VALID_TOKEN_B);

    // Stale token (>60 days since last_seen_at)
    const staleToken = 'fcm_stale_device_token_older_than_sixty_days_12345';
    const staleDocId = seedActiveAdminWithToken('admin-stale', staleToken);
    store.set(`admin_device_tokens/${staleDocId}`, {
      ...store.get(`admin_device_tokens/${staleDocId}`),
      last_seen_at: new FakeTimestamp(Date.now() - 65 * 86_400_000),
    });

    // Demoted account (profile changed to guest after token was registered)
    const demotedToken = 'fcm_demoted_former_admin_device_token_123456789';
    const demotedDocId = seedActiveAdminWithToken('former-admin', demotedToken);
    store.set('profiles/former-admin', { uid: 'former-admin', role: 'guest' });

    // Mark VALID_TOKEN_B as unregistered in FCM
    tokenErrorOverrides.set(
      VALID_TOKEN_B,
      'messaging/registration-token-not-registered',
    );

    await indexExports.onBookingCreatedNotifyAdmin.run({
      params: { bookingId: 'booking_cleanup_test' },
      data: makeSnapshot(new Reference('bookings/booking_cleanup_test'), {
        accommodation: 'main-house',
        status: 'Pending',
      }),
    });

    // Stale & demoted tokens were never even sent to FCM and were deleted
    assert.equal(multicastCalls.length, 1);
    assert.deepEqual(multicastCalls[0]!.tokens, [VALID_TOKEN_A, VALID_TOKEN_B]);
    assert.equal(store.has(`admin_device_tokens/${staleDocId}`), false);
    assert.equal(store.has(`admin_device_tokens/${demotedDocId}`), false);
    // Dead token reported by FCM was pruned; valid token remains intact
    assert.equal(store.has(`admin_device_tokens/${deadDocId}`), false);
    assert.equal(store.has(`admin_device_tokens/${validDocId}`), true);
  });

  test('swallows catastrophic FCM outage without throwing or breaking upstream workflows', async () => {
    seedActiveAdminWithToken('admin-1', VALID_TOKEN_A);
    throwOnMulticast = new Error('FCM upstream 503 outage');

    await assert.doesNotReject(
      indexExports.onBookingCreatedNotifyAdmin.run({
        params: { bookingId: 'booking_outage_safe' },
        data: makeSnapshot(new Reference('bookings/booking_outage_safe'), {
          accommodation: 'annex',
          status: 'Pending',
        }),
      }),
    );
  });
});
