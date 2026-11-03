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

/// New website Bookings waiting for an approval decision. Approval itself still
/// requires proof and the lifecycle/service checks; membership grants nothing.
bool bookingNeedsApproval(BookingModel booking) =>
    booking.rawStatus == BookingStatuses.pending;

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
bool bookingNeedsAdminAction(BookingModel booking) {
  switch (booking.rawStatus) {
    case BookingStatuses.pending:
    case BookingStatuses.checkedOut:
      return true;
    case BookingStatuses.paymentPending:
      return _hasProof(booking);
    case BookingStatuses.cancelled:
      return booking.refundStatus == 'initiated';
    default:
      return false;
  }
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
      return bookingNeedsAdminAction(booking);
    case BookingListFilter.paymentQueue:
      return bookingNeedsPaymentReview(booking);
    case BookingListFilter.pendingVerification:
      return bookingNeedsApproval(booking);
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
