class AdminNotificationModel {
  final String id;
  final String title;
  final String message;
  final String type;
  final DateTime createdAt;
  final bool read;
  final String? bookingId;
  final String? guestId;

  AdminNotificationModel({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    required this.createdAt,
    required this.read,
    this.bookingId,
    this.guestId,
  });

  factory AdminNotificationModel.fromJson(Map<String, dynamic> json, String docId) {
    final rawDate = json['created_at'] ?? json['createdAt'];
    DateTime date = DateTime.now();
    if (rawDate is String) {
      date = DateTime.tryParse(rawDate) ?? DateTime.now();
    } else if (rawDate != null) {
      try {
        date = (rawDate as dynamic).toDate() as DateTime;
      } catch (_) {}
    }

    return AdminNotificationModel(
      id: docId,
      title: json['title'] ?? 'Notification',
      message: json['message'] ?? '',
      type: json['type'] ?? 'general',
      createdAt: date,
      read: json['read'] == true,
      bookingId: json['booking_id'] ?? json['bookingId'],
      guestId: json['guest_id'] ?? json['guestId'] ?? json['user_id'],
    );
  }
}
