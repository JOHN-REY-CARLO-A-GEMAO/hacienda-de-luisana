import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../providers/app_providers.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../bookings/booking_detail_screen.dart';
import '../bookings/payment_verification_queue_screen.dart';
import '../bookings/refund_management_screen.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Admin Notification Center',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: bookingsAsync.when(
        data: (bookings) {
          final items = <_NotificationItem>[];

          for (final b in bookings) {
            // Payment Verification Required
            if ((b.paymentProofUrl != null && b.paymentProofUrl!.isNotEmpty && b.paymentStatus != 'verified') ||
                b.rawStatus == 'Payment Pending') {
              items.add(_NotificationItem(
                id: 'pay-${b.id}',
                title: 'Payment Verification Required',
                message: '${b.guestName} submitted payment proof for ${b.accommodation}. Claimed: ₱${(b.amountClaimed ?? 0).toStringAsFixed(0)}.',
                type: 'payment_verification',
                createdAt: b.createdAt,
                bookingId: b.id,
                icon: Icons.receipt_long,
                accentColor: AppColors.accentGoldDark,
              ));
            }

            // Late Checkout Request
            if (b.raw['late_checkout_request'] is Map) {
              final req = Map<String, dynamic>.from(b.raw['late_checkout_request'] as Map);
              if (req['status'] == 'pending') {
                final hrs = req['hours'] ?? 1;
                items.add(_NotificationItem(
                  id: 'late-${b.id}',
                  title: 'Late Checkout Requested',
                  message: '${b.guestName} requested +$hrs hour${hrs > 1 ? 's' : ''} late checkout extension for ${b.accommodation}.',
                  type: 'late_checkout',
                  createdAt: DateTime.now(),
                  bookingId: b.id,
                  icon: Icons.access_time,
                  accentColor: AppColors.primaryForest,
                ));
              }
            }

            // Refund Requested
            if (b.refundStatus == 'initiated') {
              items.add(_NotificationItem(
                id: 'refund-${b.id}',
                title: 'Refund Processing Pending',
                message: 'Refund of ₱${(b.refundTotal ?? 0).toStringAsFixed(2)} waiting for manual transfer to ${b.guestName}.',
                type: 'refund_pending',
                createdAt: b.createdAt,
                bookingId: b.id,
                icon: Icons.currency_exchange,
                accentColor: AppColors.statusAlert,
              ));
            }

            // New Booking Pending Review
            if (b.rawStatus == 'Pending' && (b.paymentProofUrl == null || b.paymentProofUrl!.isEmpty)) {
              items.add(_NotificationItem(
                id: 'new-${b.id}',
                title: 'New Booking Submitted',
                message: 'New request from ${b.guestName} for ${b.accommodation} (${DateFormatter.formatStayRange(b.checkInDate, b.checkOutDate)}).',
                type: 'new_booking',
                createdAt: b.createdAt,
                bookingId: b.id,
                icon: Icons.add_business,
                accentColor: AppColors.statusSuccess,
              ));
            }
          }

          items.sort((a, b) => b.createdAt.compareTo(a.createdAt));

          if (items.isEmpty) {
            return const EmptyState(
              icon: Icons.notifications_none,
              title: 'No Pending Notifications',
              subtitle: 'All operational requests and verifications are up to date.',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, i) {
              final item = items[i];
              return InkWell(
                onTap: () {
                  if (item.type == 'payment_verification') {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const PaymentVerificationQueueScreen(),
                    ));
                  } else if (item.type == 'refund_pending') {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const RefundManagementScreen(),
                    ));
                  } else if (item.bookingId != null) {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => BookingDetailScreen(bookingId: item.bookingId!),
                    ));
                  }
                },
                child: HaciendaCard(
                  borderColor: item.accentColor.withValues(alpha: 0.5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        backgroundColor: item.accentColor.withValues(alpha: 0.15),
                        child: Icon(item.icon, color: item.accentColor, size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  item.title,
                                  style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold),
                                ),
                                Text(
                                  DateFormatter.timeAgo(item.createdAt),
                                  style: GoogleFonts.inter(fontSize: 10, color: AppColors.textMuted),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              item.message,
                              style: GoogleFonts.inter(fontSize: 12, color: AppColors.textDark),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Tap to open record ➔',
                              style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600, color: item.accentColor),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error loading notifications: $err')),
      ),
    );
  }
}

class _NotificationItem {
  final String id;
  final String title;
  final String message;
  final String type;
  final DateTime createdAt;
  final String? bookingId;
  final IconData icon;
  final Color accentColor;

  _NotificationItem({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    required this.createdAt,
    this.bookingId,
    required this.icon,
    required this.accentColor,
  });
}
