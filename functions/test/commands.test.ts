/** Handler contract tests with a transactional in-memory adapter (NOT emulator verification). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const Module = require('node:module');
const loader = Module._load;
const store = new Map<string, any>();
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;
let storageEnabled = false;
const storageReads: string[] = [];
const deletedPrefixes: string[] = [];
let failDeleteOnce = false;
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
  'admin-three': { uid: 'admin-three', providerData: [{}] },
  anonymous: { uid: 'anonymous', providerData: [] },
};
class FakeHttpsError extends Error { constructor(readonly code: string, message: string) { super(message); } }
Module._load = function(name: string, ...rest: any[]) {
  if (name === 'firebase-admin/app') return { initializeApp: () => {} };
  if (name === 'firebase-admin/firestore') return { getFirestore: () => database, FieldValue: { arrayUnion: (value: string) => [value], serverTimestamp: () => 'server-timestamp' } };
  if (name === 'firebase-admin/auth') return { getAuth: () => ({ getUser: async (uid: string) => { if (!accounts[uid]) throw new Error('no account'); return accounts[uid]; }, getUserByEmail: async () => { throw new Error('not provisioned'); } }) };
  if (name === 'firebase-admin/storage') return { getStorage: () => {
    assert.equal(storageEnabled, true, 'Storage must not be called by case commands');
    return { bucket: () => ({
      deleteFiles: async ({ prefix }: { prefix: string }) => { if (failDeleteOnce) { failDeleteOnce = false; throw new Error('synthetic storage failure'); } deletedPrefixes.push(prefix); },
      getMetadata: async () => [{ iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } }],
      iam: { getPolicy: async () => [{ bindings: [] }] },
      file: (path: string) => ({ download: async () => { storageReads.push(path); return [Buffer.from('synthetic validated bytes')]; } }),
    }) };
  } };
  if (name === 'firebase-functions/v2/https') return { onCall: (_: any, run: any) => ({ run }), HttpsError: FakeHttpsError };
  if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_: any, run: any) => ({ run }) };
  return loader.call(this, name, ...rest);
};
process.env.FUNCTIONS_EMULATOR = 'true';
const handlers = require('../src/index');
Module._load = loader;
function run(uid: string | null, data: any, name = 'disputeCommand') {
  return handlers[name].run({ auth: uid ? { uid, token: { auth_time: Date.now() / 1000, firebase: { sign_in_provider: uid === 'anonymous' ? 'anonymous' : 'password' } } } : null, data });
}
const op = (action: string, fields = {}) => ({ action, operationId: `operation-${++sequence}`, ...fields });
async function create(uid = 'guest-one', fields = {}) { return run(uid, op('create', { category: 'other', description: 'A concern with sufficient explanation.', ...fields })); }
beforeEach(() => {
  store.clear(); for (const uid of ['admin-one', 'admin-two', 'admin-three']) store.set(`profiles/${uid}`, { role: 'admin' });
  queue = Promise.resolve(); storageEnabled = false; storageReads.length = 0; deletedPrefixes.length = 0; failDeleteOnce = false; delete process.env.DISPUTE_PRIVACY_ADMINS; delete process.env.DISPUTES_ENABLED; delete process.env.DISPUTE_RETENTION_ENABLED;
  for (const account of Object.values(accounts)) { delete account.disabled; delete account.tokensValidAfterTime; }
});
test('unauthenticated and anonymous case creation are refused before writes', async () => {
  await assert.rejects(run(null, op('create')), (e: any) => e.code === 'unauthenticated');
  await assert.rejects(create('anonymous'), /linked account|recoverable/); assert.equal([...store.keys()].some(k => k.startsWith('cases/')), false);
});
test('case, server reference, receipt, activity and notification commit together', async () => {
  const c = await create(); assert.match(c.reference, /^HDL-\d{4}-000001$/);
  assert.equal(store.get(`cases/${c.caseId}`).status, 'submitted');
  assert.equal([...store.keys()].filter(k => k.startsWith(`cases/${c.caseId}/activity/`)).length, 1);
  assert.equal([...store.keys()].filter(k => k.startsWith('caseNotifications/')).length, 1);
  assert.equal([...store.keys()].filter(k => k.startsWith('caseOperations/')).length, 1);
});
test('timeout retries return the same reference and do not duplicate notifications/audit', async () => {
  const command = op('create', { category: 'other', description: 'An unchanged case submission.' });
  const first = await run('guest-one', command); const size = store.size; const second = await run('guest-one', command);
  assert.deepEqual(first, second); assert.equal(store.size, size);
  await assert.rejects(run('guest-one', { ...command, description: 'Changed payload using same operation.' }), /different action/);
});
test('linked Booking ownership is checked; general cases need no Booking', async () => {
  store.set('bookings/booking-one', { uid: 'guest-two', accommodation: 'annex' });
  await assert.rejects(create('guest-one', { bookingId: 'booking-one' }), /ownership/);
  const created = await create('guest-two', { bookingId: 'booking-one' }); assert.equal(store.get(`cases/${created.caseId}`).accommodation, 'annex');
});
test('caller cannot promote themselves through command fields', async () => {
  const c = await create('guest-one', { admin: true, role: 'admin' });
  await assert.rejects(run('guest-one', op('assign', { caseId: c.caseId, expectedVersion: c.version, targetUid: 'guest-one', text: 'I claim to be Admin.', admin: true })), /Admin required/);
  assert.equal(store.has('profiles/guest-one'), false);
});
test('two concurrent commands cannot overwrite the same version', async () => {
  const c = await create();
  const results = await Promise.allSettled(['First independent message.', 'Second concurrent message.'].map(text => run('guest-one', op('message', { caseId: c.caseId, expectedVersion: c.version, text }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('internal notes never enter the Guest case or public Activity text', async () => {
  const c = await create(); await run('admin-one', op('note', { caseId: c.caseId, expectedVersion: c.version, text: 'Confidential investigation note.' }));
  assert.equal(JSON.stringify(store.get(`cases/${c.caseId}`)).includes('Confidential'), false);
  const publicEvents = [...store.entries()].filter(([path]) => path.startsWith(`cases/${c.caseId}/activity/`)); assert.equal(JSON.stringify(publicEvents).includes('Confidential'), false);
  const privateEvents = [...store.entries()].filter(([path]) => path.startsWith(`casePrivate/${c.caseId}/notes/`)); assert.equal(JSON.stringify(privateEvents).includes('Confidential'), true);
});
test('rejected actions create no receipt or audit event', async () => {
  const c = await create(); const before = clone([...store.entries()]);
  await assert.rejects(run('guest-two', op('message', { caseId: c.caseId, expectedVersion: c.version, text: 'Unrelated Guest message.' })), /access denied/);
  assert.deepEqual([...store.entries()], before);
});
test('daily create quota is enforced on the server', async () => { for (let i = 0; i < 10; i++) await create(); await assert.rejects(create(), (e: any) => e.code === 'resource-exhausted'); });
test('Admin-created reports default internal; sharing requires a recoverable Booking owner', async () => {
  const c = await create('admin-one'); assert.equal(store.get(`cases/${c.caseId}`).visibility, 'internal');
  await assert.rejects(create('admin-one', { internal: false }), /verified booking/);
  store.set('bookings/booking-one', { uid: 'anonymous' }); await assert.rejects(create('admin-one', { internal: false, bookingId: 'booking-one' }), /Link\/verify/);
});
test('evidence begin rejects foreign cases, oversize files and a 51st file', async () => {
  const c = await create(); const payload = { action: 'begin', operationId: 'upload-operation', caseId: c.caseId, expectedVersion: c.version, name: 'photo.jpg', type: 'image/jpeg', size: 100 };
  await assert.rejects(run('guest-two', payload, 'disputeEvidence'), /access required/);
  await assert.rejects(run('guest-one', { ...payload, size: 10 * 1024 * 1024 + 1 }, 'disputeEvidence'), /10 MB/);
  store.get(`cases/${c.caseId}`).attachment_count = 50;
  await assert.rejects(run('guest-one', payload, 'disputeEvidence'), (e: any) => e.code === 'resource-exhausted');
});
test('same upload operation cannot be reused for a different file', async () => {
  const c = await create(); const payload = { action: 'begin', operationId: 'upload-operation', caseId: c.caseId, expectedVersion: c.version, name: 'photo.jpg', type: 'image/jpeg', size: 100 };
  const first = await run('guest-one', payload, 'disputeEvidence'); const second = await run('guest-one', payload, 'disputeEvidence'); assert.deepEqual(first, second);
  await assert.rejects(run('guest-one', { ...payload, name: 'another.jpg' }, 'disputeEvidence'), /already used/);
});

function act(uid: string, caseId: string, action: string, fields = {}) {
  return run(uid, op(action, { caseId, expectedVersion: store.get(`cases/${caseId}`).version, ...fields }));
}
function submittedEvidence(caseId: string, restricted = false) {
  store.set('caseUploads/evidence-one', { case_id: caseId, owner: 'guest-one', state: 'attached', restricted, name: 'photo.jpg', type: 'image/webp', size: 100, delete_requested: false });
  store.set(`cases/${caseId}/evidence/evidence-one`, { restricted, owner: 'guest-one', name: restricted ? '[Restricted evidence]' : 'photo.jpg' });
}
test('disabled accounts and revoked sessions cannot create cases using old claims', async () => {
  accounts['guest-one'].disabled = true; await assert.rejects(create(), /recoverable/);
  delete accounts['guest-one'].disabled; accounts['guest-one'].tokensValidAfterTime = new Date(Date.now() + 60_000).toISOString();
  await assert.rejects(create(), /Sign in again/); assert.equal([...store.keys()].some(k => k.startsWith('cases/')), false);
});
test('profile privacy flags do not confer designated privacy authority', async () => {
  const c = await create(); store.set('profiles/admin-one', { role: 'admin', privacy: true, privacy_admin: true });
  await assert.rejects(act('admin-one', c.caseId, 'hold', { restricted: true, text: 'Legitimate review with future date.', dueAt: Date.now() + 86_400_000 }), /Designated privacy Admin/);
});
test('prior investigator and private-note author remain ineligible as appeal reviewers', async () => {
  const c = await create();
  await act('admin-one', c.caseId, 'assign', { targetUid: 'admin-one', text: 'Assign initial investigator.' });
  await act('admin-one', c.caseId, 'review');
  await act('admin-two', c.caseId, 'note', { text: 'I supplied substantive private investigation.' });
  await act('admin-one', c.caseId, 'propose', { text: 'The fix has actually been completed.', completed: true });
  await act('guest-one', c.caseId, 'contest', { text: 'I disagree and request independent review.' });
  for (const targetUid of ['admin-one', 'admin-two']) await assert.rejects(act('admin-one', c.caseId, 'assign', { targetUid, text: 'Attempted reviewer assignment.' }), /independent/);
  await act('admin-one', c.caseId, 'assign', { targetUid: 'admin-three', text: 'An uninvolved Admin will review.' });
  await assert.rejects(act('admin-one', c.caseId, 'final_decision', { completed: true, text: 'Original investigator cannot decide the appeal.' }), /assignment/);
  await act('admin-three', c.caseId, 'review');
  await act('admin-three', c.caseId, 'final_decision', { completed: true, text: 'Independent findings and completed remedy recorded.' });
  assert.equal(store.get(`cases/${c.caseId}`).final_decision, true);
});
test('foreign Guests cannot download evidence even when they know the upload identifier', async () => {
  const c = await create(); submittedEvidence(c.caseId); storageEnabled = true;
  await assert.rejects(run('guest-two', { action: 'download', uploadId: 'evidence-one' }, 'disputeEvidence'), /access denied/);
  assert.deepEqual(storageReads, []);
  const own = await run('guest-one', { action: 'download', uploadId: 'evidence-one' }, 'disputeEvidence');
  assert.equal(Buffer.from(own.base64, 'base64').toString(), 'synthetic validated bytes');
  assert.equal(storageReads.length, 1);
});
test('restricted reads require current designated authority and leave a private access audit', async () => {
  const c = await create(); submittedEvidence(c.caseId, true); storageEnabled = true;
  Object.assign(store.get(`cases/${c.caseId}`), { assigned_to: 'admin-one', independent_review: true, reviewer_id: 'admin-two' });
  for (const uid of ['guest-one', 'admin-one', 'admin-three']) await assert.rejects(run(uid, { action: 'download', uploadId: 'evidence-one' }, 'disputeEvidence'), /designated reviewer/);
  assert.deepEqual(storageReads, []);
  await run('admin-two', { action: 'download', uploadId: 'evidence-one' }, 'disputeEvidence');
  const access = [...store.entries()].filter(([path, value]) => path.startsWith(`casePrivate/${c.caseId}/notes/`) && value.action === 'restricted_evidence_access');
  assert.equal(access.length, 1); assert.equal(access[0]![1].actor_uid, 'admin-two');
  assert.equal([...store.values()].filter(v => v.action === 'restricted_evidence_access' && 'base64' in v).length, 0);
});
test('withdrawal immediately restricts ordinary viewing; a hold prevents approved deletion', async () => {
  const c = await create(); submittedEvidence(c.caseId); storageEnabled = true;
  await act('guest-one', c.caseId, 'evidence_request', { evidenceId: 'evidence-one', text: 'Please review and withdraw this evidence.' });
  assert.equal(store.get('caseUploads/evidence-one').restricted, true);
  assert.equal(store.get(`cases/${c.caseId}/evidence/evidence-one`).name, '[Restricted evidence]');
  await assert.rejects(run('guest-one', { action: 'download', uploadId: 'evidence-one' }, 'disputeEvidence'), /designated reviewer/);
  process.env.DISPUTE_PRIVACY_ADMINS = 'admin-one';
  await act('admin-one', c.caseId, 'hold', { restricted: true, text: 'Preserve during approved legal review.', dueAt: Date.now() + 86_400_000 });
  const before = clone([...store.entries()]);
  await assert.rejects(act('admin-one', c.caseId, 'evidence_decision', { evidenceId: 'evidence-one', restricted: true, completed: true, text: 'Request to delete held evidence.' }), /hold prevents deletion/);
  assert.deepEqual([...store.entries()], before); assert.deepEqual(storageReads, []);
});
test('private notes do not notify Guests; inbox recipients and cursors cannot be forged', async () => {
  const c = await create(); await act('admin-one', c.caseId, 'note', { text: 'Confidential investigation, not a public response.' });
  const guest = await run('guest-one', { action: 'list' }, 'disputeInbox');
  assert.equal(guest.items.length, 0);
  const sharedId = [...store.entries()].find(([path, value]) => path.startsWith('caseNotifications/') && value.user_id === 'admin')![0].split('/')[1];
  await assert.rejects(run('guest-one', { action: 'list', cursor: sharedId }, 'disputeInbox'), /Invalid inbox cursor/);
  await assert.rejects(run('guest-one', { action: 'read', notificationId: sharedId }, 'disputeInbox'), /access denied/);
  assert.equal(JSON.stringify(await run('admin-one', { action: 'list' }, 'disputeInbox')).includes('Confidential'), false);
});

test('temporary upload expiry honors holds and missing private policy; approved release permits cleanup', async () => {
  const c = await create(); const secret = store.get(`casePrivate/${c.caseId}`);
  store.get(`cases/${c.caseId}`).attachment_count = 1;
  store.set('caseUploads/pending-one', { case_id: c.caseId, owner: 'guest-one', state: 'uploading', expires_at: Date.now() - 1000 });
  process.env.DISPUTES_ENABLED = 'true'; storageEnabled = true;
  secret.hold = true;
  await handlers.disputeMaintenance.run({}); assert.deepEqual(deletedPrefixes, []); assert.equal(store.get('caseUploads/pending-one').state, 'uploading');
  store.delete(`casePrivate/${c.caseId}`);
  await handlers.disputeMaintenance.run({}); assert.deepEqual(deletedPrefixes, []);
  store.set(`casePrivate/${c.caseId}`, secret); process.env.DISPUTE_PRIVACY_ADMINS = 'admin-one';
  await act('admin-one', c.caseId, 'hold', { restricted: false, text: 'Release after authorized legal review.' });
  await handlers.disputeMaintenance.run({});
  assert.equal(store.get('caseUploads/pending-one').state, 'expired');
  assert.equal(store.get(`cases/${c.caseId}`).attachment_count, 0);
  assert.equal(store.get(`casePrivate/${c.caseId}`).retention_lock, false);
  assert.deepEqual(deletedPrefixes, [`caseEvidence/${c.caseId}/pending-one/`]);
});
test('failed temporary cleanup retries without a second slot release or lost lock', async () => {
  const c = await create(); store.get(`cases/${c.caseId}`).attachment_count = 1;
  store.set('caseUploads/pending-one', { case_id: c.caseId, owner: 'guest-one', state: 'ready', expires_at: Date.now() - 1000 });
  process.env.DISPUTES_ENABLED = 'true'; storageEnabled = true; failDeleteOnce = true;
  await assert.rejects(handlers.disputeMaintenance.run({}), /synthetic storage failure/);
  assert.equal(store.get('caseUploads/pending-one').state, 'expiring');
  assert.equal(store.get(`casePrivate/${c.caseId}`).privacy_deleting, 'pending-one');
  await assert.rejects(act('guest-one', c.caseId, 'message', { text: 'Concurrent change during cleanup.' }), /cleanup/);
  await handlers.disputeMaintenance.run({});
  assert.equal(store.get(`cases/${c.caseId}`).attachment_count, 0);
  assert.equal(store.get(`casePrivate/${c.caseId}`).retention_lock, false);
  assert.equal(store.get('caseUploads/pending-one').state, 'expired'); assert.equal(deletedPrefixes.length, 1);
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
