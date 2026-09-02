class Booking {
  final String referenceId;
  final String guestName;
  final String phone;
  final String accommodationTitle;
  final DateTime checkInDate;
  final DateTime checkOutDate;
  final int guestCount;
  final String notes;
  String status; // 'pending', 'confirmed', 'checkedIn'
  String? govtIdPath;
  String? paymentReceiptPath;
  final DateTime createdAt;

  Booking({
    required this.referenceId,
    required this.guestName,
    required this.phone,
    required this.accommodationTitle,
    required this.checkInDate,
    required this.checkOutDate,
    required this.guestCount,
    this.notes = '',
    this.status = 'pending',
    this.govtIdPath,
    this.paymentReceiptPath,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  double get totalPrice {
    final days = checkOutDate.difference(checkInDate).inDays;
    final int validDays = days > 0 ? days : 1;
    if (accommodationTitle.contains('Main House')) {
      return validDays * 8500.0;
    } else if (accommodationTitle.contains('Forest Deck')) {
      return validDays * 1800.0;
    } else {
      return validDays * 1500.0;
    }
  }
}
