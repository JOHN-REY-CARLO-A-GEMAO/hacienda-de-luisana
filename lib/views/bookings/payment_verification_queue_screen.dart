import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../core/theme/status_style.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../services/booking_queue.dart';
import '../../services/payment_proof_service.dart';
import '../../services/pin_store.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/status_pill.dart';
import '../../utils/validators.dart';
import '../security/security_pin_sheet.dart';
import 'payment_proof_viewer.dart';
import '../../widgets/admin_ui.dart';

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
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final action = booking.rawStatus == BookingStatuses.pending
          ? AdminAction.approve
          : AdminAction.verifyPayment;
      final double amount;
      if (action == AdminAction.approve) {
        // Approval records the Guest's claimed downpayment. The lifecycle
        // deliberately ignores amountVerified for this transition, so do not
        // ask for a second number that could disagree with the actual write.
        final claimed = booking.amountClaimed;
        if (claimed == null || claimed <= 0) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            backgroundColor: AppColors.statusAlert,
            content: Text('Hindi maaprubahan: walang wastong halaga ng downpayment sa proof. Humingi ng bagong patunay.'),
            duration: Duration(seconds: 7),
          ));
          return;
        }
        amount = claimed;
      } else {
        final owed = booking.amountDue == null
            ? null
            : booking.amountDue! + (booking.securityDeposit ?? 0);
        // Never invent a due-now figure when the Booking has no snapshot.
        final suggestedAmount = booking.amountClaimed ??
            (owed != null && owed > 0 ? owed : null);
        final entered = await _askAmount(
          'Aprubahan at Beripikahin ang Bayad',
          owed != null
              ? 'Halagang aktwal na natanggap (₱${owed.toStringAsFixed(2)} ang naitalang due)'
              : 'Ilagay ang eksaktong halagang nakasaad sa patunay',
          suggestedAmount,
        );
        if (entered == null || !mounted) return;
        amount = entered;
      }

      final ticket = await requirePinTicket(
        context,
        ref: ref,
        title: 'Beripikahin ang Bayad — ${booking.guestName}',
        consequence:
            'Be-verify nito ang ₱${amount.toStringAsFixed(2)} para kay ${booking.guestName}. '
            'Suriin muna ang patunay; hindi ito awtomatikong approval.',
      );
      if (ticket == null || !mounted) return;

      final result = await ref.read(firestoreServiceProvider).applyBookingAction(
        booking,
        action,
        _actor(),
        input: ActionInput(
          amountVerified: action == AdminAction.verifyPayment ? amount : null,
        ),
        ticket: ticket,
      );
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(SnackBar(
        backgroundColor: result.ok ? null : AppColors.statusAlert,
        content: Text(result.ok
            ? 'Nabe-verify ang bayad ni ${booking.guestName}. Status: ${result.patch['status']}'
            : 'Hindi nabe-verify: ${result.reason ?? 'Tinanggihan ng serbisyo.'}'),
        duration: Duration(seconds: result.ok ? 4 : 7),
      ));
      if (result.ok && mounted) {
        await _recordPaymentReference(booking, amount);
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text('Hindi naisagawa ang verification. ${error.toString().split('\n').first}'),
        duration: const Duration(seconds: 7),
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rejectPayment(BookingModel booking, {required bool allowResubmission}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final title = allowResubmission
          ? 'Humingi ng Bagong Patunay'
          : 'Tanggihan ang Bayad at Kanselahin';
      final hint = allowResubmission
          ? 'Ipaliwanag kung bakit (hal. malabong larawan o maling halaga). Makapagpapadala muli ang Guest.'
          : 'Ipaliwanag kung bakit. Kanselahin ang booking at hindi na ito maibabalik dito.';
      final reason = await _askText(
        title,
        hint,
        confirm: allowResubmission ? 'Humingi ng Resubmit' : 'Tanggihan at Kanselahin',
      );
      if (reason == null || reason.isEmpty || !mounted) return;

      SecurityTicket? ticket;
      if (!allowResubmission) {
        ticket = await requirePinTicket(
          context,
          ref: ref,
          title: 'Kanselahin ang Booking — ${booking.guestName}',
          consequence:
              'Kakanselahin nito ang booking kapag tinanggihan ang patunay nang walang resubmission.',
        );
        if (ticket == null || !mounted) return;
      }
      if (!mounted) return;

      final result = await ref.read(firestoreServiceProvider).applyBookingAction(
        booking,
        AdminAction.rejectPaymentProof,
        _actor(),
        input: ActionInput(reason: reason, guestResubmits: allowResubmission),
        ticket: ticket,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: result.ok ? null : AppColors.statusAlert,
        content: Text(result.ok
            ? (allowResubmission
                ? 'Naipadala ang resubmission request kay ${booking.guestName}.'
                : 'Tinanggihan ang bayad at nakansela ang booking.')
            : 'Hindi naisagawa: ${result.reason ?? 'Tinanggihan ng serbisyo.'}'),
        duration: Duration(seconds: result.ok ? 4 : 7),
      ));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text('Hindi naisagawa ang rejection. ${error.toString().split('\n').first}'),
        duration: const Duration(seconds: 7),
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Persists one payment reference row from a proof the Admin just verified.
  ///
  /// Idempotent: a row with the same reference number for the same Booking is
  /// never written twice, and no row is invented when the Guest gave no
  /// reference at all. The row carries the extraction evidence (sender, date,
  /// proof path) so the Payment references screen can show it without asking
  /// the Admin to re-type anything.
  ///
  /// Concurrency: the check-and-insert runs inside a Firestore transaction on
  /// a deterministic document id (`reference` + Booking id), so two concurrent
  /// verifications of the same reference can never insert a second row.
  /// `transaction.create()` fails hard if the row already exists, which the
  /// idempotency read above turns into a no-op instead of a duplicate.
  Future<void> _recordPaymentReference(BookingModel booking, double verifiedAmount) async {
    final reference = booking.paymentReference?.trim();
    if (reference == null || reference.isEmpty) return;
    if (!mounted) return;
    try {
      // Firestore document ids may not contain '/'; references are already
      // validated as [A-Z0-9-]{6,40}, but normalise defensively.
      final safeRef = reference.replaceAll(RegExp(r'[/\s]+'), '_');
      final docRef = FirebaseFirestore.instance
          .collection(AppConstants.colPaymentReferences)
          .doc('${safeRef}_${booking.id}');

      await FirebaseFirestore.instance.runTransaction((transaction) async {
        final existing = await transaction.get(docRef);
        if (existing.exists) return; // already filed — idempotent no-op
        transaction.create(docRef, {
          'reference': reference,
          'amount': verifiedAmount,
          'status': 'verified',
          'booking_id': booking.id,
          'sender_name': booking.paymentSenderName,
          'payment_date': booking.paymentDate,
          'proof_url': booking.paymentProofUrl,
          'created_at': FieldValue.serverTimestamp(),
        });
      });
    } catch (e) {
      // A failure to file the reference row must never hide a successful
      // verification — the money decision stands, the row can be backfilled.
      debugPrint('[PaymentRefs] could not record reference row: $e');
    }
  }

  Future<String?> _askText(String title, String hint, {required String confirm}) async {
    final controller = TextEditingController();
    String? dialogError;
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLines: 4,
                  style: const TextStyle(fontSize: 18),
                  decoration: InputDecoration(hintText: hint, border: const OutlineInputBorder()),
                  onChanged: (_) {
                    if (dialogError != null) setDialogState(() => dialogError = null);
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    dialogError!,
                    style: const TextStyle(fontSize: 16, color: AppColors.statusAlert),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Bumalik')),
                ElevatedButton(
                  onPressed: () {
                    final txt = controller.text.trim();
                    if (txt.isEmpty) {
                      setDialogState(() => dialogError = 'Kailangan ang dahilan bago magpatuloy.');
                      return;
                    }
                    Navigator.pop(ctx, txt);
                  },
                  child: Text(confirm),
                ),
              ],
            ),
          ],
        ),
      ),
    ).whenComplete(controller.dispose);
  }

  Future<double?> _askAmount(String title, String hint, double? initial) async {
    final controller = TextEditingController(text: initial?.toStringAsFixed(2) ?? '');
    String? dialogError;
    return showDialog<double>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title, style: GoogleFonts.inter(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(fontSize: 20),
                  decoration: InputDecoration(
                    prefixText: '₱ ',
                    hintText: hint,
                    border: const OutlineInputBorder(),
                  ),
                  onChanged: (_) {
                    if (dialogError != null) setDialogState(() => dialogError = null);
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    dialogError!,
                    style: const TextStyle(fontSize: 16, color: AppColors.statusAlert),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Bumalik')),
                ElevatedButton(
                  onPressed: () {
                    final value = controller.text.replaceAll(',', '').trim();
                    final error = Validators.amount(value, min: 0.01);
                    if (error != null) {
                      setDialogState(() => dialogError = error);
                      return;
                    }
                    final amount = double.tryParse(value);
                    if (amount == null) {
                      setDialogState(() => dialogError = 'Maglagay ng wastong halaga.');
                      return;
                    }
                    Navigator.pop(ctx, amount);
                  },
                  child: const Text('Kumpirmahin'),
                ),
              ],
            ),
          ],
        ),
      ),
    ).whenComplete(controller.dispose);
  }

  Future<void> _openProof(BookingModel booking) async {
    if (_busy) return;
    final path = booking.paymentProofUrl;
    if (path == null || path.isEmpty) return;
    setState(() => _busy = true);
    try {
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
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text('Hindi mabuksan ang proof. ${error.toString().split('\n').first}'),
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AdminPageHeader(
        title: 'Payments to verify',
        subtitle: 'Match the proof, reference and claimed amount',
        bottom: _busy
            ? const PreferredSize(
                preferredSize: Size.fromHeight(4),
                child: LinearProgressIndicator(minHeight: 4),
              )
            : null,
      ),
      body: bookingsAsync.when(
        data: (allBookings) {
          final queue = allBookings.where(bookingNeedsPaymentReview).toList();

          queue.sort((a, b) => b.createdAt.compareTo(a.createdAt));

          if (queue.isEmpty) {
            return const EmptyState(
              icon: Icons.check_circle_outline,
              title: 'Payment queue is clear',
              subtitle:
                  'No proof is waiting for verification. No payment was verified automatically.',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: queue.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              if (index == 0) {
                return AdminInlineNotice(
                  title: '${queue.length} payments to verify',
                  message:
                      'Open and check each proof before deciding. OCR and the claimed amount alone are not evidence that money arrived.',
                  tone: AdminNoticeTone.caution,
                  icon: Icons.pending_actions_outlined,
                );
              }

              final booking = queue[index - 1];
              return _buildQueueCard(booking);
            },
          );
        },
        loading: () => const LoadingState(
          label: 'Reading payment proofs…',
          detail: 'Only proofs that are actually in the queue are shown.',
        ),
        error: (err, _) => EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Payment queue could not be read',
          subtitle:
              'No payment was marked verified. Check the connection and try again. ${err.toString().split('\n').first}',
          action: ElevatedButton.icon(
            onPressed: () => ref.invalidate(bookingsStreamProvider),
            icon: const Icon(Icons.refresh),
            label: const Text('Try again'),
          ),
        ),
      ),
    );
  }

  Widget _buildQueueCard(BookingModel booking) {
    final published = ref.watch(accommodationsProvider);
    final dueNow = booking.amountDue;
    final claimed = booking.amountClaimed;
    final total = booking.stayTotal ?? booking.totalAmount;

    String peso(double? value) => value == null ? 'Hindi naitala' : '₱${value.toStringAsFixed(2)}';

    return HaciendaCard(
      borderColor: AppColors.accentGold,
      borderWidth: 1.5,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            booking.guestName,
            style: GoogleFonts.inter(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          StatusPill(
            label: 'Proof submitted',
            color: StatusStyle.payment('pending'),
            fontSize: 14,
          ),
          const SizedBox(height: 10),
          Text(
            '${booking.guestPhone}\n${booking.guestEmail}\nReference: ${booking.refId ?? booking.id}',
            style: GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted, height: 1.4),
          ),
          const Divider(height: 28),
          _infoRow('Matutuluyan', BookingModel.accommodationLabel(booking.accommodation, published)),
          _infoRow(
            'Petsa ng stay',
            '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)}\n'
            '${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)}',
          ),
          _infoRow('Stay total', peso(total)),
          _infoRow('Naitalang due now', peso(dueNow)),
          if (booking.securityDeposit != null)
            _infoRow('Security deposit', peso(booking.securityDeposit)),
          _infoRow('Halagang sinabi ng Guest na naipadala', peso(claimed), highlight: true),
          if (booking.paymentSenderName != null || booking.ocrSenderName != null)
            _infoRow(
                'Sender sa receipt',
                '${booking.paymentSenderName ?? booking.ocrSenderName}${booking.paymentSenderName == null ? ' (OCR)' : ''}'),
          if (booking.paymentDate != null || booking.ocrPaymentDate != null)
            _infoRow(
                'Petsa sa receipt',
                '${booking.paymentDate ?? booking.ocrPaymentDate}${booking.paymentDate == null ? ' (OCR)' : ''}'),
          if (booking.paymentPlan != null) _infoRow('Payment plan', booking.paymentPlan!),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _openProof(booking),
              icon: const Icon(Icons.receipt_long, size: 22),
              label: const Text('Buksan at Suriin ang Payment Proof'),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.primaryForest),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : () => _approvePayment(booking),
              icon: _busy
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.check_circle_outline, size: 22),
              label: Text(_busy ? 'Isinasagawa… huwag pindutin muli' : 'Aprubahan at Beripikahin ang Bayad'),
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusSuccess),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _rejectPayment(booking, allowResubmission: true),
              icon: const Icon(Icons.refresh, size: 22),
              label: const Text('Humingi ng Bagong Patunay'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.statusWarning,
                side: const BorderSide(color: AppColors.statusWarning),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _rejectPayment(booking, allowResubmission: false),
              icon: const Icon(Icons.cancel_outlined, size: 22),
              label: const Text('Tanggihan ang Bayad at Kanselahin'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.statusAlert,
                side: const BorderSide(color: AppColors.statusAlert),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.inter(fontSize: 15, color: AppColors.textMuted)),
          const SizedBox(height: 3),
          Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 18,
              height: 1.35,
              fontWeight: highlight ? FontWeight.bold : FontWeight.w500,
              color: highlight ? AppColors.primaryForest : AppColors.textDark,
            ),
          ),
        ],
      ),
    );
  }
}
