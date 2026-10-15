/** Pure retention/cleanup policy, shared with maintenance and regression tests. */
import type { CaseRecord, PrivateRecord } from './domain';
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
/** Calendar-month anniversary in Asia/Manila, clamped to the last valid day. */
export function calendarMonthsAfter(instant: number, months: number): number {
  const date = new Date(instant + MANILA_OFFSET);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime() - MANILA_OFFSET;
}
export function mayPurge(c: CaseRecord | undefined, p: PrivateRecord | undefined, now: number, phase: 'content' | 'minimal'): boolean {
  if (!c || !p || c.status !== 'closed' || !Number.isFinite(c.closed_at) || c.closed_at === null || c.remedy_pending) return false;
  if (p.hold || p.reopening_requested || c.reopening_requested || p.privacy_deleting || (p.retention_lease_until || 0) > now) return false;
  if (phase === 'content' && p.evidence_purged) return false;
  return calendarMonthsAfter(c.closed_at, phase === 'content' ? 12 : 24) <= now;
}
export function mayDeleteApprovedEvidence(p: PrivateRecord | undefined, evidenceId: string): boolean {
  return !!p && !p.hold && (!p.retention_lock || p.privacy_deleting === evidenceId);
}
