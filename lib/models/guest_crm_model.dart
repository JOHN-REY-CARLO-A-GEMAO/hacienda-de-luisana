class GuestCrmModel {
  final String id;
  final String name;
  final String phone;
  final String email;
  final int totalBookings;
  final double lifetimeRevenue;
  final bool isVip;
  final String notes;
  /// Most recent stay date — null when the profile has no recorded stay,
  /// so the screen never invents a "recent" date for a Guest with none.
  final DateTime? lastStayDate;

  GuestCrmModel({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.totalBookings,
    required this.lifetimeRevenue,
    required this.isVip,
    required this.notes,
    this.lastStayDate,
  });

  factory GuestCrmModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    // Nothing here is invented. A Guest whose profile has no recorded spend has
    // none — the ₱15,000 this used to default to put a fabricated lifetime value
    // and a VIP-shaped total in front of the Admin on an empty document.
    DateTime? parsedLastStay(Object? raw) {
      if (raw == null) return null;
      if (raw is String) return DateTime.tryParse(raw);
      try {
        return (raw as dynamic).toDate();
      } catch (_) {
        return null;
      }
    }

    return GuestCrmModel(
      id: docId ?? json['id'] ?? '',
      name: json['name'] ?? '',
      phone: json['phone'] ?? '',
      email: json['email'] ?? '',
      totalBookings: _int(json['totalBookings']) ?? 0,
      lifetimeRevenue: _double(json['lifetimeRevenue']) ?? 0.0,
      isVip: json['isVip'] == true,
      notes: json['notes'] ?? '',
      lastStayDate: parsedLastStay(json['lastStayDate']),
    );
  }

  /// Whether anything is actually recorded about this Guest, so a screen can
  /// say "no history yet" rather than showing zeroes as if they were figures.
  bool get hasHistory => totalBookings > 0 || lifetimeRevenue > 0;

  static int? _int(Object? value) =>
      value is num && value.isFinite ? value.toInt() : null;

  static double? _double(Object? value) =>
      value is num && value.isFinite ? value.toDouble() : null;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'phone': phone,
      'email': email,
      'totalBookings': totalBookings,
      'lifetimeRevenue': lifetimeRevenue,
      'isVip': isVip,
      'notes': notes,
      'lastStayDate': lastStayDate?.toIso8601String(),
    };
  }
}
