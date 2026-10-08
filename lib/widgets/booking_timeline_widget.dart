import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/constants/app_constants.dart';
import '../core/utils/date_formatter.dart';
import '../services/booking_lifecycle.dart';

class BookingTimelineWidget extends StatelessWidget {
  final List<Map<String, dynamic>> activityEntries;

  const BookingTimelineWidget({
    super.key,
    required this.activityEntries,
  });

  @override
  Widget build(BuildContext context) {
    if (activityEntries.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Text(
          'No timeline events recorded yet.',
          style: GoogleFonts.inter(color: AppColors.textMuted, fontSize: 13),
        ),
      );
    }

    // Chronological order (oldest first for timeline)
    final sorted = List<Map<String, dynamic>>.from(activityEntries);
    sorted.sort((a, b) {
      final sa = a['seq'] is num ? (a['seq'] as num) : 0;
      final sb = b['seq'] is num ? (b['seq'] as num) : 0;
      return sa.compareTo(sb);
    });

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: sorted.length,
      itemBuilder: (context, index) {
        final isFirst = index == 0;
        final isLast = index == sorted.length - 1;
        final event = sorted[index];
        return _buildTimelineNode(context, event, isFirst: isFirst, isLast: isLast);
      },
    );
  }

  Widget _buildTimelineNode(
    BuildContext context,
    Map<String, dynamic> event, {
    required bool isFirst,
    required bool isLast,
  }) {
    final action = (event['action'] ?? '').toString();
    final at = parseInstant(event['at']);
    final actor = event['actor_name'] != null
        ? '${event['actor_name']} (${_roleLabel(event['actor'])})'
        : _roleLabel(event['actor']);
    final reason = event['reason']?.toString();
    final fromStatus = event['from_status']?.toString();
    final toStatus = event['to_status']?.toString();

    final iconData = _actionIcon(action);
    final nodeColor = _actionColor(action);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Timeline Line and Node Icon
          SizedBox(
            width: 32,
            child: Column(
              children: [
                Container(
                  width: 2,
                  height: 12,
                  color: isFirst ? Colors.transparent : AppColors.cardBorder,
                ),
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: nodeColor.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                    border: Border.all(color: nodeColor, width: 2),
                  ),
                  child: Icon(iconData, size: 14, color: nodeColor),
                ),
                Expanded(
                  child: Container(
                    width: 2,
                    color: isLast ? Colors.transparent : AppColors.cardBorder,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Event Content Card
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _headline(action),
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textDark,
                            ),
                          ),
                        ),
                        if (at != null)
                          Text(
                            DateFormatter.timeAgo(at.toLocal()),
                            style: GoogleFonts.inter(
                              fontSize: 10,
                              color: AppColors.textMuted,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$actor · ${at != null ? DateFormatter.formatFull(at.toLocal()) : ''}',
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                    if (fromStatus != null && toStatus != null && fromStatus != toStatus) ...[
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceLight,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '$fromStatus ➔ $toStatus',
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primaryForest,
                          ),
                        ),
                      ),
                    ],
                    if (reason != null && reason.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Note: $reason',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                          color: AppColors.textDark,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _roleLabel(Object? actor) {
    switch ('$actor') {
      case 'guest':
        return 'Guest';
      case 'system':
        return 'System';
      case 'admin':
      case 'host':
      case 'staff':
        return 'Admin';
      default:
        return '$actor';
    }
  }

  static String _headline(String action) {
    const headlines = {
      'Submit': 'Booking Created',
      'Approve': 'Downpayment Approved',
      'Reject': 'Booking Rejected',
      'ChoosePaymentPlan': 'Payment Plan Chosen',
      'UploadPaymentProof': 'Payment Receipt Uploaded',
      'VerifyPayment': 'Payment Verified — Reserved',
      'RejectPaymentProof': 'Payment Proof Rejected',
      'MarkRefunded': 'Refund Returned',
      'RevokeKey': 'Access Credential Revoked',
      'Cancel': 'Booking Cancelled',
      'Expire': 'Date Hold Expired',
      'CheckIn': 'Guest Checked In',
      'BeginStay': 'Stay Started',
      'CheckOut': 'Guest Checked Out',
      'Complete': 'Stay Completed',
      'Rescheduled': 'Dates Rescheduled',
      'CancellationRejected': 'Cancellation Rejected',
    };
    return headlines[action] ?? action;
  }

  static IconData _actionIcon(String action) {
    switch (action) {
      case 'Submit':
        return Icons.add_circle_outline;
      case 'Approve':
      case 'VerifyPayment':
        return Icons.verified_outlined;
      case 'UploadPaymentProof':
      case 'ChoosePaymentPlan':
        return Icons.receipt_long;
      case 'CheckIn':
        return Icons.login;
      case 'BeginStay':
        return Icons.hotel;
      case 'CheckOut':
        return Icons.logout;
      case 'Complete':
        return Icons.check_circle_outline;
      case 'Cancel':
      case 'Reject':
      case 'RejectPaymentProof':
        return Icons.cancel_outlined;
      case 'Expire':
        return Icons.timer_off_outlined;
      case 'Rescheduled':
        return Icons.edit_calendar;
      default:
        return Icons.event_note;
    }
  }

  static Color _actionColor(String action) {
    switch (action) {
      case 'Submit':
      case 'ChoosePaymentPlan':
      case 'UploadPaymentProof':
        return AppColors.accentGoldDark;
      case 'Approve':
      case 'VerifyPayment':
      case 'Complete':
        return AppColors.statusSuccess;
      case 'CheckIn':
      case 'BeginStay':
        return const Color(0xFF1D3557);
      case 'CheckOut':
        return AppColors.primaryForest;
      case 'Cancel':
      case 'Reject':
      case 'RejectPaymentProof':
        return AppColors.statusAlert;
      case 'Expire':
        return AppColors.statusWarning;
      default:
        return AppColors.primaryForest;
    }
  }
}
