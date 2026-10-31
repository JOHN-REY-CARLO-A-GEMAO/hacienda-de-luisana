import '../models/booking_model.dart';
import '../models/guest_crm_model.dart';
import 'booking_lifecycle.dart';

/// Builds the Admin's guest directory from booking history plus optional
/// profile-only fields (VIP and private notes).
///
/// `guest_profiles` is an enrichment store, not the source of guest identity.
/// A newly created Booking is already sufficient to make a Guest appear here;
/// an empty profiles collection must not hide guests who have booked.
List<GuestCrmModel> aggregateGuestRecords({
  required List<GuestCrmModel> profiles,
  required List<BookingModel> bookings,
}) {
  String identity(BookingModel booking) {
    final uid = booking.uid?.trim() ?? '';
    if (uid.isNotEmpty) return 'uid:$uid';
    final email = booking.guestEmail.trim().toLowerCase();
    if (email.isNotEmpty) return 'email:$email';
    final phone = booking.guestPhone.replaceAll(RegExp(r'\D'), '');
    if (phone.isNotEmpty) return 'phone:$phone';
    final name = booking.guestName.trim().toLowerCase();
    return name.isNotEmpty ? 'name:$name' : 'booking:${booking.id}';
  }

  final groups = <String, List<BookingModel>>{};
  for (final booking in bookings) {
    groups.putIfAbsent(identity(booking), () => []).add(booking);
  }

  final records = <String, GuestCrmModel>{
    for (final profile in profiles) profile.id: profile,
  };

  for (final entry in groups.entries) {
    final group = entry.value..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final newest = group.first;
    final uid = newest.uid?.trim() ?? '';
    final email = newest.guestEmail.trim().toLowerCase();
    final phone = newest.guestPhone.replaceAll(RegExp(r'\D'), '');
    GuestCrmModel? profile;
    for (final candidate in profiles) {
      if ((uid.isNotEmpty && candidate.id == uid) ||
          (email.isNotEmpty && candidate.email.trim().toLowerCase() == email) ||
          (phone.isNotEmpty && candidate.phone.replaceAll(RegExp(r'\D'), '') == phone)) {
        profile = candidate;
        break;
      }
    }

    var lifetimeValue = 0.0;
    var hasCompletedFinancialHistory = false;
    DateTime? lastCompletedStay;
    for (final booking in group) {
      if (booking.rawStatus == BookingStatuses.completed ||
          booking.rawStatus == BookingStatuses.reserved ||
          booking.rawStatus == BookingStatuses.checkedIn ||
          booking.rawStatus == BookingStatuses.staying) {
        lifetimeValue += booking.totalAmount;
        hasCompletedFinancialHistory = true;
      }
      if (booking.rawStatus == BookingStatuses.completed &&
          (lastCompletedStay == null || booking.checkOutDate.isAfter(lastCompletedStay))) {
        lastCompletedStay = booking.checkOutDate;
      }
    }

    final id = profile?.id ?? (uid.isNotEmpty ? uid : newest.id);
    final savedName = profile?.name.trim() ?? '';
    final savedPhone = profile?.phone.trim() ?? '';
    final savedEmail = profile?.email.trim() ?? '';
    records[id] = GuestCrmModel(
      id: id,
      name: savedName.isNotEmpty ? savedName : newest.guestName,
      phone: savedPhone.isNotEmpty ? savedPhone : newest.guestPhone,
      email: savedEmail.isNotEmpty ? savedEmail : newest.guestEmail,
      totalBookings: group.length,
      lifetimeRevenue: hasCompletedFinancialHistory
          ? lifetimeValue
          : profile?.lifetimeRevenue ?? 0.0,
      isVip: profile?.isVip ?? false,
      notes: profile?.notes ?? '',
      lastStayDate: lastCompletedStay ?? profile?.lastStayDate,
    );
  }

  return records.values.toList();
}
