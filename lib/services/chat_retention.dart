/// Message retention — the Admin app's copy of the policy the website holds in
/// `src/lib/chatRetention.ts`.
///
/// The two are the same decision written twice, the way
/// `lib/services/booking_lifecycle.dart` is the same decision as
/// `src/lib/booking`: one rules engine cannot run on both platforms, so the
/// policy lives twice and the *enforcement* lives once, in `firestore.rules`
/// (only the Admin may write `messages_expires_at`).
///
/// What this is for: a Booking is a record and a conversation is chat, so a
/// finished thread is stamped with an expiry and a scheduled job sweeps it
/// (docs/MESSAGING.md § 4). Nothing is deleted the moment a Booking completes —
/// a Guest coming back to a settled question is the normal case.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// The only field that carries the retention policy.
const String kRetentionField = 'messages_expires_at';

/// How long a finished conversation is kept, in days. Change it in
/// `src/lib/chatRetention.ts` too; the two are the same number.
const int kChatRetentionDays = 90;

/// The Booking statuses that start the clock: nothing more will happen on a
/// Booking in one of these. Mirrors CONTEXT.md § Stay and the website's
/// `RETENTION_ELIGIBLE_STATUSES`.
const List<String> kRetentionEligibleStatuses = <String>[
  'Completed',
  'Cancelled',
  'Rejected',
  'Expired',
];

/// Is this a Booking status that starts the retention clock?
bool isRetentionEligible(String? status) =>
    status != null && kRetentionEligibleStatuses.contains(status);

/// When a thread closed on [closedAt] stops being kept, as a Firestore TTL
/// field. Whole days, and never a past date.
DateTime retentionExpiry(DateTime closedAt, {int days = kChatRetentionDays}) {
  final whole = days < 1 ? 1 : days;
  return closedAt.add(Duration(days: whole));
}

/// The patch to stamp on a conversation, or null when it must not have one yet.
Map<String, dynamic>? retentionPatch({
  required String? status,
  required DateTime closedAt,
  int days = kChatRetentionDays,
}) {
  if (!isRetentionEligible(status)) return null;
  return <String, dynamic>{kRetentionField: retentionExpiry(closedAt, days: days)};
}

/// Has the window closed? The Admin app says "scheduled for deletion" rather
/// than opening a thread that is about to be swept.
bool retentionElapsed(DateTime? expiresAt, {DateTime? now}) {
  if (expiresAt == null) return false;
  return !expiresAt.isAfter(now ?? DateTime.now());
}

/// Whole days left before the sweep, floored at 0; null when nothing is stamped.
int? retentionDaysLeft(DateTime? expiresAt, {DateTime? now}) {
  if (expiresAt == null) return null;
  final remaining = expiresAt.difference(now ?? DateTime.now());
  if (remaining.isNegative || remaining == Duration.zero) return 0;
  return (remaining.inHours / 24).ceil();
}

/// Stamp a finished conversation so the scheduled sweep will collect it.
///
/// Only the Admin can write this field (`firestore.rules`), which is why the
/// method lives on the Admin app and nowhere in the website: a Guest could
/// neither lengthen nor shorten the window on a thread the hacienda keeps.
Future<void> stampRetention({
  required FirebaseFirestore firestore,
  required String conversationId,
  required String? bookingStatus,
  required DateTime closedAt,
  int days = kChatRetentionDays,
}) async {
  final patch = retentionPatch(
    status: bookingStatus,
    closedAt: closedAt,
    days: days,
  );
  if (patch == null) {
    debugPrint('[retention] $conversationId stays open: ${bookingStatus ?? 'no status'} is not terminal.');
    return;
  }
  await firestore.collection('conversations').doc(conversationId).update(patch);
  debugPrint('[retention] $conversationId scheduled for ${patch[kRetentionField]}');
}
