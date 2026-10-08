import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../services/payment_proof_service.dart';
import '../../services/pin_store.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';
import '../security/security_pin_sheet.dart';
import 'payment_proof_viewer.dart';

class PaymentVerificationQueueScreen extends ConsumerStatefulWidget {
  const PaymentVerificationQueueScreen({super.key});

  @override
  ConsumerState<PaymentVerificationQueueScreen> createState() =>
      _PaymentVerificationQueueScreenState();
}

class _PaymentVerificationQueueScreenState
    extends ConsumerState<PaymentVerificationQueueScreen> {
  bool _busy = false;

  Actor _actor() {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return Actor.admin(
      auth.uid ?? auth.sessionEmail ?? 'admin',
      auth.displayName ?? auth.sessionEmail,
    );
  }

  Future<void> _approvePayment(BookingModel booking) async {
    final owed = (booking.amountDue ?? 0) + (booking.securityDeposit ?? 0);
    final suggestedAmount = booking.amountClaimed ?? (owed > 0 ? owed : booking.totalAmount * 0.5);

    final amount = await _askAmount(
      'Approve & Verify Payment',
      'Verify amount received on receipt (₱${suggestedAmount.toStringAsFixed(2)})',
      suggestedAmount,
    );
    if (amount == null) return;

    final action = booking.rawStatus == BookingStatuses.pending
        ? AdminAction.approve
        : AdminAction.verifyPayment;

    final ticket = await requirePinTicket(
      context,
      ref: ref,
      title: 'Approve Payment — ${booking.guestName}',
      consequence:
          'Verifies ₱${amount.toStringAsFixed(2)} for ${booking.guestName}. Moves booking to Reserved/Approved and notifies guest.',
    );
    if (ticket == null) return;

    setState(() => _busy = true);
    final service = ref.read(firestoreServiceProvider);
    final result = await service.applyBookingAction(
      booking,
      action,
      _actor(),
      input: ActionInput(amountVerified: amount),
      ticket: ticket,
    );
    if (!mounted) return;
    setState(() => _busy = false);

    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      messenger.showSnackBar(SnackBar(
        content: Text('Payment verified for ${booking.guestName}. Status: ${result.patch['status']}'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Verification failed.'),
      ));
    }
  }

  Future<void> _rejectPayment(BookingModel booking, {required bool allowResubmission}) async {
    final title = allowResubmission ? 'Request Proof Resubmission' : 'Reject Payment & Cancel';
    final hint = allowResubmission
        ? 'Specify why proof was rejected (e.g. unreadable image, incorrect amount). Guest will be prompted to re-upload.'
        : 'Specify why proof was rejected. This will cancel the booking.';

    final reason = await _askText(title, hint, confirm: allowResubmission ? 'Request Resubmit' : 'Reject & Cancel');
    if (reason == null || reason.isEmpty) return;

    SecurityTicket? ticket;
    if (!allowResubmission) {
      ticket = await requirePinTicket(
        context,
        ref: ref,
        title: 'Cancel Booking — ${booking.guestName}',
        consequence: 'Rejecting proof without resubmission will cancel the booking outright.',
      );
      if (ticket == null) return;
    }

    setState(() => _busy = true);
    final service = ref.read(firestoreServiceProvider);
    final result = await service.applyBookingAction(
      booking,
      AdminAction.rejectPaymentProof,
      _actor(),
      input: ActionInput(reason: reason, guestResubmits: allowResubmission),
      ticket: ticket,
    );
    if (!mounted) return;
    setState(() => _busy = false);

    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      messenger.showSnackBar(SnackBar(
        content: Text(allowResubmission
            ? 'Requested payment resubmission from ${booking.guestName}.'
            : 'Payment rejected and booking cancelled.'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Rejection failed.'),
      ));
    }
  }

  Future<String?> _askText(String title, String hint, {required String confirm}) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          decoration: InputDecoration(hintText: hint, border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final txt = controller.text.trim();
              if (txt.isNotEmpty) Navigator.pop(ctx, txt);
            },
            child: Text(confirm),
          ),
        ],
      ),
    );
  }

  Future<double?> _askAmount(String title, String hint, double initial) async {
    final controller = TextEditingController(text: initial.toStringAsFixed(2));
    return showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(prefixText: '₱ ', hintText: hint, border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final v = double.tryParse(controller.text.replaceAll(',', ''));
              if (v != null) Navigator.pop(ctx, v);
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  Future<void> _openProof(BookingModel booking) async {
    final path = booking.paymentProofUrl;
    if (path == null || path.isEmpty) return;

    final result = await PaymentProofService.signedUrl(path);
    if (!mounted) return;
    if (result.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(result.error!),
        backgroundColor: AppColors.statusAlert,
      ));
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PaymentProofViewer(url: result.url!)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Payment Verification Queue',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: bookingsAsync.when(
        data: (allBookings) {
          final queue = allBookings.where((b) {
            final hasProof = b.paymentProofUrl != null && b.paymentProofUrl!.isNotEmpty;
            final unverified = b.paymentStatus != 'verified';
            final pendingReview = b.rawStatus == BookingStatuses.pending ||
                b.rawStatus == BookingStatuses.paymentPending;
            return hasProof && unverified && pendingReview;
          }).toList();

          queue.sort((a, b) => b.createdAt.compareTo(a.createdAt));

          if (queue.isEmpty) {
            return const EmptyState(
              icon: Icons.check_circle_outline,
              title: 'Queue Clear',
              subtitle: 'No payment verification requests waiting at this time.',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: queue.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              if (index == 0) {
                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.accentGold.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.accentGold),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.pending_actions, color: AppColors.primaryForest),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '${queue.length} Pending Payment Verification${queue.length > 1 ? 's' : ''}',
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primaryForest,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }

              final booking = queue[index - 1];
              return _buildQueueCard(booking);
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error loading queue: $err')),
      ),
    );
  }

  Widget _buildQueueCard(BookingModel booking) {
    final published = ref.watch(accommodationsProvider);
    final requiredDownpayment = booking.amountDue ?? (booking.totalAmount * 0.5);
    final claimed = booking.amountClaimed ?? requiredDownpayment;

    return HaciendaCard(
      borderColor: AppColors.accentGold,
      borderWidth: 1.5,
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
                label: 'PROOF SUBMITTED',
                color: AppColors.accentGoldDark,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${booking.guestPhone} · ${booking.guestEmail} · Ref: ${booking.refId ?? booking.id}',
            style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
          ),
          const Divider(height: 20),
          _infoRow('Accommodation', BookingModel.accommodationLabel(booking.accommodation, published)),
          _infoRow(
            'Stay Dates',
            '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)} (${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)})',
          ),
          _infoRow('Stay Total', '₱${booking.totalAmount.toStringAsFixed(2)}'),
          _infoRow('Required Downpayment (50%)', '₱${requiredDownpayment.toStringAsFixed(2)}'),
          _infoRow(
            'Claimed Amount Paid',
            '₱${claimed.toStringAsFixed(2)}',
            highlight: true,
          ),
          if (booking.paymentPlan != null) _infoRow('Payment Plan', booking.paymentPlan!),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _openProof(booking),
              icon: const Icon(Icons.receipt_long, size: 18),
              label: const Text('View Payment Proof Image'),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.primaryForest),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => _rejectPayment(booking, allowResubmission: true),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.statusWarning,
                    side: const BorderSide(color: AppColors.statusWarning),
                  ),
                  child: const Text('Request Resubmit'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => _rejectPayment(booking, allowResubmission: false),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.statusAlert,
                    side: const BorderSide(color: AppColors.statusAlert),
                  ),
                  child: const Text('Reject & Cancel'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : () => _approvePayment(booking),
              icon: const Icon(Icons.check_circle_outline, size: 18),
              label: const Text('Approve & Confirm Payment'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.statusSuccess,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
          Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: highlight ? FontWeight.bold : FontWeight.w500,
              color: highlight ? AppColors.primaryForest : AppColors.textDark,
            ),
          ),
        ],
      ),
    );
  }
}
