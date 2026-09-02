import 'package:flutter/foundation.dart';
import '../models/booking.dart';

class BookingStore extends ChangeNotifier {
  Booking? _currentBooking;

  BookingStore() {
    // Demo seed booking for seamless testing
    _currentBooking = Booking(
      referenceId: 'HDL-9824',
      guestName: 'Guest User',
      phone: '+639258507707',
      accommodationTitle: 'Main House Villa',
      checkInDate: DateTime.now().add(const Duration(days: 1)),
      checkOutDate: DateTime.now().add(const Duration(days: 3)),
      guestCount: 6,
      notes: 'Quiet luxury stay request',
      status: 'confirmed', // Initial state confirmed for prototype test
    );
  }

  Booking? get currentBooking => _currentBooking;

  bool get isConfirmed =>
      _currentBooking != null &&
      (_currentBooking!.status == 'confirmed' || _currentBooking!.status == 'checkedIn');

  bool get isCheckedIn =>
      _currentBooking != null && _currentBooking!.status == 'checkedIn';

  void setBooking(Booking booking) {
    _currentBooking = booking;
    notifyListeners();
  }

  void confirm() {
    if (_currentBooking != null) {
      _currentBooking!.status = 'confirmed';
      notifyListeners();
    }
  }

  void checkIn() {
    if (_currentBooking != null) {
      _currentBooking!.status = 'checkedIn';
      notifyListeners();
    }
  }

  void cancelBooking() {
    _currentBooking = null;
    notifyListeners();
  }
}
