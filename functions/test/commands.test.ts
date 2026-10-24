/** Booking callable contract tests with a transactional in-memory adapter (NOT emulator verification). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const Module = require('node:module');
const loader = Module._load;
const store = new Map<string, any>();
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;
const clone = (x: any) => x === undefined ? undefined : structuredClone(x);
class Reference {
  id: string;
  constructor(readonly path: string) { this.id = path.split('/').at(-1)!; }
  async get() { return snapshot(this); }
  async delete() { store.delete(this.path); }
  collection(name: string) { return new Query(`${this.path}/${name}`); }
  async set(data: any) { store.set(this.path, clone(data)); }
  async update(data: any) { store.set(this.path, { ...store.get(this.path), ...clone(data) }); }
}
function snapshot(ref: Reference) { return { ref, id: ref.id, exists: store.has(ref.path), data: () => clone(store.get(ref.path)) }; }
class Query {
  conditions: [string, string, any][] = []; maximum = Infinity;
  constructor(readonly path: string) {}
  doc(id?: string) { return new Reference(`${this.path}/${id || 'generated-' + ++sequence}`); }
  async add(data: any) { const ref = this.doc(); await ref.set(data); return ref; }
  where(key: string, operator: string, value: any) { this.conditions.push([key, operator, value]); return this; }
  orderBy() { return this; }
  limit(n: number) { this.maximum = n; return this; }
  async get() {
    const docs = [...store.keys()].filter(path => path.startsWith(this.path + '/') && path.split('/').length === this.path.split('/').length + 1)
      .filter(path => this.conditions.every(([k, op, v]) => {
        const found = store.get(path)[k];
        if (op === '==') return found === v;
        if (op === 'in') return v.includes(found);
        if (op === '>') return found > v;
        if (op === '<') return found < v;
        if (op === '<=') return found <= v;
        return false;
      }))
      .slice(0, this.maximum).map(path => snapshot(new Reference(path)));
    return { docs, empty: !docs.length, size: docs.length };
  }
}
const database = {
  doc: (path: string) => new Reference(path), collection: (path: string) => new Query(path),
  runTransaction: async (fn: (tx: any) => any) => {
    const operation = queue.then(async () => {
      let writing = false; const pending: (() => void)[] = [];
      const tx = {
        get: async (ref: any) => { assert.equal(writing, false, 'Firestore forbids transaction reads after writes'); return ref.get(); },
        create: (ref: Reference, data: any) => { writing = true; pending.push(() => { assert.equal(store.has(ref.path), false); store.set(ref.path, clone(data)); }); },
        set: (ref: Reference, data: any) => { writing = true; pending.push(() => store.set(ref.path, clone(data))); },
        update: (ref: Reference, data: any) => { writing = true; pending.push(() => { assert.equal(store.has(ref.path), true); store.set(ref.path, { ...store.get(ref.path), ...clone(data) }); }); },
      };
      const result = await fn(tx); pending.forEach(write => write()); return result;
    });
    queue = operation.catch(() => {}); return operation;
  },
};
const accounts: Record<string, any> = {
  'guest-one': { uid: 'guest-one', providerData: [{}], email: 'guest@example.test' },
  'guest-two': { uid: 'guest-two', providerData: [{}] },
  'admin-one': { uid: 'admin-one', providerData: [{}], email: 'admin@example.test' },
  'admin-two': { uid: 'admin-two', providerData: [{}] },
};
class FakeHttpsError extends Error { constructor(readonly code: string, message: string) { super(message); } }
Module._load = function(name: string, ...rest: any[]) {
  if (name === 'firebase-admin/app') return { initializeApp: () => {} };
  if (name === 'firebase-admin/firestore') return { getFirestore: () => database, FieldValue: { serverTimestamp: () => 'server-timestamp' } };
  if (name === 'firebase-admin/auth') return { getAuth: () => ({ getUser: async (uid: string) => { if (!accounts[uid]) throw new Error('no account'); return accounts[uid]; } }) };
  if (name === 'firebase-functions/v2/https') return { onCall: (_: any, run: any) => ({ run }), HttpsError: FakeHttpsError };
  return loader.call(this, name, ...rest);
};
process.env.FUNCTIONS_EMULATOR = 'true';
const handlers = require('../src/index');
Module._load = loader;
function run(uid: string | null, data: any, name: string) {
  return handlers[name].run({ auth: uid ? { uid, token: { auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } } } : null, data });
}
beforeEach(() => {
  store.clear();
  for (const uid of ['admin-one', 'admin-two']) store.set(`profiles/${uid}`, { role: 'admin' });
  queue = Promise.resolve();
  for (const account of Object.values(accounts)) { delete account.disabled; delete account.tokensValidAfterTime; }
});

// ---------------------------------------------------------------------------
// Availability / Booking submit callables
// ---------------------------------------------------------------------------

function isoAfter(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function bookingRates() {
  const schedule = (base: number, cap?: number) => ({
    min_guests: 1, base_max_guests: cap ?? 10, base_rate: base,
    ...(cap ? { max_guests: cap } : { excess_per_guest: 500 }),
  });
  return {
    version: 'availability-v1', effective_date: '2026-01-01', holiday_dates: [],
    accommodations: {
      'main-house': {
        property_name: 'The Main House', rate_unit: 'standard_stay', active: true,
        available_units: 1, security_deposit: 500, down_payment_percent: 50,
        guest_pricing: { units_per_booking: 1, weekday: schedule(6000), weekend_holiday: schedule(6000) },
      },
      annex: {
        property_name: 'HDL Annex', rate_unit: 'standard_stay', active: true,
        available_units: 1, security_deposit: 500, down_payment_percent: 50,
        guest_pricing: { units_per_booking: 1, weekday: schedule(4000), weekend_holiday: schedule(4000) },
      },
      'house-a-camping': {
        property_name: 'A-House', rate_unit: 'standard_stay', active: true,
        available_units: 2, security_deposit: 0, down_payment_percent: 50,
        guest_pricing: { units_per_booking: 1, weekday: schedule(1000, 3), weekend_holiday: schedule(1000, 3) },
      },
    },
  };
}
function guestBooking(uid: string, checkIn = isoAfter(45)) {
  const checkOut = new Date(Date.parse(`${checkIn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const day = new Date(`${checkIn}T00:00:00Z`).getUTCDay();
  return {
    guest_name: 'Ana Reyes', phone: '09171234567', email: 'ana@example.test',
    check_in: checkIn, check_out: checkOut, guests: 2, accommodation: 'main-house',
    special_requests: '', pet_count: 0, late_checkout_hours: 0,
    uid, source: 'web', payment_proof_url: `payments/${uid}/proof.png`,
    paymentProofUrl: `payments/${uid}/proof.png`, payment_status: 'pending',
    amount_claimed: 3000, payment_plan: 'down-payment', nights: 1,
    rate_amount: 6000, rate_unit: 'standard_stay',
    rate_classification: day === 5 || day === 6 ? 'weekend_holiday' : 'weekday',
    stay_total: 6000, amount_due: 3000, balance_due: 3000, security_deposit: 500,
    policy_version: 'availability-v1', policy_effective_date: '2026-01-01',
    refund_policy_snapshot: null,
  };
}
function aHouseBooking(uid: string, checkIn = isoAfter(45)) {
  return {
    ...guestBooking(uid, checkIn),
    accommodation: 'house-a-camping', guests: 2,
    rate_amount: 1000, stay_total: 1000, amount_due: 500, balance_due: 500,
    amount_claimed: 500, security_deposit: 0,
  };
}
function prepareBookingConfig() {
  store.set('site_config/rates', bookingRates());
  store.set('site_config/booking', { minimumBookingLeadTimeDays: 30, quotes_required: false });
}

test('Guest submit creates the Pending Booking and first Activity entry atomically', async () => {
  prepareBookingConfig();
  const payload = guestBooking('guest-one');
  const result = await run('guest-one', { booking: payload }, 'submitBooking');
  assert.equal(result.status, 'Pending');
  assert.equal(store.get(`bookings/${result.id}`).status, 'Pending');
  assert.equal(store.get(`bookings/${result.id}`).hold_expires_at, result.hold_expires_at);
  assert.equal(store.get(`bookings/${result.id}/activity/0`).action, 'Submit');
  assert.equal(store.get(`bookings/${result.id}/activity/0`).actor_id, 'guest-one');
  assert.deepEqual(store.get('booking_inventory_locks/main-house'), {
    revision: 1,
    updated_at: 'server-timestamp',
  });
});

test('two concurrent Guest submits cannot both claim the last unit', async () => {
  prepareBookingConfig();
  const checkIn = isoAfter(46);
  const attempts = await Promise.allSettled([
    run('guest-one', { booking: guestBooking('guest-one', checkIn) }, 'submitBooking'),
    run('guest-two', { booking: guestBooking('guest-two', checkIn) }, 'submitBooking'),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  const refused = attempts.find(item => item.status === 'rejected') as PromiseRejectedResult;
  assert.equal(refused.reason.code, 'already-exists');
  assert.equal([...store.keys()].filter(path => /^bookings\/[^/]+$/.test(path)).length, 1);
});

test('transactional submit honours the A-House two-unit Published inventory', async () => {
  prepareBookingConfig();
  const checkIn = isoAfter(46);
  await run('guest-one', { booking: aHouseBooking('guest-one', checkIn) }, 'submitBooking');
  await run('guest-two', { booking: aHouseBooking('guest-two', checkIn) }, 'submitBooking');
  await assert.rejects(
    run('guest-three', { booking: aHouseBooking('guest-three', checkIn) }, 'submitBooking'),
    (error: any) => error.code === 'already-exists',
  );
  assert.equal(store.get('booking_inventory_locks/house-a-camping').revision, 2);
});

test('calendar reply exposes only day states and honours checkout boundaries', async () => {
  prepareBookingConfig();
  const payload = guestBooking('guest-one', isoAfter(47));
  const created = await run('guest-one', { booking: payload }, 'submitBooking');
  const result = await run(null, {
    accommodation: 'main-house', from: payload.check_in, to: payload.check_out,
  }, 'bookingAvailability');
  assert.deepEqual(result.days, [{ date: payload.check_in, state: 'pending' }]);
  assert.equal(JSON.stringify(result).includes('guest_name'), false);
  assert.equal(JSON.stringify(result).includes(created.id), false);

  const next = await run(null, {
    accommodation: 'main-house', from: payload.check_out,
    to: new Date(Date.parse(`${payload.check_out}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
  }, 'bookingAvailability');
  assert.deepEqual(next.days, [{ date: payload.check_out, state: 'available' }]);
});

test('calendar fails closed for missing inventory or corrupt overlapping records', async () => {
  prepareBookingConfig();
  delete store.get('site_config/rates').accommodations['main-house'].available_units;
  await assert.rejects(
    run(null, { accommodation: 'main-house', from: isoAfter(45), to: isoAfter(46) }, 'bookingAvailability'),
    (error: any) => error.code === 'unavailable',
  );

  prepareBookingConfig();
  store.set('bookings/corrupt', {
    accommodation: 'main-house', check_in: isoAfter(45), check_out: 'not-a-date', status: 'Approved',
  });
  await assert.rejects(
    run(null, { accommodation: 'main-house', from: isoAfter(45), to: isoAfter(46) }, 'bookingAvailability'),
    (error: any) => error.code === 'unavailable',
  );
});

test('Guest submit enforces the published lead time before writing a lock or Booking', async () => {
  prepareBookingConfig();
  await assert.rejects(
    run('guest-one', { booking: guestBooking('guest-one', isoAfter(1)) }, 'submitBooking'),
    (error: any) => error.code === 'invalid-argument' && error.message.includes('too soon'),
  );
  assert.equal([...store.keys()].some(path => path.startsWith('bookings/')), false);
  assert.equal([...store.keys()].some(path => path.startsWith('booking_inventory_locks/')), false);
});

test('Guest submit refuses a foreign identity and stale/invented money before writes', async () => {
  prepareBookingConfig();
  const before = clone([...store.entries()]);
  await assert.rejects(
    run('guest-one', { booking: guestBooking('guest-two') }, 'submitBooking'),
    (error: any) => error.code === 'permission-denied',
  );
  await assert.rejects(
    run('guest-one', { booking: { ...guestBooking('guest-one'), stay_total: 1000, amount_due: 500, balance_due: 500 } }, 'submitBooking'),
    (error: any) => error.code === 'failed-precondition',
  );
  assert.deepEqual([...store.entries()], before);
});
