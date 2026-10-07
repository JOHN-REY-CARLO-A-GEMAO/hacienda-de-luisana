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

import 'accommodations.dart';

// Re-exported so callers importing this module keep working: how many Bookings
// an Accommodation can hold at once, and the canonical Accommodation it reads.
export 'accommodations.dart' show Accommodation, unitsForAccommodation;
// ----------------------------------------------------------------------------

import 'dart:math' as math;

import 'review_policy.dart';

/// The canonical Booking statuses, in lifecycle order, then the terminal
/// branches (CONTEXT.md § Booking status). `Confirmed` is retired: the paid
/// state used to be `Reserved`. `Approved` is the confirmation written when
/// the Admin accepts a downpayment screenshot (ADR-0012).
class BookingStatuses {
  BookingStatuses._();

  static const String pending = 'Pending';
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
  static const List<String> expirable = [pending];

  static const List<String> terminal = [completed, rejected, cancelled, expired];
}

/// The legal transitions out of each status. A whitelist: anything missing is
/// refused, so no surface can shortcut past review or payment verification.
const Map<String, List<String>> kTransitions = {
  // ADR-0012: the Admin accepts the downpayment screenshot, or declines it.
  'Pending': ['Approved', 'Rejected', 'Cancelled', 'Expired'],
  'Approved': ['Checked-In', 'Cancelled'],
  // Historical bookings opened for payment before the downpayment-first change.
  'Payment Pending': ['Payment Verified', 'Rejected', 'Cancelled'],
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
  // Retired with Government ID KYC: pre-review documents read as `Pending`.
  'kycsubmitted': BookingStatuses.pending,
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

/// A stored `Approved` that never had a verified screenshot reads as
/// `Payment Pending` — the successor it meant before ADR-0012. New writes
/// always carry the proof and the marker, so they stay `Approved`.
String interpretStoredStatus(
  Object? stored, {
  String? paymentStatus,
  String? paymentProofUrl,
}) {
  final normalized = normalizeStatus(stored);
  if (stored == null || _fold(stored.toString()) != 'approved') return normalized;
  final proven =
      (paymentProofUrl ?? '').trim().isNotEmpty && paymentStatus == 'verified';
  return proven ? BookingStatuses.approved : BookingStatuses.paymentPending;
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

/// Today's calendar date in Philippine Time (UTC+8).
String manilaDateOnly(DateTime at) {
  final m = at.toUtc().add(const Duration(hours: 8));
  final y = m.year.toString().padLeft(4, '0');
  final mo = m.month.toString().padLeft(2, '0');
  final d = m.day.toString().padLeft(2, '0');
  return '$y-$mo-$d';
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

/// How many Bookings an Accommodation can hold at once.
///
/// [unitsForAccommodation] in `accommodations.dart` answers this from the
/// published `available_units`. It used to be a `switch` in this file returning
/// a hardcoded 2 for camping and 1 for everything else — a second answer to a
/// question the published document also answered, in a file that could not see
/// it.

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
  final total = stayTotal != null
      ? roundMoney(math.max(0, stayTotal))
      : rateCard != null
          ? roundMoney(nightsBetween(checkIn, checkOut) * rateCard.nightlyRate)
          : 0.0;
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
  final double depositExpected = securityDeposit != null
      ? math.max(0.0, securityDeposit)
      : rateCard?.securityDeposit ?? 0.0;

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

/// Recover a stay total only from financial values already on the Booking.
/// Never substitute the currently published rate for a missing old snapshot.
double? recordedStayTotal(Map<String, dynamic> booking) {
  final stayTotal = booking['stay_total'];
  if (stayTotal is num && stayTotal.isFinite) {
    return roundMoney(math.max(0, stayTotal.toDouble()));
  }
  final legacyTotal = booking['total_amount'];
  if (legacyTotal is num && legacyTotal.isFinite) {
    return roundMoney(math.max(0, legacyTotal.toDouble()));
  }
  final rateAmount = booking['rate_amount'];
  if (rateAmount is! num || !rateAmount.isFinite || rateAmount < 0) return null;
  if (booking['rate_unit'] == 'standard_stay') return roundMoney(rateAmount.toDouble());
  if (booking['rate_unit'] == 'night') {
    final storedNights = booking['nights'];
    final nights = storedNights is num && storedNights > 0
        ? storedNights.toInt()
        : nightsBetween(booking['check_in'], booking['check_out']);
    if (nights > 0) return roundMoney(rateAmount * nights);
  }
  return null;
}

/// One problem with a rates document the Admin is about to publish.
class RatesProblem {
  final String path;
  final String message;
  const RatesProblem(this.path, this.message);
  @override
  String toString() => path.isEmpty ? message : '$path $message';
}

/// The canonical Accommodation ids.
///
/// There is deliberately no list here. It used to be
/// `['main-house', 'annex', 'house-a-camping']`, a hand-copy of the website's
/// `src/config/site.ts` that nothing kept in step: the app went on publishing an
/// A-House the rules refused.
///
/// The set is the published rates document's own keys, and
/// `firestore.rules` `validPublishedAccommodations()` is where the three ids are
/// now written down — it names them one by one and requires exactly those three,
/// so a document naming a fourth or dropping the Annex never reaches either app.
/// Pass `knownAccommodationIds: null` (the default) to validate a document
/// against its own shape.
const List<String>? kKnownAccommodationIds = null;

/// The canonical Accommodation ids a published document is checked against.
///
/// Null when there is no published document to check against — see
/// [kKnownAccommodationIds]. Reads `Accommodation.fromRatesDocument`.
List<String>? knownAccommodationIdsFrom(Object? ratesDocument) {
  final parsed = Accommodation.fromRatesDocument(ratesDocument);
  return parsed?.map((a) => a.id).toList();
}

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

void _validateGuestSchedule(
    Object? value, String path, List<RatesProblem> problems,
    {required bool allowDocumentedCap, required bool requireExcess}) {
  if (value is! Map) {
    problems.add(RatesProblem(path, 'must be a guest-count schedule.'));
    return;
  }
  bool positiveInt(Object? v) => v is int && v > 0;
  if (!positiveInt(value['min_guests'])) {
    problems.add(RatesProblem('$path.min_guests', 'must be a positive whole number.'));
  } else if (value['min_guests'] != 1) {
    problems.add(RatesProblem('$path.min_guests', 'must be 1; base occupancy is not a minimum booking size.'));
  }
  if (!positiveInt(value['base_max_guests'])
      || (value['base_max_guests'] as int? ?? 0) < 1) {
    problems.add(RatesProblem('$path.base_max_guests', 'must be a positive whole-number included occupancy.'));
  }
  if (value['base_rate'] is! num || !(value['base_rate'] as num).isFinite
      || (value['base_rate'] as num) <= 0) {
    problems.add(RatesProblem('$path.base_rate', 'must be a positive peso amount.'));
  }
  if (value.containsKey('max_guests')) {
    if (!allowDocumentedCap) {
      problems.add(RatesProblem('$path.max_guests', 'is not supported without a separately documented physical/safety limit.'));
    } else if (!positiveInt(value['max_guests'])
        || (value['max_guests'] as int? ?? 0) < (value['base_max_guests'] as int? ?? 1)) {
      problems.add(RatesProblem('$path.max_guests', 'must be a whole-number cap at or above base_max_guests.'));
    }
  }
  if (requireExcess && !value.containsKey('excess_per_guest')) {
    problems.add(RatesProblem('$path.excess_per_guest', 'is required when there is no absolute guest cap.'));
  } else if (!requireExcess && value.containsKey('excess_per_guest')) {
    problems.add(RatesProblem('$path.excess_per_guest', 'A-House is a flat per-unit amount through its documented three-guest maximum.'));
  } else if (value.containsKey('excess_per_guest')
      && (value['excess_per_guest'] is! num
          || !(value['excess_per_guest'] as num).isFinite
          || (value['excess_per_guest'] as num) < 0)) {
    problems.add(RatesProblem('$path.excess_per_guest', 'must be a non-negative per-person peso amount.'));
  }
  for (final retired in ['upper_min_guests', 'upper_max_guests', 'upper_rate', 'excess_after']) {
    if (value.containsKey(retired)) {
      problems.add(RatesProblem('$path.$retired', 'is retired; use base_rate plus excess_per_guest.'));
    }
  }
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
      if (node.containsKey('property_name') &&
          (node['property_name'] is! String ||
              (node['property_name'] as String).trim().isEmpty)) {
        problems.add(RatesProblem('accommodations.$key.property_name',
            'must be a non-empty property name.'));
      }
      if (node.containsKey('nightly_rate')) {
        problems.add(RatesProblem('accommodations.$key.nightly_rate',
            'legacy flat nightly pricing cannot be published for new bookings; use guest_pricing.'));
      }
      // Physical inventory: units the estate holds at once. Distinct from
      // `units_per_booking`, which is how many units one Booking takes — the
      // A-House publishes 2 and 1.
      final availableUnits = node['available_units'];
      if (node.containsKey('available_units') &&
          (availableUnits is! int || availableUnits < 1)) {
        problems.add(RatesProblem('accommodations.$key.available_units',
            'must be a whole number of units, at least 1.'));
      }
      if (node['rate_unit'] != 'standard_stay') {
        problems.add(RatesProblem('accommodations.$key.rate_unit',
            'new guest-count prices must use the standard_stay rate unit.'));
      }
      final guestPricing = node['guest_pricing'];
      if (guestPricing is! Map) {
        problems.add(RatesProblem('accommodations.$key.guest_pricing',
            'must publish weekday and weekend_holiday guest-count schedules.'));
      } else {
        if (guestPricing['units_per_booking'] != null && guestPricing['units_per_booking'] != 1) {
          problems.add(RatesProblem('accommodations.$key.guest_pricing.units_per_booking',
              'must be 1 until quantity booking is defined.'));
        }
        final allowCap = key == 'house-a-camping';
        final weekdayPath = 'accommodations.$key.guest_pricing.weekday';
        final weekendPath = 'accommodations.$key.guest_pricing.weekend_holiday';
        _validateGuestSchedule(guestPricing['weekday'], weekdayPath, problems,
            allowDocumentedCap: allowCap, requireExcess: !allowCap);
        _validateGuestSchedule(guestPricing['weekend_holiday'], weekendPath, problems,
            allowDocumentedCap: allowCap, requireExcess: !allowCap);
        if (allowCap) {
          for (final schedule in [guestPricing['weekday'], guestPricing['weekend_holiday']]) {
            if (schedule is Map && (schedule['base_max_guests'] != 3 || schedule['max_guests'] != 3)) {
              problems.add(RatesProblem('accommodations.$key.guest_pricing',
                  'A-House is one unit per booking, with an included and absolute maximum of 3 guests.'));
              break;
            }
          }
        }
      }
      if (node.containsKey('active') && node['active'] is! bool) {
        problems.add(RatesProblem('accommodations.$key.active',
            'must be true or false.'));
      }
      final deposit = node['security_deposit'];
      if (deposit is! num || !deposit.isFinite || deposit < 0) {
        problems.add(RatesProblem('accommodations.$key.security_deposit',
            'must be a peso amount, zero or more.'));
      }
      if (node.containsKey('reservation_fee_amount')) {
        problems.add(RatesProblem('accommodations.$key.reservation_fee_amount',
            'fixed reservation fees are not accepted; the down payment is 50% of the computed stay total.'));
      }
      final dp = node['down_payment_percent'];
      if (dp is! num || !dp.isFinite || dp != 50) {
        problems.add(RatesProblem('accommodations.$key.down_payment_percent',
            'must be 50; the remaining 50% is due at check-in.'));
      }
    });
  }
  final dates = doc['holiday_dates'];
  if (dates is! List || dates.any((date) => !_isValidDate(date)) || dates.toSet().length != dates.length) {
    problems.add(const RatesProblem('holiday_dates',
        'must contain an explicit, unique Admin-maintained list of YYYY-MM-DD dates (use [] when none are configured).'));
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

/// Read the published cancellation terms independently of any legacy rate
/// card; the current guest-count schedules do not need to fabricate one.
RefundPolicy refundPolicyFromPublished(Object? ratesDocument) {
  final refund = ratesDocument is Map ? ratesDocument['refund'] : null;
  return refundPolicyFromSnapshot(refund);
}

/// Parse the exact snake-case refund policy captured on a Booking.
RefundPolicy refundPolicyFromSnapshot(Object? snapshot) {
  if (snapshot is! Map) return const RefundPolicy();
  final tiers = <RefundTier>[];
  final rawTiers = snapshot['tiers'];
  if (rawTiers is List) {
    for (final t in rawTiers) {
      if (t is Map && t['min_days_before_check_in'] is num && t['refund_percent'] is num) {
        tiers.add(RefundTier(
          minDaysBeforeCheckIn: (t['min_days_before_check_in'] as num).toInt(),
          refundPercent: (t['refund_percent'] as num).toDouble(),
        ));
      }
    }
  }
  return RefundPolicy(
    refundPercent: snapshot['refund_percent'] is num
        ? (snapshot['refund_percent'] as num).toDouble()
        : null,
    tiers: tiers,
    depositRefundPercent: snapshot['deposit_refund_percent'] is num
        ? (snapshot['deposit_refund_percent'] as num).toDouble()
        : null,
  );
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
  final policy = refundPolicyFromPublished(doc);
  return (
    rateCard: RateCard(
      nightlyRate: nightly.toDouble(),
      securityDeposit: deposit.toDouble(),
      downPaymentPercent: dp is num ? dp.toDouble() : null,
    ),
    policy: policy,
  );
}

/// Has this Booking reached the point where a Guest may review it?
///
/// A Review is about a stay that happened, so the answer is the same one
/// `firestore.rules` gives when it reads the Booking behind a Review: the stay
/// is `Checked-Out` or `Completed`, and a terminal branch — Rejected, Cancelled,
/// Expired — is a request that ended rather than a stay. Mirrored from
/// `src/lib/booking` on the website so the two never drift.
bool isReviewableBookingStatus(String? status) => isReviewableStatus(status);

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

/// Every Admin/system action the app can take. Guest actions
/// (ChoosePaymentPlan, UploadPaymentProof) belong to the website.
enum AdminAction {
  approve,
  reject,
  verifyPayment,
  rejectPaymentProof,
  cancel,
  markRefunded,
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
      case AdminAction.verifyPayment:
        return 'VerifyPayment';
      case AdminAction.rejectPaymentProof:
        return 'RejectPaymentProof';
      case AdminAction.cancel:
        return 'Cancel';
      case AdminAction.markRefunded:
        return 'MarkRefunded';
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
      case AdminAction.verifyPayment:
        return 'Verify payment';
      case AdminAction.rejectPaymentProof:
        return 'Reject proof';
      case AdminAction.cancel:
        return 'Cancel';
      case AdminAction.markRefunded:
        return 'Mark refunded';
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
  // Accepting the downpayment screenshot confirms the Booking (ADR-0012).
  AdminAction.approve: _Rule(['admin'], ['Pending'], 'Approved'),
  AdminAction.reject:
      _Rule(['admin'], ['Pending', 'Payment Pending'], 'Rejected'),
  AdminAction.verifyPayment: _Rule(['admin'], ['Payment Pending'], 'Reserved'),
  AdminAction.rejectPaymentProof: _Rule(['admin'], ['Payment Pending'], null),
  AdminAction.cancel: _Rule(['guest', 'admin'],
      ['Pending', 'Approved', 'Payment Pending', 'Reserved'], 'Cancelled'),
  AdminAction.markRefunded: _Rule(['admin'], ['Cancelled'], null),
  AdminAction.revokeKey:
      _Rule(['admin'], ['Approved', 'Reserved', 'Checked-In', 'Staying'], null),
  AdminAction.expire: _Rule(['system'], ['Pending'], 'Expired'),
  AdminAction.checkIn:
      _Rule(['system', 'admin'], ['Approved', 'Reserved'], 'Checked-In'),
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

/// Why this action cannot be taken on this Booking right now, or null when it can.
///
/// The same conditions [applyAdminAction] refuses on, read without writing.
/// [adminActionsFor] is given a status and nothing else, so it cannot know that
/// a `Payment Pending` Booking has no proof behind it yet: on status alone,
/// Verify is offered for every Payment Pending Booking, and pressing it is
/// refused. A screen that offers an action the lifecycle will refuse is a screen
/// that lies, which is the same failure as an allowlist the rules do not share.
String? adminActionBlockedReason(
    Map<String, dynamic> booking, AdminAction action) {
  if (action == AdminAction.approve) {
    if (_blank(booking['payment_proof_url']) &&
        _blank(booking['paymentProofUrl'])) {
      return 'A downpayment screenshot has to be attached before this Booking can be approved.';
    }
    final claimed = _num(booking['amount_claimed']);
    if (!(claimed > 0)) {
      return 'The downpayment amount on the proof has to be more than zero before it can be approved.';
    }
    return null;
  }
  if (action == AdminAction.beginStay) {
    final checkInStr = _dateKey(booking['check_in']);
    final todayPht = manilaDateOnly(DateTime.now());
    if (checkInStr.isNotEmpty && todayPht.compareTo(checkInStr) < 0) {
      return 'Begin Stay is allowed starting on the check-in date ($checkInStr). Today in the Philippines is $todayPht.';
    }
    return null;
  }
  if (action != AdminAction.verifyPayment) return null;
  if (_blank(booking['payment_proof_url'])) {
    return 'There is no Payment proof to verify yet.';
  }
  return null;
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
      final blocked =
          adminActionBlockedReason(booking, AdminAction.approve);
      if (blocked != null) return ActionResult.refused(blocked);
      final claimed = _num(booking['amount_claimed']);
      final owed = _num(booking['amount_due']);
      if (owed > 0 && claimed < owed) {
        return ActionResult.refused(
            'The proof covers $claimed but $owed is due — approve only a downpayment that covers it.');
      }
      final accommodation = (booking['accommodation'] ?? '').toString();
      // The unit count comes from the published rates document, which is where
      // the Admin states an Accommodation's physical inventory. Absent a
      // published count this is one unit, which refuses rather than overbooks.
      final conflicts = findDateConflicts(
        booking,
        input.otherBookings,
        unitsAvailable: unitsForAccommodation(
            accommodation, Accommodation.fromRatesDocument(input.publishedRates) ?? const []),
        now: at,
        excludeId: id,
        forApproval: true,
      );
      if (conflicts.isNotEmpty) {
        return ActionResult.refused(
            'These dates are already held by another Booking, so this one cannot be approved. Offer the Guest alternative dates.',
            conflicts);
      }
      // Approval accepts the screenshot and firms the dates in one decision.
      patch['hold_expires_at'] = null;
      patch['payment_status'] = 'verified';
      patch['amount_verified'] = claimed;
      patch['payment_verified_at'] = at.toIso8601String();
      patch['payment_verified_by'] = actor.id;
      break;

    case AdminAction.reject:
      if (_blank(input.reason)) {
        return ActionResult.refused(
            'A rejection has to say why, so the Guest knows what to fix.');
      }
      reason = input.reason!.trim();
      patch['rejection_reason'] = reason;
      patch['payment_status'] = 'rejected';
      break;

    case AdminAction.verifyPayment:
      final blocked =
          adminActionBlockedReason(booking, AdminAction.verifyPayment);
      if (blocked != null) return ActionResult.refused(blocked);
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
      // The marker that makes the claim checkable, and the one the rules
      // require of a `verified` document: an instant, and the verifier's own
      // uid (firestore.rules `hasVerificationMarker()`). The website's
      // `applyAction` writes the same four fields — the two must not drift.
      patch['payment_verified_at'] = at.toIso8601String();
      patch['payment_verified_by'] = actor.id;
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
      if (from == BookingStatuses.reserved ||
          (from == BookingStatuses.approved &&
              booking['payment_status'] == 'verified')) {
        final policy = booking.containsKey('refund_policy_snapshot')
            ? refundPolicyFromSnapshot(booking['refund_policy_snapshot'])
            : refundPolicyFromPublished(input.publishedRates);
        final settlement = settleRefund(
          checkIn: booking['check_in'],
          checkOut: booking['check_out'],
          policy: policy,
          cancelledAt: at,
          // Refund from the total/deposit already recorded, not today's rate
          // card. Missing legacy snapshots stay missing rather than being
          // recalculated under a later publication.
          stayTotal: recordedStayTotal(booking),
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
      break;

    case AdminAction.beginStay:
      final checkInStr = _dateKey(booking['check_in']);
      final todayPht = manilaDateOnly(at);
      if (checkInStr.isNotEmpty && todayPht.compareTo(checkInStr) < 0) {
        return ActionResult.refused(
            'Begin Stay is not allowed before the check-in date ($checkInStr). Today in the Philippines is $todayPht.');
      }
      break;

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
