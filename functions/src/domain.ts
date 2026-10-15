import { calendarMonthsAfter } from './privacy';
/** Pure case policy. No SDK, clock, network or financial/Booking writes. */
export const CATEGORIES = ['booking', 'payment', 'charges_refunds', 'availability', 'access', 'cleanliness_amenities', 'damage_safety', 'conduct_rules', 'communication', 'technical', 'other'] as const;
export const STATUSES = ['submitted', 'under_review', 'awaiting_guest', 'awaiting_staff', 'escalated', 'resolution_proposed', 'resolved', 'closed', 'reopened'] as const;
export type Status = typeof STATUSES[number];
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export const DAY = 86_400_000;
export const DEFAULT_POLICY = { firstResponseDays: 1, reminderDays: 3, responseDays: 7, reopeningDays: 14 };
export type Policy = typeof DEFAULT_POLICY;
export interface CaseRecord {
  schema_version: 2; reference: string; guest_id: string | null; reporter_id: string;
  booking_id: string | null; accommodation: string | null; visibility: 'guest' | 'internal';
  category: typeof CATEGORIES[number]; description: string; priority: Priority; status: Status;
  assigned_to: string | null; reviewer_id: string | null; independent_review: boolean; appeal_used: boolean;
  final_decision: boolean; formal: boolean; version: number; created_at: number; updated_at: number;
  first_response_at: number | null; due_at: number | null; reminder_at: number | null;
  next_alert_at: number | null; due_notified_for: number | null; reminder_notified_for: number | null;
  resolved_at: number | null; closed_at: number | null; reopen_until: number | null;
  remedy_pending: boolean; remedy_due_at: number | null; resolution: string | null;
  reopening_requested: boolean; retention_due_at: number | null; outcome: string | null; withdrawal_requested: boolean; duplicate_of: string | null; attachment_count: number;
}
export interface PrivateRecord {
  participants: string[]; hold: boolean; hold_reason: string | null; hold_review_at: number | null;
  reopening_requested: boolean; request_reason: string | null; source_case: string | null;
  evidence_purged?: boolean; retention_lock?: boolean; related_cases?: string[]; privacy_deleting?: string | null; retention_lease_until?: number;
}
export interface Actor { uid: string; admin: boolean; privacy: boolean }
export interface Command {
  action: string; operationId: string; caseId?: string; expectedVersion?: number;
  category?: string; description?: string; bookingId?: string; internal?: boolean;
  sourceCase?: string; text?: string; targetUid?: string; priority?: string;
  targetCase?: string; outcome?: string; dueAt?: number; completed?: boolean;
  formal?: boolean; executionRef?: string; attachmentIds?: string[]; evidenceId?: string;
  restricted?: boolean; summary?: string;
}
export class PolicyError extends Error {
  constructor(public code: 'invalid-argument' | 'permission-denied' | 'failed-precondition' | 'aborted' | 'resource-exhausted', message: string) { super(message); }
}
export function requireThat(ok: unknown, message: string, code: PolicyError['code'] = 'failed-precondition'): asserts ok {
  if (!ok) throw new PolicyError(code, message);
}
export function text(value: unknown, min = 1, max = 4000): string {
  requireThat(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `Text must contain ${min}–${max} characters.`, 'invalid-argument');
  return value.trim();
}
export function owns(c: CaseRecord, a: Actor) { return c.visibility === 'guest' && c.guest_id === a.uid; }
export function canRead(c: CaseRecord, a: Actor) { return a.admin || owns(c, a); }
export function eligible(p: PrivateRecord, c: CaseRecord, uid: string) {
  return uid !== c.reporter_id && uid !== c.guest_id && !p.participants.includes(uid);
}
export function policyFrom(raw: Record<string, unknown>): Policy {
  const out = { ...DEFAULT_POLICY };
  for (const k of Object.keys(out) as (keyof Policy)[]) {
    const value = raw[k];
    if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 90) out[k] = Number(value);
  }
  requireThat(out.reminderDays < out.responseDays, 'Reminder must precede response deadline.');
  return out;
}
export function newCase(cmd: Command, actor: Actor, now: number, reference: string, policy: Policy): CaseRecord {
  requireThat(CATEGORIES.includes(cmd.category as typeof CATEGORIES[number]), 'Choose a valid category.', 'invalid-argument');
  requireThat(!cmd.internal || actor.admin, 'Only Admins create internal reports.', 'permission-denied');
  const internal = actor.admin ? cmd.internal !== false : false;
  const category = cmd.category as CaseRecord['category'];
  return {
    schema_version: 2, reference, guest_id: internal ? null : actor.uid, reporter_id: actor.uid,
    booking_id: cmd.bookingId || null, accommodation: null, visibility: internal ? 'internal' : 'guest',
    category, description: text(cmd.description, 10), priority: 'normal', status: 'submitted',
    assigned_to: null, reviewer_id: null, independent_review: false, appeal_used: false,
    final_decision: false, formal: ['payment', 'charges_refunds', 'damage_safety', 'conduct_rules'].includes(category),
    version: 1, created_at: now, updated_at: now, first_response_at: null,
    due_at: now + policy.firstResponseDays * DAY, reminder_at: null, next_alert_at: now + policy.firstResponseDays * DAY, due_notified_for: null, reminder_notified_for: null,
    resolved_at: null, closed_at: null, reopen_until: null, remedy_pending: false,
    remedy_due_at: null, resolution: null, reopening_requested: false, retention_due_at: null, outcome: null, withdrawal_requested: false, duplicate_of: null, attachment_count: 0,
  };
}
export interface TransitionContext { targetIsAdmin?: boolean; duplicate?: CaseRecord; policy: Policy }
export function reduceCase(current: CaseRecord, privateRecord: PrivateRecord, cmd: Command, a: Actor, now: number, ctx: TransitionContext) {
  requireThat(!privateRecord.retention_lock, 'Privacy cleanup is in progress. Retry shortly.');
  requireThat(canRead(current, a), 'Case access denied.', 'permission-denied');
  requireThat(cmd.expectedVersion === current.version, 'Case changed. Refresh and reconsider this action.', 'aborted');
  const c = { ...current }; const p = { ...privateRecord, participants: [...privateRecord.participants] };
  const owner = owns(c, a); const inactive = ['resolved', 'closed'].includes(c.status);
  const admin = () => requireThat(a.admin, 'Admin required.', 'permission-denied');
  const responsible = () => {
    admin();
    requireThat((c.independent_review ? c.reviewer_id : c.assigned_to) === a.uid, 'Claim the case or obtain assignment before deciding.', 'permission-denied');
    requireThat(c.reporter_id !== a.uid && c.guest_id !== a.uid, 'A complainant cannot decide their own case.', 'permission-denied');
  };
  const participate = () => { if (a.admin && !p.participants.includes(a.uid)) p.participants.push(a.uid); };
  const active = () => requireThat(!inactive && !c.duplicate_of, 'Case is not active. Request reopening instead.');
  const substantive = () => { if (!c.first_response_at) { c.first_response_at = now; c.due_at = null; } };
  const resolve = () => {
    c.status = 'resolved'; c.resolved_at = now; c.closed_at = null;
    c.reopen_until = now + ctx.policy.reopeningDays * DAY; c.due_at = null; c.reminder_at = null;
  };
  let publicText = cmd.text ? text(cmd.text) : null;
  let privateText: string | null = null;
  switch (cmd.action) {
    case 'assign':
      admin(); active(); requireThat(ctx.targetIsAdmin && cmd.targetUid, 'Choose an active Admin.');
      if (c.independent_review) {
        requireThat(eligible(p, c, cmd.targetUid), 'Reviewer must be independent.'); c.reviewer_id = cmd.targetUid;
      } else c.assigned_to = cmd.targetUid;
      publicText = null; privateText = text(cmd.text); break;
    case 'link':
      admin(); requireThat(ctx.duplicate && cmd.targetCase, 'Related case not found.');
      p.related_cases = [...new Set([...(p.related_cases || []), cmd.targetCase])];
      privateText = text(cmd.text, 10); publicText = null; break;
    case 'extend_deadline':
      responsible(); active(); requireThat(c.due_at !== null && typeof cmd.dueAt === 'number' && cmd.dueAt > c.due_at && cmd.dueAt > now, 'An extension must move an existing deadline forward.');
      text(cmd.text, 10); c.due_at = cmd.dueAt; c.reminder_at = now + ctx.policy.reminderDays * DAY < cmd.dueAt ? now + ctx.policy.reminderDays * DAY : null; break;
    case 'priority':
      admin(); active(); requireThat(['urgent', 'high', 'normal', 'low'].includes(cmd.priority || ''), 'Invalid priority.', 'invalid-argument');
      c.priority = cmd.priority as Priority; privateText = text(cmd.text); publicText = null; break;
    case 'review':
      responsible(); requireThat(['submitted', 'reopened', 'awaiting_guest', 'awaiting_staff', 'escalated'].includes(c.status), 'Cannot start review from this state.');
      c.status = 'under_review'; participate(); break;
    case 'message':
      active(); text(cmd.text, (cmd.attachmentIds?.length || 0) ? 0 : 1);
      if (owner && c.status === 'awaiting_guest') { c.status = 'under_review'; c.due_at = null; c.reminder_at = null; }
      if (a.admin) { participate(); substantive(); } break;
    case 'note':
      admin(); active(); privateText = text(cmd.text); publicText = null;
      // Notes are investigation, even if the author is not the assignee.
      participate(); break;
    case 'request_info':
      responsible(); active(); requireThat(c.status === 'under_review' && c.visibility === 'guest', 'Review a guest-facing case first.');
      text(cmd.text); c.status = 'awaiting_guest'; substantive();
      c.due_at = now + ctx.policy.responseDays * DAY; c.reminder_at = now + ctx.policy.reminderDays * DAY; participate(); break;
    case 'await_staff':
      responsible(); requireThat(['under_review', 'resolution_proposed'].includes(c.status), 'Cannot wait for work from this state.');
      text(cmd.text); requireThat(typeof cmd.dueAt === 'number' && cmd.dueAt > now, 'Record the work due date.');
      c.status = 'awaiting_staff'; c.remedy_due_at = cmd.dueAt; c.due_at = cmd.dueAt; participate(); substantive(); break;
    case 'propose':
      responsible(); requireThat(c.status === 'under_review' && c.visibility === 'guest', 'Review a guest case before proposing.');
      c.resolution = text(cmd.text, 10); c.outcome = null; c.formal = true; c.remedy_pending = cmd.completed !== true;
      if (c.remedy_pending) requireThat(typeof cmd.dueAt === 'number' && cmd.dueAt > now, 'An unfinished remedy needs a due date.');
      c.remedy_due_at = c.remedy_pending ? cmd.dueAt! : null; c.status = 'resolution_proposed';
      substantive(); c.due_at = now + ctx.policy.responseDays * DAY; c.reminder_at = now + ctx.policy.reminderDays * DAY; participate(); break;
    case 'accept':
      requireThat(owner && !a.admin, 'Only the affected Guest can accept.', 'permission-denied');
      requireThat(c.status === 'resolution_proposed', 'There is no proposal to accept.');
      if (c.remedy_pending) { c.status = 'awaiting_staff'; c.due_at = c.remedy_due_at; c.reminder_at = null; }
      else { c.outcome = 'accepted'; resolve(); } break;
    case 'contest':
      requireThat(owner && !a.admin, 'Only the affected Guest may contest.', 'permission-denied');
      requireThat(c.status === 'resolution_proposed' && !c.appeal_used, 'Ordinary appeal is unavailable. Request exceptional reopening.');
      text(cmd.text, 10); c.status = 'escalated'; c.independent_review = true; c.appeal_used = true;
      c.reviewer_id = null; c.due_at = now + ctx.policy.firstResponseDays * DAY; c.reminder_at = null; break;
    case 'escalate':
      admin(); active(); text(cmd.text, 10); requireThat(!c.independent_review, 'Already in independent review.');
      c.status = 'escalated'; c.formal = true; c.independent_review = true; c.reviewer_id = null;
      c.due_at = now + ctx.policy.firstResponseDays * DAY; c.reminder_at = null; break;
    case 'resolve':
      responsible(); requireThat(['under_review', 'awaiting_staff'].includes(c.status), 'Review or complete the outstanding work first.');
      requireThat(!c.independent_review, 'Independent reviewers use a final decision, not the simple resolution path.');
      requireThat(!c.formal || c.visibility === 'internal' || c.outcome === 'accepted', 'Formal guest disputes require a proposal or independent determination.');
      requireThat(cmd.completed === true, 'Do not resolve a promised remedy.');
      c.resolution = text(cmd.text, 10); c.remedy_pending = false; c.remedy_due_at = null;
      c.outcome ||= 'completed_fix'; substantive(); participate(); resolve(); break;
    case 'final_decision':
      responsible(); requireThat(c.independent_review && ['under_review', 'awaiting_staff'].includes(c.status), 'An independent review is required.');
      requireThat(cmd.completed === true, 'An outstanding remedy must remain awaiting staff action.');
      c.resolution = text(cmd.text, 20); c.final_decision = true; c.outcome = 'independent_decision'; c.remedy_pending = false; c.remedy_due_at = null;
      substantive(); participate(); resolve(); break;
    case 'enforce_remedy':
      responsible(); requireThat(inactive && ['accepted', 'independent_decision', 'completed_fix'].includes(c.outcome || ''), 'Only enforce an existing decided remedy.');
      text(cmd.text, 10); requireThat(typeof cmd.dueAt === 'number' && cmd.dueAt > now, 'Set a fulfillment deadline.');
      p.evidence_purged = false; c.retention_due_at = null; c.status = 'awaiting_staff'; c.closed_at = null; c.remedy_pending = true; c.remedy_due_at = cmd.dueAt; c.due_at = cmd.dueAt; break;
    case 'complete_remedy':
      responsible(); requireThat(c.status === 'awaiting_staff' && c.remedy_pending && ['accepted', 'independent_decision', 'completed_fix'].includes(c.outcome || ''), 'No accepted or decided outstanding remedy.');
      requireThat(cmd.completed === true, 'Confirm execution, not a promise.'); text(cmd.text, 10);
      c.remedy_pending = false; c.remedy_due_at = null; participate(); resolve(); break;
    case 'withdraw_request':
      requireThat(owner, 'Only the affected Guest may request withdrawal.', 'permission-denied'); active(); text(cmd.text); c.withdrawal_requested = true; break;
    case 'close':
      responsible(); text(cmd.text, 10); requireThat(!c.remedy_pending, 'Outstanding remedies cannot be closed.');
      requireThat(['resolved', 'awaiting_guest', 'under_review'].includes(c.status), 'Case cannot be closed from this state.');
      if (c.status !== 'resolved') {
        requireThat(!c.formal && ((cmd.outcome === 'withdrawn' && c.withdrawal_requested) || (cmd.outcome === 'abandoned' && c.status === 'awaiting_guest' && c.due_at !== null && now > c.due_at)),
          'Only a requested withdrawal or overdue non-financial abandonment may close without resolution.');
        c.outcome = cmd.outcome!; c.resolved_at = now; c.reopen_until = now + ctx.policy.reopeningDays * DAY;
      }
      c.status = 'closed'; c.closed_at = now; c.retention_due_at = calendarMonthsAfter(now, 12); c.due_at = null; c.reminder_at = null; participate(); break;
    case 'reopen':
      requireThat(owner && !a.admin, 'Guest reopening required.', 'permission-denied');
      requireThat(inactive && !c.final_decision && !c.duplicate_of && !!c.reopen_until && now <= c.reopen_until, 'Request exceptional reopening instead.');
      text(cmd.text, 10); p.evidence_purged = false; c.retention_due_at = null; c.status = 'reopened'; c.outcome = null; c.withdrawal_requested = false; c.closed_at = null; c.due_at = now + ctx.policy.firstResponseDays * DAY;
      c.reminder_at = null; c.first_response_at = null; break;
    case 'request_reopen':
      requireThat(owner || a.admin, 'Access denied.', 'permission-denied'); requireThat(inactive && !c.duplicate_of, 'Only a decided case can request exceptional reopening.');
      c.reopening_requested = true; p.reopening_requested = true; p.request_reason = text(cmd.text, 10); break;
    case 'approve_reopen':
      admin(); requireThat(inactive && p.reopening_requested && eligible(p, c, a.uid), 'An eligible independent Admin must approve the request.');
      text(cmd.text, 10); p.evidence_purged = false; c.retention_due_at = null; c.status = 'reopened'; c.outcome = null; c.withdrawal_requested = false; c.closed_at = null; c.independent_review = true; c.reviewer_id = a.uid;
      c.first_response_at = null; c.due_at = now + ctx.policy.firstResponseDays * DAY; c.reminder_at = null;
      c.reopening_requested = false; p.reopening_requested = false; p.request_reason = null; break;
    case 'deny_reopen':
      admin(); requireThat(inactive && p.reopening_requested && eligible(p, c, a.uid), 'An eligible independent Admin must review the request.');
      text(cmd.text, 20); c.reopening_requested = false; p.reopening_requested = false; p.request_reason = null; break;
    case 'duplicate': {
      admin(); active(); const primary = ctx.duplicate;
      requireThat(primary && primary.visibility === c.visibility && primary.guest_id === c.guest_id && !primary.duplicate_of && !['closed', 'resolved'].includes(primary.status), 'Consolidate only into an active case with the same verified participant and visibility.');
      requireThat(!c.remedy_pending && !c.independent_review, 'Resolve obligations/review before consolidation.');
      text(cmd.text, 10); c.duplicate_of = cmd.targetCase!; c.outcome = 'duplicate'; c.status = 'closed'; c.closed_at = now; c.retention_due_at = calendarMonthsAfter(now, 12); c.due_at = null; c.reminder_at = null; break;
    }
    case 'hold':
      admin(); requireThat(a.privacy, 'Designated privacy Admin required.', 'permission-denied');
      requireThat(typeof cmd.restricted === 'boolean', 'Specify hold state.', 'invalid-argument');
      if (cmd.restricted) requireThat(typeof cmd.dueAt === 'number' && cmd.dueAt > now, 'Hold requires a review date.');
      p.hold = cmd.restricted; p.hold_reason = cmd.restricted ? text(cmd.text, 10) : null;
      p.hold_review_at = cmd.restricted ? cmd.dueAt! : null; privateText = text(cmd.text, 10); publicText = null; break;
    case 'evidence_request':
      text(cmd.text); break;
    case 'evidence_decision':
      admin(); requireThat(a.privacy, 'Designated privacy Admin required.', 'permission-denied');
      privateText = text(cmd.text, 10); publicText = null; break;
    default: throw new PolicyError('invalid-argument', 'Unknown case command.');
  }
  if (cmd.action === 'accept' && c.status === 'awaiting_staff') c.outcome = 'accepted';
  const alerts = [c.due_at !== c.due_notified_for ? c.due_at : null, c.reminder_at !== c.reminder_notified_for ? c.reminder_at : null].filter((n): n is number => n !== null);
  c.next_alert_at = alerts.length ? Math.min(...alerts) : null;
  c.version++; c.updated_at = now;
  return { record: c, privateRecord: p, publicText, privateText };
}
