// ----------------------------------------------------------------------------
// Booking lifecycle — reading the Activity log aloud
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The Activity log is stored as facts (action, both statuses, actor, instant).
// What the Admin reads is a sentence, and the wording is behaviour: it has to use
// the glossary's words, not synonyms it avoids (CONTEXT.md, docs/agents/domain.md).
//
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

import type { ActivityActionType, ActivityLogEntry, ActorKind, ReviewActionType } from './actions'

/**
 * The names a Review's state changes carry (ADR-0014).
 *
 * `from_status` is `none` for the first one, because there was no Review to
 * have a status before — which is why the renderer below leaves the arrow out
 * for these rather than printing "none → pending".
 */
const REVIEW_ACTIONS: Record<ReviewActionType, string> = {
  ReviewSubmitted: 'Review written',
  ReviewUpdated: 'Review corrected by the Guest',
  AdminReviewResponded: 'Admin replied to the review',
  ReviewModerated: 'Review moderation changed',
  ReviewPublished: 'Review published to the website',
}

/** What each action did, in the glossary's words. */
const HEADLINES: Record<ActivityActionType, string> = {
  Submit: 'Booking submitted',
  Approve: 'Booking approved',
  Reject: 'Booking rejected',
  ChoosePaymentPlan: 'Payment plan chosen',
  UploadPaymentProof: 'Payment proof uploaded',
  VerifyPayment: 'Payment proof verified — Booking Reserved',
  RejectPaymentProof: 'Payment proof rejected',
  MarkRefunded: 'Refund returned to the Guest',
  RevokeKey: 'Credential revoked by the Admin',
  Cancel: 'Booking cancelled',
  Expire: 'Date hold ran out',
  CheckIn: 'First Credential use — Guest checked in',
  BeginStay: 'Stay in progress',
  CheckOut: 'Guest checked out',
  Complete: 'Stay completed',
  SetStatus: 'Status set directly by the Admin',
  ...REVIEW_ACTIONS,
}

const ROLE_LABELS: Record<ActorKind, string> = {
  guest: 'Guest',
  admin: 'Admin',
  system: 'System',
}

/**
 * Actors written before the two-role architecture (ADR-0007). They are read
 * back as the Admin, which is what both of those people now are; nothing is
 * rewritten in the stored log.
 */
const LEGACY_ACTOR_LABELS: Record<string, string> = {
  host: 'Admin',
  staff: 'Admin',
}

export type ActivityLine = {
  /** What happened. */
  headline: string
  /** The move it made, or the stage it recorded. */
  change: string
  /** Who made it: their name and role, or just the role. */
  actor: string
  /** The instant, as stored. */
  at: string
  /** The instant, for display. */
  atLabel: string
  /** Why, when the action carried a reason. */
  reason?: string
}

/** Read one Activity log entry as the Admin sees it. */
export function describeActivity(entry: ActivityLogEntry): ActivityLine {
  const role = ROLE_LABELS[entry.actor] ?? LEGACY_ACTOR_LABELS[entry.actor] ?? entry.actor
  return {
    headline: HEADLINES[entry.action] ?? entry.action,
    // A Review's statuses are moderation states, not Booking stages, and there
    // is no "before" the first time — so these say where it ended up rather
    // than printing an arrow out of a status that never existed.
    change: entry.action in REVIEW_ACTIONS ? `review is ${entry.to_status}` : `${entry.from_status} → ${entry.to_status}`,
    actor: entry.actor_name ? `${entry.actor_name} (${role})` : role,
    at: entry.at,
    atLabel: formatInstant(entry.at),
    ...(entry.reason ? { reason: entry.reason } : {}),
  }
}

function formatInstant(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
