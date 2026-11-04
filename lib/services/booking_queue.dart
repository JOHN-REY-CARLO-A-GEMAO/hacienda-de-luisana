import '../models/booking_model.dart';
import 'booking_lifecycle.dart';

/// Stable values for the existing booking-list filters. Dashboard queue cards
/// open these same filters, so a count and the list behind it cannot drift into
/// different definitions of the work.
class BookingListFilter {
  BookingListFilter._();

  static const all = 'All';
  static const needsAction = 'Needs action';
  static const paymentQueue = 'Payment Queue';
  static const pendingVerification = 'Pending Verification';
  static const arrivalsToday = 'Arrivals Today';
  static const confirmed = 'Confirmed / Reserved';
  static const activeStay = 'Active Stay';
  static const completed = 'Completed';
  static const closed = 'Cancelled / Rejected';

  // Archive view buckets (ArchivedBookingsScreen). Terminal outcomes, plus a
  // derived no-show bucket — the lifecycle stores no "No-show" status, so
  // that one is computed from dates, never written to the document.
  static const archivedCompleted = 'Archived · Completed';
  static const archivedCancelled = 'Archived · Cancelled';
  static const archivedExpired = 'Archived · Expired';
  static const archivedRejected = 'Archived · Rejected';
  static const archivedNoShow = 'Archived · No-show';
  static const archived = [
    archivedCompleted,
    archivedCancelled,
    archivedExpired,
    archivedRejected,
    archivedNoShow,
  ];
}

bool _hasProof(BookingModel booking) =>
    booking.paymentProofUrl != null && booking.paymentProofUrl!.trim().isNotEmpty;

/// True once the 24-hour Date hold on a Pending Booking has run out.
///
/// The stored status stays `Pending` until the Admin records the expiry, but
/// every decision surface reads it as `Expired` — which means the Booking is no
/// longer waiting on the Admin at all: the dates are released and the Guest sees
/// an expired request. Counting it as approval work (and again as an "Other
/// admin action") asks the Admin to decide something the lifecycle refuses and
/// makes the dashboard claim work that does not exist.
///
/// Only a *recorded* expiry counts, matching `adminActionBlockedReason` on the
/// website: a Booking stored before Date holds existed has no countdown to run
/// out, and hiding it would strand it forever. Availability still treats that
/// Booking as holding nothing — that is a different question from whether the
/// Admin still has a decision to make.
bool bookingHoldLapsed(BookingModel booking, DateTime now) {
  if (booking.rawStatus != BookingStatuses.pending) return false;
  final expiresAt = booking.holdExpiresAt;
  if (expiresAt == null) return false;
  return now.toUtc().isAfter(expiresAt.toUtc());
}

/// New website Bookings waiting for an approval decision. Approval itself still
/// requires proof and the lifecycle/service checks; membership grants nothing.
///
/// A Pending whose Date hold has run out is excluded: it reads as Expired
/// everywhere else, so it belongs in the archive, not in the queue.
bool bookingNeedsApproval(BookingModel booking, [DateTime? now]) =>
    booking.rawStatus == BookingStatuses.pending &&
    !bookingHoldLapsed(booking, now ?? DateTime.now());

/// Approved or reserved stays whose recorded check-in day is today.
bool bookingArrivesToday(BookingModel booking, DateTime now) {
  final date = booking.checkInDate;
  final isToday = date.year == now.year && date.month == now.month && date.day == now.day;
  return isToday &&
      (booking.rawStatus == BookingStatuses.approved ||
          booking.rawStatus == BookingStatuses.reserved);
}

/// Guests whose actual stay has started, not merely a future approved date.
bool bookingIsCurrentGuest(BookingModel booking) =>
    booking.rawStatus == BookingStatuses.checkedIn ||
    booking.rawStatus == BookingStatuses.staying;

/// A real submitted proof awaiting an Admin decision. A Payment Pending Booking
/// with no proof is waiting on the Guest, not on payment review.
bool bookingNeedsPaymentReview(BookingModel booking) {
  final pendingReview = booking.rawStatus == BookingStatuses.pending ||
      booking.rawStatus == BookingStatuses.paymentPending;
  return pendingReview &&
      _hasProof(booking) &&
      booking.paymentStatus?.toLowerCase() != 'verified';
}

/// Bookings waiting on the Admin, using the canonical stored lifecycle state.
///
/// This is the Bookings "Needs action" chip: one working list holding every
/// thing the Admin still has to decide — approve, verify a payment, close a
/// checked-out stay, pay out a refund. The dashboard prints those as separate
/// rows ([bookingNeedsApproval], [bookingNeedsPaymentReview] and
/// [bookingIsUnattended]) and only prints the part nothing else owns, so a
/// Booking is never counted twice on the page.
bool bookingNeedsAdminAction(BookingModel booking, [DateTime? now]) {
  final at = now ?? DateTime.now();
  switch (booking.rawStatus) {
    case BookingStatuses.pending:
      // Still-owned work: a Pending whose Date hold lapsed is Expired
      // everywhere else, so it is not waiting on the Admin any more.
      return !bookingHoldLapsed(booking, at);
    case BookingStatuses.paymentPending:
      return _hasProof(booking);
    case BookingStatuses.checkedOut:
      return true;
    case BookingStatuses.cancelled:
      return booking.refundStatus == 'initiated';
    default:
      return false;
  }
}

/// The part of the "Needs action" list no other dashboard row owns: closing a
/// checked-out stay and paying out an initiated refund.
///
/// Approvals and payment review each have a row of their own above the "Other
/// admin actions" row. Counting them again there made the dashboard read
/// "7 payments to verify" and "8 other admin actions" for the same seven
/// screenshots — and a lapsed Pending counted as the admin's work when the
/// dates had already been released.
bool bookingIsUnattended(BookingModel booking) {
  switch (booking.rawStatus) {
    case BookingStatuses.checkedOut:
      return true;
    case BookingStatuses.cancelled:
      return booking.refundStatus == 'initiated';
    default:
      return false;
  }
}

/// The one decision a Booking is waiting on, as a row the dashboard can list.
///
/// The queues are five overlapping questions — an approval with a proof answers
/// "approve" *and* "verify payment" — so a page that prints one row per queue
/// prints the same Guest twice, with the same next step, under two headings.
/// This collapses a Booking to the single next action, in lifecycle order:
/// approve it, or verify the payment, or close the stay, or pay out the refund.
/// Each row therefore names one Booking once, and every Booking the working
/// queue contains appears exactly once.
String? bookingQueueAction(BookingModel booking, DateTime now) {
  if (bookingNeedsApproval(booking, now)) return BookingListFilter.pendingVerification;
  if (bookingNeedsPaymentReview(booking)) return BookingListFilter.paymentQueue;
  if (bookingIsUnattended(booking)) return BookingListFilter.needsAction;
  return null;
}

/// Derived no-show: the dates were committed (Approved / Payment Verified /
/// Reserved) but the recorded check-in day has passed with no check-in ever
/// recorded. The lifecycle has no stored "No-show" status, so this bucket is
/// computed from the dates and never written to the document.
bool bookingIsNoShow(BookingModel booking, DateTime now) {
  final committedPreStay = booking.rawStatus == BookingStatuses.approved ||
      booking.rawStatus == BookingStatuses.paymentVerified ||
      booking.rawStatus == BookingStatuses.reserved;
  if (!committedPreStay) return false;
  final today = DateTime(now.year, now.month, now.day);
  return booking.checkInDate.isBefore(today);
}

bool bookingMatchesFilter(BookingModel booking, String filter, DateTime now) {
  switch (filter) {
    case BookingListFilter.archivedCompleted:
      return booking.rawStatus == BookingStatuses.completed;
    case BookingListFilter.archivedCancelled:
      return booking.rawStatus == BookingStatuses.cancelled;
    case BookingListFilter.archivedExpired:
      // A Pending whose 24-hour Date hold ran out reads as Expired on every
      // surface, even before the Admin records the expiry.
      return booking.rawStatus == BookingStatuses.expired ||
          effectiveStatus(booking.toLifecycleDoc(), now) == BookingStatuses.expired;
    case BookingListFilter.archivedRejected:
      return booking.rawStatus == BookingStatuses.rejected;
    case BookingListFilter.archivedNoShow:
      return bookingIsNoShow(booking, now);
    case BookingListFilter.needsAction:
      return bookingNeedsAdminAction(booking, now);
    case BookingListFilter.paymentQueue:
      return bookingNeedsPaymentReview(booking);
    case BookingListFilter.pendingVerification:
      return bookingNeedsApproval(booking, now);
    case BookingListFilter.arrivalsToday:
      return bookingArrivesToday(booking, now);
    case BookingListFilter.confirmed:
      return booking.rawStatus == BookingStatuses.approved ||
          booking.rawStatus == BookingStatuses.reserved ||
          booking.rawStatus == BookingStatuses.paymentVerified;
    case BookingListFilter.activeStay:
      return bookingIsCurrentGuest(booking);
    case BookingListFilter.completed:
      return booking.rawStatus == BookingStatuses.completed ||
          booking.rawStatus == BookingStatuses.checkedOut;
    case BookingListFilter.closed:
      return booking.rawStatus == BookingStatuses.cancelled ||
          booking.rawStatus == BookingStatuses.rejected ||
          booking.rawStatus == BookingStatuses.expired;
    case BookingListFilter.all:
    default:
      return true;
  }
}

String bookingFilterLabel(String filter) {
  switch (filter) {
    case BookingListFilter.needsAction:
      return 'Nangangailangan ng Aksyon';
    case BookingListFilter.paymentQueue:
      return 'Bayad na Susuriin';
    case BookingListFilter.pendingVerification:
      return 'Kailangang Aprubahan';
    case BookingListFilter.arrivalsToday:
      return 'Darating Ngayon';
    case BookingListFilter.confirmed:
      return 'Kumpirmado / Reserved';
    case BookingListFilter.activeStay:
      return 'Kasalukuyang Bisita';
    case BookingListFilter.completed:
      return 'Tapos na';
    case BookingListFilter.closed:
      return 'Kanselado / Tinanggihan';
    case BookingListFilter.archivedCompleted:
      return 'Tapos na · Completed';
    case BookingListFilter.archivedCancelled:
      return 'Kanselado · Cancelled';
    case BookingListFilter.archivedExpired:
      return 'Nag-expire · Expired';
    case BookingListFilter.archivedRejected:
      return 'Tinanggihan · Rejected';
    case BookingListFilter.archivedNoShow:
      return 'No-show · Walang dumating';
    case BookingListFilter.all:
    default:
      return 'Lahat ng Booking';
  }
}
