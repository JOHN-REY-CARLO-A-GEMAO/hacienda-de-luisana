import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Actor, Command, DEFAULT_POLICY, DAY, PrivateRecord, STATUSES, newCase, reduceCase, eligible, policyFrom } from '../src/domain';
const now = 1_800_000_000_000;
const guest: Actor = { uid: 'guest-one', admin: false, privacy: false };
const investigator: Actor = { uid: 'admin-one', admin: true, privacy: false };
const reviewer: Actor = { uid: 'admin-two', admin: true, privacy: false };
const privacy: Actor = { uid: 'admin-three', admin: true, privacy: true };
function fixture(category = 'other') {
  const record = newCase({ action: 'create', operationId: 'operation', category, description: 'An explanation of the concern.' }, guest, now, 'HDL-2026-000001', DEFAULT_POLICY);
  const privateRecord: PrivateRecord = { participants: [], hold: false, hold_reason: null, hold_review_at: null, reopening_requested: false, request_reason: null, source_case: null };
  return { record, privateRecord };
}
type State = ReturnType<typeof fixture>;
function act(s: State, action: string, a = investigator, fields: Partial<Command> = {}, time = now + 1000): State {
  return reduceCase(s.record, s.privateRecord, { action, operationId: 'operation', expectedVersion: s.record.version, text: 'A sufficiently detailed reason or finding.', ...fields }, a, time, { policy: DEFAULT_POLICY, targetIsAdmin: true });
}
function reviewing(category = 'other') { return act(act(fixture(category), 'assign', investigator, { targetUid: investigator.uid }), 'review'); }
function appealed() { return act(act(reviewing('payment'), 'propose', investigator, { completed: true }), 'contest', guest); }
test('new cases are submitted, server stamped and not privileged by client fields', () => {
  const s = fixture('payment'); assert.equal(s.record.status, 'submitted'); assert.equal(s.record.formal, true); assert.equal(s.record.assigned_to, null); assert.equal(s.record.due_at, now + DAY);
  assert.throws(() => newCase({ action: 'create', operationId: 'operation', category: 'other', internal: true, description: 'Private report by Guest' }, guest, now, 'ref', DEFAULT_POLICY));
});
test('category and text bounds are authoritative', () => {
  assert.throws(() => fixture('invented')); assert.throws(() => newCase({ action: 'create', operationId: 'operation', category: 'other', description: 'short' }, guest, now, 'ref', DEFAULT_POLICY));
});
test('clients cannot skip submitted -> resolved even with Admin assignment', () => { const s = fixture(); s.record.assigned_to = investigator.uid; assert.throws(() => act(s, 'resolve', investigator, { completed: true })); });
test('version conflict rejects a concurrent decision', () => { const s = reviewing(); assert.throws(() => act(s, 'resolve', investigator, { completed: true, expectedVersion: s.record.version - 1 }), /Refresh/); });
test('another Guest cannot read/mutate a case even knowing its reference', () => assert.throws(() => act(fixture(), 'message', { ...guest, uid: 'unrelated' }), /access denied/));
test('simple fixes resolve and closure preserves the 14-day reopen window', () => {
  let s = act(reviewing(), 'resolve', investigator, { completed: true }); const window = s.record.reopen_until;
  s = act(s, 'close'); assert.equal(s.record.status, 'closed'); assert.equal(s.record.reopen_until, window);
  s = act(s, 'reopen', guest); assert.equal(s.record.status, 'reopened');
});
test('ordinary late reopening requires an exceptional request', () => { const s = act(reviewing(), 'resolve', investigator, { completed: true }); assert.throws(() => act(s, 'reopen', guest, {}, now + 15 * DAY)); });
test('financial claims cannot use simple resolution or abandoned closure', () => { const s = reviewing('payment'); assert.throws(() => act(s, 'resolve', investigator, { completed: true })); const waiting = act(s, 'request_info'); assert.throws(() => act(waiting, 'close', investigator, { outcome: 'abandoned' }, now + 10 * DAY)); });
test('proposal silence is not acceptance; a read/assignment is not a response', () => { let s = fixture(); s = act(s, 'assign', investigator, { targetUid: investigator.uid }); assert.equal(s.record.first_response_at, null); s = act(s, 'review'); assert.equal(s.record.first_response_at, null); s = act(s, 'propose', investigator, { completed: true }); assert.equal(s.record.status, 'resolution_proposed'); assert.throws(() => act(s, 'accept')); });
test('accepted unfinished remedy stays outstanding until execution', () => {
  let s = act(reviewing('payment'), 'propose', investigator, { completed: false, dueAt: now + 10 * DAY }); s = act(s, 'accept', guest);
  assert.equal(s.record.status, 'awaiting_staff'); assert.equal(s.record.remedy_pending, true); assert.throws(() => act(s, 'close'));
  s = act(s, 'complete_remedy', investigator, { completed: true }); assert.equal(s.record.status, 'resolved'); assert.equal(s.record.remedy_pending, false);
});
test('changed proposal loses old acceptance', () => {
  let s = act(act(reviewing('payment'), 'propose', investigator, { completed: false, dueAt: now + DAY }), 'accept', guest);
  s = act(s, 'review'); s = act(s, 'propose', investigator, { completed: true }); assert.equal(s.record.outcome, null); assert.throws(() => act(s, 'resolve', investigator, { completed: true }));
});
test('an unassigned escalation remains pending and the original investigator cannot claim it', () => {
  const s = appealed(); assert.equal(s.record.reviewer_id, null); assert.throws(() => act(s, 'final_decision', investigator, { completed: true }));
  assert.throws(() => act(s, 'assign', investigator, { targetUid: investigator.uid }), /independent/);
});
test('notes disqualify an Admin but assignment alone does not', () => {
  const s = act(fixture(), 'assign', investigator, { targetUid: reviewer.uid }); assert.equal(eligible(s.privateRecord, s.record, reviewer.uid), true);
  const noted = act(s, 'note', investigator); assert.equal(eligible(noted.privateRecord, noted.record, investigator.uid), false);
});
test('independent authority persists across information requests', () => {
  let s = act(appealed(), 'assign', investigator, { targetUid: reviewer.uid }); s = act(s, 'review', reviewer); s = act(s, 'request_info', reviewer); s = act(s, 'message', guest);
  assert.equal(s.record.reviewer_id, reviewer.uid); assert.throws(() => act(s, 'final_decision', investigator, { completed: true }));
  s = act(s, 'final_decision', reviewer, { completed: true }); assert.equal(s.record.final_decision, true);
  assert.throws(() => act(s, 'reopen', guest));
  s = act(s, 'request_reopen', guest); assert.throws(() => act(s, 'approve_reopen', reviewer));
  s = act(s, 'approve_reopen', privacy); assert.equal(s.record.reviewer_id, privacy.uid);
});
test('independent reviewer cannot bypass final determination using simple resolution', () => { let s = act(appealed(), 'assign', investigator, { targetUid: reviewer.uid }); s = act(s, 'review', reviewer); assert.throws(() => act(s, 'resolve', reviewer, { completed: true })); });
test('one ordinary appeal; revised proposal cannot grant unlimited appeals', () => { let s = act(appealed(), 'assign', investigator, { targetUid: reviewer.uid }); s = act(s, 'review', reviewer); s = act(s, 'propose', reviewer, { completed: true }); assert.throws(() => act(s, 'contest', guest)); });
test('materially overdue non-financial information requests may close with reason', () => {
  const s = act(reviewing(), 'request_info'); assert.throws(() => act(s, 'close', investigator, { outcome: 'abandoned' }));
  const closed = act(s, 'close', investigator, { outcome: 'abandoned' }, now + 10 * DAY); assert.equal(closed.record.outcome, 'abandoned');
});
test('guest withdrawal is a request, not immediate destruction or financial closure', () => { const s = act(reviewing('payment'), 'withdraw_request', guest); assert.equal(s.record.withdrawal_requested, true); assert.throws(() => act(s, 'close', investigator, { outcome: 'withdrawn' })); });
test('non-financial withdrawal is deliberate Admin closure', () => { let s = act(reviewing(), 'withdraw_request', guest); s = act(s, 'close', investigator, { outcome: 'withdrawn' }); assert.equal(s.record.status, 'closed'); });
test('complainant Admin cannot decide their own operational report', () => { const s = fixture(); s.record.reporter_id = investigator.uid; s.record.visibility = 'internal'; s.record.guest_id = null; const assigned = act(s, 'assign', investigator, { targetUid: investigator.uid }); assert.throws(() => act(assigned, 'review')); });
test('duplicates cannot consolidate across guests or into a terminal/cyclic primary', () => {
  const s = reviewing(); const primary = fixture().record; primary.guest_id = 'another-guest';
  assert.throws(() => reduceCase(s.record, s.privateRecord, { action: 'duplicate', operationId: 'operation', expectedVersion: s.record.version, text: 'Duplicate report reason.', targetCase: 'primary-case' }, investigator, now, { policy: DEFAULT_POLICY, duplicate: primary }));
});
test('normal notes and hold rationale are private, never public event text', () => { const s = act(reviewing(), 'note'); assert.equal((s as ReturnType<typeof reduceCase>).publicText, null); const held = act(reviewing(), 'hold', privacy, { restricted: true, dueAt: now + DAY }); assert.equal((held as ReturnType<typeof reduceCase>).publicText, null); assert.equal(held.privateRecord.hold, true); });
test('only designated privacy Admin can place/release holds', () => assert.throws(() => act(reviewing(), 'hold', investigator, { restricted: true, dueAt: now + DAY })));
test('privacy cleanup lock prevents a reopen racing deletion', () => { const s = act(reviewing(), 'resolve', investigator, { completed: true }); s.privateRecord.retention_lock = true; assert.throws(() => act(s, 'reopen', guest), /cleanup/); });
test('ordinary new messages do not reset existing deadlines', () => { const waiting = act(reviewing(), 'request_info'); const messaged = act(waiting, 'message', investigator); assert.equal(messaged.record.due_at, waiting.record.due_at); });
test('remedy enforcement does not create a second merits appeal or overwrite findings', () => {
  let s = act(appealed(), 'assign', investigator, { targetUid: reviewer.uid }); s = act(s, 'review', reviewer); s = act(s, 'final_decision', reviewer, { completed: true });
  const resolution = s.record.resolution; s = act(s, 'enforce_remedy', reviewer, { dueAt: now + DAY }); assert.equal(s.record.final_decision, true);
  s = act(s, 'complete_remedy', reviewer, { completed: true }); assert.equal(s.record.resolution, resolution); assert.equal(s.record.appeal_used, true);
});
test('policy requires reminder to precede response deadline', () => assert.throws(() => policyFrom({ reminderDays: 8, responseDays: 7 })));
test('reducers do not mutate input snapshots', () => { const s = reviewing(); const before = JSON.stringify(s); act(s, 'message'); assert.equal(JSON.stringify(s), before); });
for (const status of STATUSES) for (const action of ['assign', 'priority', 'note', 'review', 'request_info', 'propose', 'resolve', 'final_decision', 'close', 'approve_reopen', 'duplicate', 'hold', 'evidence_decision']) {
  test(`Guest cannot ${action} directly from ${status}`, () => { const s = fixture(); s.record.status = status; assert.throws(() => act(s, action, guest, { targetUid: investigator.uid, priority: 'urgent', restricted: true, completed: true, dueAt: now + DAY })); });
}

test('original investigator may supply information during appeal but cannot decide it', () => {
  let s = act(appealed(), 'assign', investigator, { targetUid: reviewer.uid });
  s = act(s, 'message', investigator); s = act(s, 'note', investigator);
  assert.equal(s.record.reviewer_id, reviewer.uid);
  assert.throws(() => act(s, 'final_decision', investigator, { completed: true }));
});
