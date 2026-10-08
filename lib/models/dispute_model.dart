class DisputeModel {
  final String id;
  final String bookingId;
  final String guestId;
  final String category;
  final String description;
  final List<String> evidenceUrls;
  final String status; // open, under_review, resolved, rejected
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? adminResponse;
  final String? internalNotes;
  final DateTime? resolvedAt;
  final String? resolvedBy;

  const DisputeModel({
    required this.id,
    required this.bookingId,
    required this.guestId,
    required this.category,
    required this.description,
    this.evidenceUrls = const [],
    this.status = 'open',
    required this.createdAt,
    this.updatedAt,
    this.adminResponse,
    this.internalNotes,
    this.resolvedAt,
    this.resolvedBy,
  });

  factory DisputeModel.fromMap(String id, Map<String, dynamic> data) {
    return DisputeModel(
      id: id,
      bookingId: (data['booking_id'] ?? '').toString(),
      guestId: (data['guest_id'] ?? '').toString(),
      category: (data['category'] ?? 'General Concern').toString(),
      description: (data['description'] ?? '').toString(),
      evidenceUrls: data['evidence_urls'] is List
          ? List<String>.from(data['evidence_urls'])
          : const [],
      status: (data['status'] ?? 'open').toString(),
      createdAt: _parseDate(data['created_at']) ?? DateTime.now(),
      updatedAt: _parseDate(data['updated_at']),
      adminResponse: data['admin_response']?.toString(),
      internalNotes: data['internal_notes']?.toString(),
      resolvedAt: _parseDate(data['resolved_at']),
      resolvedBy: data['resolved_by']?.toString(),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'booking_id': bookingId,
      'guest_id': guestId,
      'category': category,
      'description': description,
      'evidence_urls': evidenceUrls,
      'status': status,
      'created_at': createdAt.toIso8601String(),
      if (updatedAt != null) 'updated_at': updatedAt!.toIso8601String(),
      if (adminResponse != null) 'admin_response': adminResponse,
      if (internalNotes != null) 'internal_notes': internalNotes,
      if (resolvedAt != null) 'resolved_at': resolvedAt!.toIso8601String(),
      if (resolvedBy != null) 'resolved_by': resolvedBy,
    };
  }

  static DateTime? _parseDate(dynamic raw) {
    if (raw == null) return null;
    if (raw is DateTime) return raw;
    if (raw is String) return DateTime.tryParse(raw);
    try {
      return (raw as dynamic).toDate() as DateTime;
    } catch (_) {
      return null;
    }
  }
}
