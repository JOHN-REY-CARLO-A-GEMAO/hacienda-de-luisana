// ----------------------------------------------------------------------------
// Booking lifecycle — reading the Activity log aloud
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The Activity log is stored as facts (action, both statuses, actor, instant).
// What the Host reads is a sentence, and the wording is behaviour: it has to use
// the glossary's words, not synonyms it avoids (CONTEXT.md, docs/agents/domain.md).
//
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

import type { ActionType, ActivityLogEntry, ActorKind } from './actions'

/** What each action did, in the glossary's words. */
const HEADLINES: Record<ActionType, string> = {
  Submit: 'Booking submitted',
  UploadKyc: 'Government ID uploaded for KYC',
  Approve: 'Booking approved',
  Reject: 'Booking rejected',
  ChoosePaymentPlan: 'Payment plan chosen',
  UploadPaymentProof: 'Payment proof uploaded',
  VerifyPayment: 'Payment proof verified — Booking Reserved',
  RejectPaymentProof: 'Payment proof rejected',
  MarkRefunded: 'Refund returned to the Guest',
  Cancel: 'Booking cancelled',
  Expire: 'Date hold ran out',
  CheckIn: 'First Credential use — Guest checked in',
  BeginStay: 'Stay in progress',
  CheckOut: 'Guest checked out',
  Complete: 'Stay completed',
  SetStatus: 'Status changed on the Host dashboard',
}

const ROLE_LABELS: Record<ActorKind, string> = {
  guest: 'Guest',
  host: 'Host',
  staff: 'Staff',
  system: 'System',
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

/** Read one Activity log entry as the Host sees it. */
export function describeActivity(entry: ActivityLogEntry): ActivityLine {
  const role = ROLE_LABELS[entry.actor] ?? entry.actor
  return {
    headline: HEADLINES[entry.action] ?? entry.action,
    change: `${entry.from_status} → ${entry.to_status}`,
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
