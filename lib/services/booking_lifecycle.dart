// ----------------------------------------------------------------------------
// Booking lifecycle — the Admin's side of the rules
// Hacienda de LuisAna Admin app
// ----------------------------------------------------------------------------
// A pure-Dart port of `src/lib/booking` (statuses, transitions, actions, refund
// settlement, published rates). The website only ever takes the Guest actions;
// this file holds the Admin and system actions the Flutter app takes, checked
// against the same whitelist of transitions, and returns the Activity log
// entry every accepted action owes (ADR-0007: two roles, two apps).
//
// No Flutter or Firebase imports: `test/booking_lifecycle_test.dart` runs it
// with `dart test`-style unit tests.
// ----------------------------------------------------------------------------

import 'dart:math' as math;

/// The canonical Booking statuses, in lifecycle order, then the terminal
/// branches (CONTEXT.md § Booking status). `Confirmed` is retired: the paid
/// state is `Reserved`.
class BookingStatuses {
  BookingStatuses._();

  static const String pending = 'Pending';
  static const String kycSubmitted = 'KYC Submitted';
  static const String approved = 'Approved';
  static const String paymentPending = 'Payment Pending';
  static const String paymentVerified = 'Payment Verified';
  static const String reserved = 'Reserved';
  static const String checkedIn = 'Checked-In';
  static const String staying = 'Staying';
  static const String checkedOut = 'Checked-Out';
  static const String completed = 'Completed';
  static const String rejected = 'Rejected';
  static const String cancelled = 'Cancelled';
  static const String expired = 'Expired';

  static const List<String> all = [
    pending,
    kycSubmitted,
    approved,
    paymentPending,
    paymentVerified,
    reserved,
    checkedIn,
    staying,
    checkedOut,
    completed,
    rejected,
    cancelled,
    expired,
  ];

  /// Statuses whose Booking still claims its dates.
  static const List<String> dateHolding = [
    pending,
    kycSubmitted,
    approved,
    paymentPending,
    paymentVerified,
    reserved,
    checkedIn,
    staying,
    checkedOut,
  ];

  /// Statuses the Admin has already committed dates to.
  static const List<String> committed = [
    approved,
    paymentPending,
    paymentVerified,
    reserved,
    checkedIn,
    staying,
    checkedOut,
  ];

  /// Statuses whose 24-hour Date hold can still run out.
  static const List<String> expirable = [pending, kycSubmitted];

  static const List<String> terminal = [completed, rejected, cancelled, expired];
}

/// The legal transitions out of each status. A whitelist: anything missing is
/// refused, so no surface can shortcut past review or payment verification.
const Map<String, List<String>> kTransitions = {
  'Pending': ['KYC Submitted', 'Rejected', 'Cancelled', 'Expired'],
  'KYC Submitted': ['Approved', 'Rejected', 'Cancelled', 'Expired'],
  'Approved': ['Payment Pending', 'Rejected', 'Cancelled'],
  'Payment Pending': ['Payment Verified', 'Cancelled'],
  'Payment Verified': ['Reserved', 'Cancelled'],
  'Reserved': ['Checked-In', 'Cancelled'],
  'Checked-In': ['Staying'],
  'Staying': ['Checked-Out'],
  'Checked-Out': ['Completed'],
  'Completed': [],
  'Rejected': [],
  'Cancelled': [],
  'Expired': [],
};

String _fold(String s) =>
    s.trim().toLowerCase().replaceAll(RegExp(r'[\s_-]+'), '');

final Map<String, String> _canonicalByFolded = {
  for (final s in BookingStatuses.all) _fold(s): s,
  // Retired: the old web `Confirmed` reads as the paid state.
  'confirmed': BookingStatuses.reserved,
};

/// Read a stored status as a canonical one. Anything missing or unknown reads
/// as `Pending` — the start of the lifecycle, never a status that grants
/// access or money.
String normalizeStatus(Object? stored) {
  if (stored == null) return BookingStatuses.pending;
  final raw = stored.toString();
  if (raw.trim().isEmpty) return BookingStatuses.pending;
  return _canonicalByFolded[_fold(raw)] ?? BookingStatuses.pending;
}

bool canTransition(String from, String to) =>
    (kTransitions[from] ?? const []).contains(to);

// ----------------------------------------------------------------------------
// Date hold
// ----------------------------------------------------------------------------

const Duration kDateHold = Duration(hours: 24);

DateTime? parseInstant(Object? raw) {
  if (raw == null) return null;
  if (raw is DateTime) return raw.toUtc();
  if (raw is int) return DateTime.fromMillisecondsSinceEpoch(raw, isUtc: true);
  if (raw is String) return DateTime.tryParse(raw)?.toUtc();
  try {
    // Firestore Timestamp without importing cloud_firestore here.
    return ((raw as dynamic).toDate() as DateTime).toUtc();
  } catch (_) {
    return null;
  }
}

/// Midnight UTC of a `YYYY-MM-DD` (or ISO) date string; null when unreadable.
DateTime? parseDateOnly(Object? raw) {
  if (raw == null) return null;
  if (raw is DateTime) return DateTime.utc(raw.year, raw.month, raw.day);
  final s = raw.toString();
  if (s.length < 10) return null;
  final parsed = DateTime.tryParse('${s.substring(0, 10)}T00:00:00Z');
  return parsed;
}

bool isHoldExpirable(String status) =>
    BookingStatuses.expirable.contains(status);

/// Has the Date hold run out? A Booking still waiting for review with no
/// recorded hold is treated as expired for *availability* (it holds nothing),
/// which is what the web does too.
bool isHoldExpired(Map<String, dynamic> booking, DateTime now) {
  final status = normalizeStatus(booking['status']);
  if (!isHoldExpirable(status)) return false;
  final expiresAt = parseInstant(booking['hold_expires_at']);
  if (expiresAt == null) return true;
  return now.toUtc().isAfter(expiresAt);
}

/// The status every surface reads: `Expired` once the hold ran out.
String effectiveStatus(Map<String, dynamic> booking, DateTime now) {
  final status = normalizeStatus(booking['status']);
  return isHoldExpired(booking, now) ? BookingStatuses.expired : status;
}

Duration holdRemaining(Map<String, dynamic> booking, DateTime now) {
  final status = normalizeStatus(booking['status']);
  final expiresAt = parseInstant(booking['hold_expires_at']);
  if (!isHoldExpirable(status) || expiresAt == null) return Duration.zero;
  final left = expiresAt.difference(now.toUtc());
  return left.isNegative ? Duration.zero : left;
}

/// Read a Date hold's remaining time aloud, rounding down.
String formatHoldCountdown(Duration remaining) {
  if (remaining <= Duration.zero) return 'Dates released';
  final hours = remaining.inHours;
  final minutes = remaining.inMinutes % 60;
  if (hours > 0) return '${hours}h ${minutes}m';
  if (minutes > 0) return '${minutes}m';
  return '${minutes}m ${remaining.inSeconds % 60}s';
}

// ----------------------------------------------------------------------------
// Availability
// ----------------------------------------------------------------------------

bool _datesOverlap(String aIn, String aOut, String bIn, String bOut) {
  // Half-open [check_in, check_out): a check-out day is free for a check-in.
  return aIn.compareTo(bOut) < 0 && bIn.compareTo(aOut) < 0;
}

String _dateKey(Object? raw) {
  final d = parseDateOnly(raw);
  if (d == null) return '';
  return d.toIso8601String().substring(0, 10);
}

/// Other Bookings that already take the units on these dates. Empty when the
/// request fits. `forApproval` counts only committed Bookings — a Booking still
/// waiting for review does not block the Admin from approving another.
List<Map<String, dynamic>> findDateConflicts(
  Map<String, dynamic> request,
  List<Map<String, dynamic>> bookings, {
  required int unitsAvailable,
  required DateTime now,
  String? excludeId,
  bool forApproval = false,
}) {
  if (unitsAvailable < 1) return const [];
  final reqIn = _dateKey(request['check_in']);
  final reqOut = _dateKey(request['check_out']);
  if (reqIn.isEmpty || reqOut.isEmpty) return const [];

  final overlapping = bookings.where((b) {
    if (excludeId != null && b['id'] == excludeId) return false;
    if (b['accommodation'] != request['accommodation']) return false;
    final status = effectiveStatus(b, now);
    final counts = forApproval
        ? BookingStatuses.committed.contains(status)
        : BookingStatuses.dateHolding.contains(status);
    if (!counts) return false;
    return _datesOverlap(
        reqIn, reqOut, _dateKey(b['check_in']), _dateKey(b['check_out']));
  }).toList();

  if (overlapping.length < unitsAvailable) return const [];
  overlapping.sort(
      (a, b) => _dateKey(a['check_in']).compareTo(_dateKey(b['check_in'])));
  return overlapping;
}

/// How many Bookings an Accommodation can hold at once. Mirrors
/// `src/config/site.ts`: the Main House is one house; camping has two units.
int unitsForAccommodation(String accommodationId) {
  switch (accommodationId) {
    case 'house-a-camping':
      return 2;
    default:
      return 1;
  }
}

// ----------------------------------------------------------------------------
// Money — refund settlement and published rates
// ----------------------------------------------------------------------------

double roundMoney(num amount) => (amount * 100).roundToDouble() / 100;

int nightsBetween(Object? checkIn, Object? checkOut) {
  final a = parseDateOnly(checkIn);
  final b = parseDateOnly(checkOut);
  if (a == null || b == null) return 1;
  final n = b.difference(a).inDays;
  return n < 1 ? 1 : n;
}

class RateCard {
  final double nightlyRate;
  final double securityDeposit;
  final double? downPaymentPercent;
  const RateCard({
    required this.nightlyRate,
    required this.securityDeposit,
    this.downPaymentPercent,
  });
}

class RefundTier {
  final int minDaysBeforeCheckIn;
  final double refundPercent;
  const RefundTier(
      {required this.minDaysBeforeCheckIn, required this.refundPercent});
}

class RefundPolicy {
  final double? refundPercent;
  final List<RefundTier> tiers;
  final double? depositRefundPercent;
  const RefundPolicy(
      {this.refundPercent, this.tiers = const [], this.depositRefundPercent});
}

class RefundSettlement {
  final double stayTotal;
  final double stayRefund;
  final double depositHeld;
  final double damageDeduction;
  final double depositRefund;
  final double refundTotal;
  const RefundSettlement({
    required this.stayTotal,
    required this.stayRefund,
    required this.depositHeld,
    required this.damageDeduction,
    required this.depositRefund,
    required this.refundTotal,
  });

  Map<String, dynamic> toJson() => {
        'stayTotal': stayTotal,
        'stayRefund': stayRefund,
        'depositHeld': depositHeld,
        'damageDeduction': damageDeduction,
        'depositRefund': depositRefund,
        'refundTotal': refundTotal,
      };
}

double _refundPercentFor(RefundPolicy policy, int daysBefore) {
  if (policy.tiers.isEmpty) return policy.refundPercent ?? 0.0;
  final sorted = [...policy.tiers]
    ..sort((a, b) => b.minDaysBeforeCheckIn.compareTo(a.minDaysBeforeCheckIn));
  for (final tier in sorted) {
    if (daysBefore >= tier.minDaysBeforeCheckIn) return tier.refundPercent;
  }
  return 0.0;
}

/// What the Guest gets back on cancellation — same arithmetic as the web's
/// `settleRefund`, so both surfaces show one figure.
RefundSettlement settleRefund({
  required Object? checkIn,
  required Object? checkOut,
  RefundPolicy policy = const RefundPolicy(),
  required DateTime cancelledAt,
  RateCard? rateCard,
  double? stayTotal,
  double? securityDeposit,
  double? verifiedAmount,
  double? damageDeduction,
}) {
  final total = rateCard != null
      ? roundMoney(nightsBetween(checkIn, checkOut) * rateCard.nightlyRate)
      : roundMoney((stayTotal ?? 0) < 0 ? 0 : (stayTotal ?? 0));
  final checkInAt = parseDateOnly(checkIn);
  final int daysBefore = checkInAt == null
      ? 0
      : math.max(
          0,
          (checkInAt.difference(cancelledAt.toUtc()).inMilliseconds /
                  Duration.millisecondsPerDay)
              .ceil());

  final double percent = _refundPercentFor(policy, daysBefore);
  final double depositPercent = policy.depositRefundPercent ?? 100;
  final double depositExpected = rateCard != null
      ? rateCard.securityDeposit
      : math.max(0.0, securityDeposit ?? 0.0);

  final double verified = verifiedAmount ?? (total + depositExpected);
  final double capped =
      math.max(0.0, math.min(verified, total + depositExpected));

  final double depositHeld = roundMoney(math.min(depositExpected, capped));
  final double damage =
      roundMoney(math.max(0.0, math.min(damageDeduction ?? 0.0, depositHeld)));
  final double depositRefund =
      roundMoney((depositHeld - damage) * (depositPercent / 100));
  final double roomForStay = math.max(0.0, capped - depositHeld);
  final double stayRefund =
      roundMoney(math.min(total * (percent / 100), roomForStay));

  return RefundSettlement(
    stayTotal: total,
    stayRefund: stayRefund,
    depositHeld: depositHeld,
    damageDeduction: damage,
    depositRefund: depositRefund,
    refundTotal: roundMoney(stayRefund + depositRefund),
  );
}

/// One problem with a rates document the Admin is about to publish.
class RatesProblem {
  final String path;
  final String message;
  const RatesProblem(this.path, this.message);
  @override
  String toString() => path.isEmpty ? message : '$path $message';
}

/// The Accommodation ids the website lists (`src/config/site.ts`).
const List<String> kKnownAccommodationIds = ['main-house', 'house-a-camping'];

bool _isValidDate(Object? v) {
  if (v is! String) return false;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(v);
  if (m == null) return false;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  if (mo < 1 || mo > 12) return false;
  final firstOfNext = DateTime.utc(y, mo + 1, 1);
  final candidate = DateTime.utc(y, mo, d);
  return d >= 1 && candidate.isBefore(firstOfNext);
}

/// Validate a `site_config/rates` document before publishing — same rules the
/// website applies when it reads one back (`validatePublishedRates`).
List<RatesProblem> validatePublishedRates(Object? doc,
    [List<String>? knownAccommodationIds]) {
  if (doc is! Map) {
    return const [RatesProblem('', 'the rates document must be an object.')];
  }
  final problems = <RatesProblem>[];
  final version = doc['version'];
  if (version is! String || version.trim().isEmpty) {
    problems.add(const RatesProblem(
        'version', 'must name the version this policy is published under.'));
  }
  if (!_isValidDate(doc['effective_date'])) {
    problems.add(const RatesProblem('effective_date',
        'must be the date this version took effect (YYYY-MM-DD).'));
  }
  final acc = doc['accommodations'];
  if (acc is! Map) {
    problems.add(const RatesProblem(
        'accommodations', 'must be an object of Accommodation id → figures.'));
  } else {
    acc.forEach((id, node) {
      final key = id.toString();
      if (knownAccommodationIds != null && !knownAccommodationIds.contains(key)) {
        problems.add(RatesProblem(
            'accommodations.$key', 'is not an Accommodation the site lists.'));
        return;
      }
      if (node is! Map) {
        problems.add(
            RatesProblem('accommodations.$key', 'must be an object of figures.'));
        return;
      }
      final nightly = node['nightly_rate'];
      if (nightly is! num || !nightly.isFinite || nightly <= 0) {
        problems.add(RatesProblem('accommodations.$key.nightly_rate',
            'must be a number of pesos per night, greater than zero.'));
      }
      final deposit = node['security_deposit'];
      if (deposit is! num || !deposit.isFinite || deposit < 0) {
        problems.add(RatesProblem('accommodations.$key.security_deposit',
            'must be a peso amount, zero or more.'));
      }
      if (node.containsKey('down_payment_percent') &&
          node['down_payment_percent'] != null) {
        final dp = node['down_payment_percent'];
        if (dp is! num || !dp.isFinite || dp <= 0 || dp >= 100) {
          problems.add(RatesProblem('accommodations.$key.down_payment_percent',
              'must be a percentage strictly between 0 and 100 (omit it for full payment only).'));
        }
      }
    });
  }
  if (doc.containsKey('refund') && doc['refund'] != null) {
    final refund = doc['refund'];
    if (refund is! Map) {
      problems.add(const RatesProblem(
          'refund', 'must be an object describing the cancellation policy.'));
    } else {
      bool pct(Object? v) => v is num && v.isFinite && v >= 0 && v <= 100;
      if (refund['refund_percent'] != null && !pct(refund['refund_percent'])) {
        problems.add(const RatesProblem(
            'refund.refund_percent', 'must be a percentage from 0 to 100.'));
      }
      if (refund['deposit_refund_percent'] != null &&
          !pct(refund['deposit_refund_percent'])) {
        problems.add(const RatesProblem('refund.deposit_refund_percent',
            'must be a percentage from 0 to 100.'));
      }
      final tiers = refund['tiers'];
      if (tiers != null) {
        if (tiers is! List) {
          problems.add(
              const RatesProblem('refund.tiers', 'must be a list of tiers.'));
        } else {
          for (var i = 0; i < tiers.length; i++) {
            final t = tiers[i];
            if (t is! Map) {
              problems.add(RatesProblem('refund.tiers.$i', 'must be a tier.'));
              continue;
            }
            final minDays = t['min_days_before_check_in'];
            if (minDays is! num || !minDays.isFinite || minDays < 0) {
              problems.add(RatesProblem(
                  'refund.tiers.$i.min_days_before_check_in',
                  'must be a number of days, zero or more.'));
            }
            if (!pct(t['refund_percent'])) {
              problems.add(RatesProblem('refund.tiers.$i.refund_percent',
                  'must be a percentage from 0 to 100.'));
            }
          }
        }
      }
    }
  }
  return problems;
}

/// The rate card and refund policy for one Accommodation out of a published
/// document; null when it has no figures (the action refuses rather than
/// inventing a price).
({RateCard rateCard, RefundPolicy policy})? ratesForAccommodation(
    Map<String, dynamic>? doc, String accommodationId) {
  if (doc == null) return null;
  final acc = doc['accommodations'];
  if (acc is! Map) return null;
  final figures = acc[accommodationId];
  if (figures is! Map) return null;
  final nightly = figures['nightly_rate'];
  final deposit = figures['security_deposit'];
  if (nightly is! num || deposit is! num) return null;
  final dp = figures['down_payment_percent'];
  final refund = doc['refund'];
  RefundPolicy policy = const RefundPolicy();
  if (refund is Map) {
    final tiers = <RefundTier>[];
    final rawTiers = refund['tiers'];
    if (rawTiers is List) {
      for (final t in rawTiers) {
        if (t is Map &&
            t['min_days_before_check_in'] is num &&
            t['refund_percent'] is num) {
          tiers.add(RefundTier(
            minDaysBeforeCheckIn: (t['min_days_before_check_in'] as num).toInt(),
            refundPercent: (t['refund_percent'] as num).toDouble(),
          ));
        }
      }
    }
    policy = RefundPolicy(
      refundPercent: (refund['refund_percent'] as num?)?.toDouble(),
      tiers: tiers,
      depositRefundPercent: (refund['deposit_refund_percent'] as num?)?.toDouble(),
    );
  }
  return (
    rateCard: RateCard(
      nightlyRate: nightly.toDouble(),
      securityDeposit: deposit.toDouble(),
      downPaymentPercent: dp is num ? dp.toDouble() : null,
    ),
    policy: policy,
  );
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

/// Who is acting. The Activity log is worthless without this.
class Actor {
  final String kind; // 'admin' | 'system' | 'guest'
  final String id;
  final String? name;
  const Actor({required this.kind, required this.id, this.name});

  const Actor.admin(this.id, [this.name]) : kind = 'admin';
  const Actor.system() : kind = 'system', id = 'system', name = null;
}

/// Every Admin/system action the app can take. Guest actions (UploadKyc,
/// ChoosePaymentPlan, UploadPaymentProof) belong to the website.
enum AdminAction {
  approve,
  reject,
  rejectKyc,
  verifyPayment,
  rejectPaymentProof,
  cancel,
  markRefunded,
  purgeKyc,
  revokeKey,
  expire,
  checkIn,
  beginStay,
  checkOut,
  complete,
}

extension AdminActionX on AdminAction {
  /// The action name as the Activity log (shared with the web) spells it.
  String get logName {
    switch (this) {
      case AdminAction.approve:
        return 'Approve';
      case AdminAction.reject:
        return 'Reject';
      case AdminAction.rejectKyc:
        return 'RejectKyc';
      case AdminAction.verifyPayment:
        return 'VerifyPayment';
      case AdminAction.rejectPaymentProof:
        return 'RejectPaymentProof';
      case AdminAction.cancel:
        return 'Cancel';
      case AdminAction.markRefunded:
        return 'MarkRefunded';
      case AdminAction.purgeKyc:
        return 'PurgeKyc';
      case AdminAction.revokeKey:
        return 'RevokeKey';
      case AdminAction.expire:
        return 'Expire';
      case AdminAction.checkIn:
        return 'CheckIn';
      case AdminAction.beginStay:
        return 'BeginStay';
      case AdminAction.checkOut:
        return 'CheckOut';
      case AdminAction.complete:
        return 'Complete';
    }
  }

  String get label {
    switch (this) {
      case AdminAction.approve:
        return 'Approve';
      case AdminAction.reject:
        return 'Reject';
      case AdminAction.rejectKyc:
        return 'Reject ID';
      case AdminAction.verifyPayment:
        return 'Verify payment';
      case AdminAction.rejectPaymentProof:
        return 'Reject proof';
      case AdminAction.cancel:
        return 'Cancel';
      case AdminAction.markRefunded:
        return 'Mark refunded';
      case AdminAction.purgeKyc:
        return 'Purge ID';
      case AdminAction.revokeKey:
        return 'Revoke key';
      case AdminAction.expire:
        return 'Expire';
      case AdminAction.checkIn:
        return 'Check in';
      case AdminAction.beginStay:
        return 'Begin stay';
      case AdminAction.checkOut:
        return 'Check out';
      case AdminAction.complete:
        return 'Complete';
    }
  }
}

class _Rule {
  final List<String> actors;
  final List<String> from;
  /// Null means the action records something without moving the Booking.
  final String? to;
  const _Rule(this.actors, this.from, this.to);
}

const Map<AdminAction, _Rule> _rules = {
  AdminAction.approve: _Rule(['admin'], ['KYC Submitted'], 'Approved'),
  AdminAction.reject:
      _Rule(['admin'], ['Pending', 'KYC Submitted', 'Approved'], 'Rejected'),
  AdminAction.rejectKyc: _Rule(['admin'], ['KYC Submitted'], null),
  AdminAction.verifyPayment: _Rule(['admin'], ['Payment Pending'], 'Reserved'),
  AdminAction.rejectPaymentProof: _Rule(['admin'], ['Payment Pending'], null),
  AdminAction.cancel: _Rule(
      ['guest', 'admin'],
      ['Pending', 'KYC Submitted', 'Approved', 'Payment Pending', 'Reserved'],
      'Cancelled'),
  AdminAction.markRefunded: _Rule(['admin'], ['Cancelled'], null),
  AdminAction.purgeKyc:
      _Rule(['admin'], ['Staying', 'Checked-Out', 'Completed'], null),
  AdminAction.revokeKey:
      _Rule(['admin'], ['Reserved', 'Checked-In', 'Staying'], null),
  AdminAction.expire: _Rule(['system'], ['Pending', 'KYC Submitted'], 'Expired'),
  AdminAction.checkIn: _Rule(['system', 'admin'], ['Reserved'], 'Checked-In'),
  AdminAction.beginStay: _Rule(['system', 'admin'], ['Checked-In'], 'Staying'),
  AdminAction.checkOut: _Rule(['system', 'admin'], ['Staying'], 'Checked-Out'),
  AdminAction.complete: _Rule(['admin', 'system'], ['Checked-Out'], 'Completed'),
};

/// The actions that make sense to offer for a Booking in `status`, in the
/// order the detail screen shows them. Availability/facts are checked when
/// the action is applied.
List<AdminAction> adminActionsFor(String status) {
  final canonical = normalizeStatus(status);
  return AdminAction.values
      .where((a) => a != AdminAction.expire)
      .where((a) => _rules[a]!.from.contains(canonical))
      .toList();
}

/// Inputs an action may need. Only the fields relevant to the action are read.
class ActionInput {
  final String? reason;
  final double? amountVerified;
  /// RejectPaymentProof: does the Guest get to resend inside Payment Pending?
  final bool guestResubmits;
  /// Approve: other Bookings stored for the same Accommodation.
  final List<Map<String, dynamic>> otherBookings;
  /// Cancel from Reserved: the published rates document, if any.
  final Map<String, dynamic>? publishedRates;
  final double? damageDeduction;

  const ActionInput({
    this.reason,
    this.amountVerified,
    this.guestResubmits = true,
    this.otherBookings = const [],
    this.publishedRates,
    this.damageDeduction,
  });
}

class ActionResult {
  final bool ok;
  final String? reason;
  /// Fields to merge into the Booking document. Null values mean "clear".
  final Map<String, dynamic> patch;
  /// The Activity log entry to append alongside the patch.
  final Map<String, dynamic>? entry;
  final List<Map<String, dynamic>> conflicts;

  const ActionResult._({
    required this.ok,
    this.reason,
    this.patch = const {},
    this.entry,
    this.conflicts = const [],
  });

  factory ActionResult.refused(String reason,
          [List<Map<String, dynamic>> conflicts = const []]) =>
      ActionResult._(ok: false, reason: reason, conflicts: conflicts);
}

String _join(List<String> values) => values.length == 1
    ? values.first
    : '${values.sublist(0, values.length - 1).join(', ')} or ${values.last}';

String _kyc(Object? raw) {
  switch ((raw ?? 'required').toString().toLowerCase()) {
    case 'submitted':
      return 'submitted';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'required';
  }
}

String _refund(Object? raw) {
  switch ((raw ?? 'none').toString().toLowerCase()) {
    case 'initiated':
      return 'initiated';
    case 'refunded':
      return 'refunded';
    default:
      return 'none';
  }
}

bool _blank(Object? v) => v == null || v.toString().trim().isEmpty;

double _num(Object? v) => v is num ? v.toDouble() : 0;

/// Take one Admin/system action on a Booking (the raw Firestore document map).
///
/// Pure: the map given in is never mutated. An accepted action returns the
/// patch to store and the Activity entry to append; a refused one returns a
/// reason safe to show the Admin.
ActionResult applyAdminAction(
  Map<String, dynamic> booking,
  AdminAction action,
  Actor actor, {
  ActionInput input = const ActionInput(),
  DateTime? now,
}) {
  final rule = _rules[action]!;
  final at = (now ?? DateTime.now()).toUtc();
  final from = normalizeStatus(booking['status']);
  final id = (booking['id'] ?? '').toString();

  if (!rule.actors.contains(actor.kind)) {
    return ActionResult.refused(
        'A ${actor.kind} cannot ${action.logName} a Booking — only ${_join(rule.actors)} can.');
  }

  if (action != AdminAction.expire &&
      !_blank(booking['hold_expires_at']) &&
      effectiveStatus(booking, at) == BookingStatuses.expired) {
    return ActionResult.refused(
        "This Booking's Date hold ran out at ${booking['hold_expires_at']}; it reads as Expired and its dates are free again.");
  }

  if (!rule.from.contains(from)) {
    return ActionResult.refused(
        '${action.logName} needs a Booking in ${_join(rule.from)} — this one is $from.');
  }

  final to = rule.to ?? from;
  if (to != from) {
    final legal = canTransition(from, to) ||
        (from == BookingStatuses.paymentPending &&
            to == BookingStatuses.reserved &&
            canTransition(from, BookingStatuses.paymentVerified) &&
            canTransition(BookingStatuses.paymentVerified, to));
    if (!legal) {
      return ActionResult.refused('A Booking cannot move from $from to $to.');
    }
  }

  final patch = <String, dynamic>{};
  String? reason;

  switch (action) {
    case AdminAction.approve:
      if (_kyc(booking['kyc_status']) != 'submitted') {
        return ActionResult.refused(
            'The Guest has to submit a government ID (KYC) before the Admin can approve.');
      }
      final accommodation = (booking['accommodation'] ?? '').toString();
      final conflicts = findDateConflicts(
        booking,
        input.otherBookings,
        unitsAvailable: unitsForAccommodation(accommodation),
        now: at,
        excludeId: id,
        forApproval: true,
      );
      if (conflicts.isNotEmpty) {
        return ActionResult.refused(
            'These dates are already held by another Booking, so this one cannot be approved. Offer the Guest alternative dates.',
            conflicts);
      }
      patch['kyc_status'] = 'approved';
      patch['hold_expires_at'] = null;
      break;

    case AdminAction.reject:
      if (_blank(input.reason)) {
        return ActionResult.refused(
            'A rejection has to say why, so the Guest knows what to fix.');
      }
      reason = input.reason!.trim();
      patch['rejection_reason'] = reason;
      if (_kyc(booking['kyc_status']) == 'submitted') {
        patch['kyc_status'] = 'rejected';
        patch['kyc_reject_reason'] = reason;
      }
      break;

    case AdminAction.rejectKyc:
      if (_blank(input.reason)) {
        return ActionResult.refused(
            'Say why the ID was refused — a Guest who is not told why cannot send the right one.');
      }
      if (_blank(booking['kyc_id_url'])) {
        return ActionResult.refused(
            'There is no government ID uploaded yet to review.');
      }
      reason = input.reason!.trim();
      patch['kyc_status'] = 'rejected';
      patch['kyc_reject_reason'] = reason;
      break;

    case AdminAction.verifyPayment:
      if (_blank(booking['payment_proof_url'])) {
        return ActionResult.refused('There is no Payment proof to verify yet.');
      }
      final verified = input.amountVerified ?? 0;
      if (!(verified > 0)) {
        return ActionResult.refused(
            'The verified amount has to be more than zero.');
      }
      final owed = roundMoney(
          _num(booking['amount_due']) + _num(booking['security_deposit']));
      if (owed > 0 && verified < owed) {
        return ActionResult.refused(
            'The proof covers $verified but $owed is due — verify only a payment that covers it.');
      }
      patch['payment_status'] = 'verified';
      patch['amount_verified'] = verified;
      break;

    case AdminAction.rejectPaymentProof:
      if (_blank(input.reason)) {
        return ActionResult.refused(
            'Say why the Payment proof was rejected, so the Guest can resend the right one.');
      }
      reason = input.reason!.trim();
      patch['payment_status'] = 'rejected';
      patch['payment_reject_reason'] = reason;
      if (input.guestResubmits) {
        patch['payment_proof_url'] = null;
      } else {
        patch['status'] = BookingStatuses.cancelled;
        patch['refund_status'] = 'none';
      }
      break;

    case AdminAction.cancel:
      reason = _blank(input.reason) ? null : input.reason!.trim();
      patch['cancellation_reason'] = reason;
      if (from == BookingStatuses.reserved) {
        final rates = ratesForAccommodation(
            input.publishedRates, (booking['accommodation'] ?? '').toString());
        final settlement = settleRefund(
          checkIn: booking['check_in'],
          checkOut: booking['check_out'],
          policy: rates?.policy ?? const RefundPolicy(),
          cancelledAt: at,
          rateCard: rates?.rateCard,
          stayTotal: booking['stay_total'] is num
              ? (booking['stay_total'] as num).toDouble()
              : null,
          securityDeposit: booking['security_deposit'] is num
              ? (booking['security_deposit'] as num).toDouble()
              : null,
          verifiedAmount: booking['amount_verified'] is num
              ? (booking['amount_verified'] as num).toDouble()
              : null,
          damageDeduction: input.damageDeduction,
        );
        patch['refund_status'] = 'initiated';
        patch['refund_total'] = settlement.refundTotal;
        patch['refund_breakdown'] = settlement.toJson();
      } else {
        patch['refund_status'] = 'none';
      }
      break;

    case AdminAction.markRefunded:
      if (_refund(booking['refund_status']) != 'initiated') {
        return ActionResult.refused(
            'There is no Refund waiting on this Booking to mark as returned.');
      }
      reason = 'Refund returned to the Guest.';
      patch['refund_status'] = 'refunded';
      break;

    case AdminAction.purgeKyc:
      if (_blank(booking['kyc_id_url']) && _blank(booking['kyc_receipt_url'])) {
        return ActionResult.refused(
            'There is no government ID or receipt left to purge on this Booking.');
      }
      reason =
          'Government ID and receipt purged from Storage after the stay; the URLs are cleared (RA 10173).';
      patch['kyc_id_url'] = null;
      patch['kyc_receipt_url'] = null;
      break;

    case AdminAction.revokeKey:
      reason = 'Credential revoked by the Admin.';
      break;

    case AdminAction.expire:
      if (effectiveStatus(booking, at) != BookingStatuses.expired) {
        return ActionResult.refused(_blank(booking['hold_expires_at'])
            ? 'This Booking has no Date hold recorded, so there is no expiry to write.'
            : "This Booking's Date hold has not run out yet.");
      }
      reason = 'Date hold ran out before the Admin reviewed the Booking.';
      break;

    case AdminAction.checkIn:
    case AdminAction.beginStay:
    case AdminAction.checkOut:
    case AdminAction.complete:
      break;
  }

  final toStatus = patch.containsKey('status')
      ? normalizeStatus(patch['status'])
      : to;
  patch['status'] = toStatus;

  final entry = <String, dynamic>{
    'booking_id': id,
    'action': action.logName,
    'from_status': from,
    'to_status': toStatus,
    'actor': actor.kind,
    'actor_id': actor.id,
    if (actor.name != null) 'actor_name': actor.name,
    'at': at.toIso8601String(),
    if (reason != null) 'reason': reason,
  };

  return ActionResult._(ok: true, patch: patch, entry: entry);
}
