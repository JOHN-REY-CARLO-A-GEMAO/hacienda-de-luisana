class GuestCrmModel {
  final String id;
  final String name;
  final String phone;
  final String email;
  final int totalBookings;
  final double lifetimeRevenue;
  final bool isVip;
  final String notes;
  final DateTime lastStayDate;

  GuestCrmModel({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.totalBookings,
    required this.lifetimeRevenue,
    required this.isVip,
    required this.notes,
    required this.lastStayDate,
  });

  factory GuestCrmModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    return GuestCrmModel(
      id: docId ?? json['id'] ?? '',
      name: json['name'] ?? '',
      phone: json['phone'] ?? '',
      email: json['email'] ?? '',
      totalBookings: (json['totalBookings'] ?? 1) as int,
      lifetimeRevenue: (json['lifetimeRevenue'] ?? 15000.0).toDouble(),
      isVip: (json['isVip'] ?? false) as bool,
      notes: json['notes'] ?? 'Regular guest',
      lastStayDate: json['lastStayDate'] != null
          ? (json['lastStayDate'] is String ? DateTime.parse(json['lastStayDate']) : (json['lastStayDate'] as dynamic).toDate())
          : DateTime.now(),
    );
  }

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
      'lastStayDate': lastStayDate.toIso8601String(),
    };
  }
}
