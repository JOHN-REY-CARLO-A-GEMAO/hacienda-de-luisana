import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonthsAfter, mayPurge, mayDeleteApprovedEvidence } from '../src/privacy';
import { newCase, DEFAULT_POLICY, PrivateRecord } from '../src/domain';
const created = Date.parse('2026-10-15T00:00:00+08:00');
function fixture() {
  const c = newCase({ action: 'create', operationId: 'operation-one', category: 'other', description: 'A sample concern for retention testing.' }, { uid: 'guest-one', admin: false, privacy: false }, created, 'HDL-2026-000001', DEFAULT_POLICY);
  c.status = 'closed'; c.closed_at = created;
  const p: PrivateRecord = { participants: [], hold: false, hold_reason: null, hold_review_at: null, reopening_requested: false, request_reason: null, source_case: null };
  return { c, p };
}
test('calendar month anniversaries clamp leap days in Manila, preserving local time', () => {
  const leap = Date.parse('2024-02-29T01:30:00+08:00');
  assert.equal(new Date(calendarMonthsAfter(leap, 12)).toISOString(), new Date('2025-02-28T01:30:00+08:00').toISOString());
  assert.equal(new Date(calendarMonthsAfter(Date.parse('2026-01-31T23:30:00+08:00'), 1)).toISOString(), new Date('2026-02-28T23:30:00+08:00').toISOString());
});
for (const phase of ['content', 'minimal'] as const) {
  const months = phase === 'content' ? 12 : 24;
  test(`${phase} cannot purge before its exact anniversary`, () => { const { c, p } = fixture(); const due = calendarMonthsAfter(created, months); assert.equal(mayPurge(c, p, due - 1, phase), false); assert.equal(mayPurge(c, p, due, phase), true); });
  for (const guard of ['hold', 'reopening_requested', 'retention_lease_until', 'privacy_deleting'] as const) test(`${phase} respects ${guard}`, () => {
    const { c, p } = fixture(); const now = calendarMonthsAfter(created, months);
    if (guard === 'retention_lease_until') p[guard] = now + 1000;
    else if (guard === 'privacy_deleting') p[guard] = 'evidence-one';
    else p[guard] = true;
    assert.equal(mayPurge(c, p, now, phase), false);
  });
  test(`${phase} never purges a reopened case, pending obligation, or absent private record`, () => {
    const { c, p } = fixture(); const now = calendarMonthsAfter(created, months);
    c.status = 'reopened'; assert.equal(mayPurge(c, p, now, phase), false);
    c.status = 'closed'; c.remedy_pending = true; assert.equal(mayPurge(c, p, now, phase), false);
    c.remedy_pending = false; assert.equal(mayPurge(c, undefined, now, phase), false);
    c.reopening_requested = true; assert.equal(mayPurge(c, p, now, phase), false);
  });
}
test('completed content cleanup is not repeated but minimal expiry remains possible', () => { const { c, p } = fixture(); p.evidence_purged = true; const now = calendarMonthsAfter(created, 24); assert.equal(mayPurge(c, p, now, 'content'), false); assert.equal(mayPurge(c, p, now, 'minimal'), true); });
test('privacy deletion cannot steal another evidence deletion lock or override a hold', () => {
  const { p } = fixture(); assert.equal(mayDeleteApprovedEvidence(p, 'evidence-one'), true);
  p.hold = true; assert.equal(mayDeleteApprovedEvidence(p, 'evidence-one'), false);
  p.hold = false; p.retention_lock = true; p.privacy_deleting = 'evidence-one';
  assert.equal(mayDeleteApprovedEvidence(p, 'evidence-one'), true);
  assert.equal(mayDeleteApprovedEvidence(p, 'evidence-two'), false);
});
