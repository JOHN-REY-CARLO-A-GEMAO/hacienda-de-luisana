import 'package:flutter/material.dart';
import '../constants/app_constants.dart';
import '../../models/booking_model.dart';
import '../../services/booking_lifecycle.dart';

/// One place that decides what a Booking status looks like in the Admin app.
///
/// The same status was coloured by two different `switch` statements — one on
/// the canonical string (`BookingStatuses`, used by the detail screen) and one
/// on the legacy enum (`BookingStatus`, used by the list) — so a Booking could
/// read amber in the queue and green on its own page. Both now resolve here.
///
/// The four groups mirror the Guest website's `StatusBadge`:
/// * **success** — accepted, reserved, or stayed (`statusSuccess`)
/// * **pending** — waiting on the Admin (`statusWarning`)
/// * **in progress** — the stay is happening now (a calm ink blue)
/// * **closed** — finished or ended without a stay (`textMuted` / `statusAlert`)
///
/// Colour is never the only signal: every surface that calls this also prints
/// the status in words through `StatusPill`.
class StatusStyle {
  const StatusStyle._();

  /// A Booking that is happening right now. Not an error and not a success —
  /// the doors are open, and the Admin reads "Checked-In / Staying" from the label.
  static const Color inProgress = Color(0xFF1D3557);

  /// Canonical string status (`BookingStatuses.pending`, `.reserved`, …).
  static Color color(String status) {
    switch (status) {
      case BookingStatuses.pending:
        return AppColors.statusWarning;
      case BookingStatuses.paymentPending:
        return AppColors.accentGoldDark;
      case BookingStatuses.approved:
      case BookingStatuses.paymentVerified:
      case BookingStatuses.reserved:
        return AppColors.statusSuccess;
      case BookingStatuses.checkedIn:
      case BookingStatuses.staying:
        return inProgress;
      case BookingStatuses.checkedOut:
      case BookingStatuses.completed:
        return AppColors.textMuted;
      default:
        // Rejected, Cancelled, Expired — and anything the rules refuse.
        return AppColors.statusAlert;
    }
  }

  /// The legacy model enum, still used by the Bookings list.
  static Color colorForEnum(BookingStatus status) {
    switch (status) {
      case BookingStatus.pending:
        return AppColors.statusWarning;
      case BookingStatus.confirmed:
        return AppColors.statusSuccess;
      case BookingStatus.checkedIn:
        return inProgress;
      case BookingStatus.completed:
        return AppColors.textMuted;
      case BookingStatus.cancelled:
        return AppColors.statusAlert;
    }
  }

  /// Payment verification state: `verified` | `pending` | `rejected` | else.
  static Color payment(String status) {
    switch (status) {
      case 'verified':
        return AppColors.statusSuccess;
      case 'pending':
        return AppColors.statusWarning;
      case 'rejected':
        return AppColors.statusAlert;
      default:
        return AppColors.textMuted;
    }
  }
}
