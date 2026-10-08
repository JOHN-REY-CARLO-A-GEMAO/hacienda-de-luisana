import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';
import '../security/security_pin_sheet.dart';

class RefundManagementScreen extends ConsumerStatefulWidget {
  const RefundManagementScreen({super.key});

  @override
  ConsumerState<RefundManagementScreen> createState() =>
      _RefundManagementScreenState();
}

class _RefundManagementScreenState extends ConsumerState<RefundManagementScreen> {
  bool _busy = false;

  Actor _actor() {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return Actor.admin(
      auth.uid ?? auth.sessionEmail ?? 'admin',
      auth.displayName ?? auth.sessionEmail,
    );
  }

  Future<void> _recordManualRefund(BookingModel booking) async {
    final refundAmount = booking.refundTotal ?? 0.0;
    final refController = TextEditingController();
    final amountController = TextEditingController(text: refundAmount.toStringAsFixed(2));
    final notesController = TextEditingController();
    String channel = 'GCash';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(
            'Record Manual Refund',
            style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Enter payment details for the refund sent to ${booking.guestName}:',
                style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: channel,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Payment Channel', border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'GCash', child: Text('GCash')),
                  DropdownMenuItem(value: 'Bank Transfer', child: Text('Bank Transfer')),
                  DropdownMenuItem(value: 'Cash', child: Text('Cash')),
                ],
                onChanged: (v) {
                  if (v != null) setDialogState(() => channel = v);
                },
              ),
              const SizedBox(height: 10),
              TextField(
                controller: refController,
                decoration: const InputDecoration(
                  labelText: 'Transaction / Reference Ref #',
                  hintText: 'e.g. 10023459201',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Refunded Amount',
                  prefixText: '₱ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: notesController,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Admin Notes (Optional)',
                  hintText: 'e.g. Sent via GCash to registered phone',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                if (refController.text.trim().isEmpty) return;
                Navigator.pop(ctx, true);
              },
              child: const Text('Record Refund'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;

    final ticket = await requirePinTicket(
      context,
      ref: ref,
      title: 'Confirm Refund — ${booking.guestName}',
      consequence:
          'This marks ₱${amountController.text} as officially returned to ${booking.guestName}.',
    );
    if (ticket == null) return;

    setState(() => _busy = true);
    final service = ref.read(firestoreServiceProvider);
    final result = await service.applyBookingAction(
      booking,
      AdminAction.markRefunded,
      _actor(),
      ticket: ticket,
    );
    if (!mounted) return;
    setState(() => _busy = false);

    if (result.ok) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Refund recorded for ${booking.guestName}. Status: Refunded.'),
      ));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Failed to record refund.'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Refund Management',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: bookingsAsync.when(
        data: (allBookings) {
          final pendingRefunds = allBookings.where((b) {
            final s = b.refundStatus;
            return s != null && s != 'none' && s != 'refunded';
          }).toList();

          pendingRefunds.sort((a, b) => b.createdAt.compareTo(a.createdAt));

          if (pendingRefunds.isEmpty) {
            return const EmptyState(
              icon: Icons.currency_exchange,
              title: 'No Pending Refunds',
              subtitle: 'All calculated refunds have been settled.',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: pendingRefunds.length,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              final booking = pendingRefunds[index];
              return _buildRefundCard(booking);
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error loading refunds: $err')),
      ),
    );
  }

  Widget _buildRefundCard(BookingModel booking) {
    final refundTotal = booking.refundTotal ?? 0.0;
    final breakdown = booking.raw['refund_breakdown'] is Map
        ? Map<String, dynamic>.from(booking.raw['refund_breakdown'] as Map)
        : <String, dynamic>{};

    return HaciendaCard(
      borderColor: AppColors.statusAlert.withValues(alpha: 0.5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  booking.guestName,
                  style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ),
              StatusPill(
                label: (booking.refundStatus ?? 'initiated').toUpperCase(),
                color: AppColors.statusAlert,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Ref: ${booking.refId ?? booking.id} · ${booking.guestPhone} · ${booking.guestEmail}',
            style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
          ),
          const Divider(height: 20),

          // Settlement Breakdown
          _row('Stay Total:', '₱${(breakdown['stayTotal'] ?? booking.totalAmount).toString()}'),
          if (breakdown['stayRefund'] != null)
            _row('Stay Refund Eligible:', '₱${breakdown['stayRefund']}'),
          if (breakdown['depositHeld'] != null)
            _row('Security Deposit Held:', '₱${breakdown['depositHeld']}'),
          if (breakdown['damageDeduction'] != null && (breakdown['damageDeduction'] as num) > 0)
            _row('Damage Deduction:', '-₱${breakdown['damageDeduction']}', isWarning: true),
          if (breakdown['depositRefund'] != null)
            _row('Deposit Refund Return:', '₱${breakdown['depositRefund']}'),

          const Divider(height: 12),
          _row(
            'Total Refund Amount Due:',
            '₱${refundTotal.toStringAsFixed(2)}',
            isBold: true,
          ),

          if (booking.cancellationReason != null) ...[
            const SizedBox(height: 8),
            Text(
              'Cancellation Reason: ${booking.cancellationReason}',
              style: GoogleFonts.inter(fontSize: 11, fontStyle: FontStyle.italic, color: AppColors.textMuted),
            ),
          ],

          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : () => _recordManualRefund(booking),
              icon: const Icon(Icons.check_circle, size: 18),
              label: const Text('Record Manual Refund Transfer'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryForest,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String val, {bool isBold = false, bool isWarning = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 12,
              color: isWarning ? AppColors.statusAlert : AppColors.textMuted,
            ),
          ),
          Text(
            val,
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: isBold ? FontWeight.bold : FontWeight.w600,
              color: isWarning ? AppColors.statusAlert : AppColors.textDark,
            ),
          ),
        ],
      ),
    );
  }
}
