/// Version-two server-owned case. Dates are server epoch milliseconds.
class DisputeModel {
  final String id;
  final Map<String, dynamic> data;
  const DisputeModel(this.id, this.data);
  factory DisputeModel.fromMap(String id, Map<String, dynamic> data) => DisputeModel(id, data);
  String get reference => (data['reference'] ?? id).toString();
  String get bookingId => (data['booking_id'] ?? '').toString();
  String get guestId => (data['guest_id'] ?? '').toString();
  String get category => (data['category'] ?? 'other').toString();
  String get description => (data['description'] ?? '').toString();
  String get status => (data['status'] ?? 'submitted').toString();
  String get priority => (data['priority'] ?? 'normal').toString();
  int get version => (data['version'] as num?)?.toInt() ?? 0;
  String? get assignee => data['assigned_to'] as String?;
  String? get reviewer => data['reviewer_id'] as String?;
  bool get independent => data['independent_review'] == true;
  bool get internal => data['visibility'] == 'internal';
  bool get inactive => status == 'resolved' || status == 'closed';
  String? get resolution => data['resolution'] as String?;
  static String label(String value) => value.replaceAll('_', ' ');
  static String date(dynamic value) {
    if (value is! num) return 'Not set';
    // Asia/Manila is UTC+08 with no daylight saving time.
    final dt = DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true).add(const Duration(hours: 8));
    return '${dt.toIso8601String().substring(0, 16).replaceAll('T', ' ')} Asia/Manila';
  }
}
