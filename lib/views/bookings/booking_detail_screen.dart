import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/status_style.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../services/payment_proof_service.dart';
import '../../services/pin_store.dart';
import '../../utils/error_utils.dart';
import '../../utils/validators.dart';
import '../security/secure_action_sheet.dart';
import '../security/security_pin_sheet.dart';
import 'booking_invoice_dialog.dart';
import 'payment_proof_viewer.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/booking_timeline_widget.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/section_header.dart';
import '../../widgets/status_pill.dart';

/// One Booking, end to end: who, when, the money, the refund, and every
/// lifecycle action the Admin can take from its current status — plus the
/// append-only Activity log underneath.
///
/// The screen never decides a transition itself: it offers the actions
/// `adminActionsFor(status)` lists and hands the choice to
/// `FirestoreService.applyBookingAction`, which runs the shared rules.
class BookingDetailScreen extends ConsumerStatefulWidget {
  final String bookingId;
  const BookingDetailScreen({super.key, required this.bookingId});

  @override
  ConsumerState<BookingDetailScreen> createState() =>
      _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  bool _busy = false;
  bool _openingProof = false;

  Actor _actor() {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return Actor.admin(
      auth.uid ?? auth.sessionEmail ?? 'admin',
      auth.displayName ?? auth.sessionEmail,
    );
  }

  /// Serialize the whole interaction, not only the Firestore write. This
  /// prevents duplicate dialogs, PIN prompts and submissions from rapid taps.
  Future<void> _serialize(Future<void> Function() operation) async {
    if (_busy || _openingProof) return;
    setState(() => _busy = true);
    try {
      await operation();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(ErrorUtils.toUserMessage(
          error,
          fallback: 'Hindi naisagawa ang aksyon. Suriin ang koneksyon at subukan muli.',
        )),
        duration: const Duration(seconds: 7),
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _run(BookingModel booking, AdminAction action,
      {ActionInput input = const ActionInput(),
      Actor? actor,
      SecurityTicket? ticket}) async {
    if (!mounted) return;
    final service = ref.read(firestoreServiceProvider);
    final result = await service.applyBookingAction(
      booking,
      action,
      actor ?? _actor(),
      input: input,
      ticket: ticket,
    );
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      final status = result.patch['status'] ?? booking.rawStatus;
      messenger.showSnackBar(SnackBar(
        content: Text('${action.label}: $status — ${booking.guestName}'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(ErrorUtils.toUserMessage(result.reason, fallback: 'Action was refused. Please check the requirements and try again.')),
        duration: const Duration(seconds: 6),
      ));
    }
  }

  Future<String?> _askText(String title, String hint,
      {String confirm = 'Kumpirmahin', bool optional = false}) async {
    final controller = TextEditingController();
    String? dialogError;
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title,
              style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLines: 3,
                  style: const TextStyle(fontSize: 18),
                  decoration: InputDecoration(
                      hintText: hint, border: const OutlineInputBorder()),
                  onChanged: (_) {
                    if (dialogError != null) setDialogState(() => dialogError = null);
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 6),
                  Text(dialogError!,
                      style: const TextStyle(fontSize: 16, color: AppColors.alertDangerText)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('Bumalik')),
            ElevatedButton(
              onPressed: () {
                final text = controller.text.trim();
                if (text.isEmpty && !optional) {
                  setDialogState(() => dialogError = 'Please enter a response before submitting.');
                  return;
                }
                Navigator.pop(ctx, text);
              },
              child: Text(confirm),
            ),
          ],
        ),
      ),
    ).whenComplete(controller.dispose);
    return value;
  }

  Future<String?> _askRejectionReason({required String title}) async {
    String selectedReason = 'Invalid payment';
    final remarksController = TextEditingController();
    String? dialogError;
    const options = [
      'Invalid payment',
      'Invalid ID',
      'Incomplete requirements',
      'Accommodation unavailable',
      'Other',
    ];

    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title,
              style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Select rejection reason:',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: selectedReason,
                  isExpanded: true,
                  items: options
                      .map((opt) => DropdownMenuItem(value: opt, child: Text(opt)))
                      .toList(),
                  onChanged: (val) {
                    if (val != null) {
                      setDialogState(() {
                        selectedReason = val;
                        dialogError = null;
                      });
                    }
                  },
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                Text(
                  selectedReason == 'Other'
                      ? 'Remarks (Required for "Other"):'
                      : 'Remarks (Optional):',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: remarksController,
                  maxLines: 2,
                  style: const TextStyle(fontSize: 18),
                  decoration: InputDecoration(
                    hintText: selectedReason == 'Other'
                        ? 'Specify reason...'
                        : 'Additional notes for guest...',
                    border: const OutlineInputBorder(),
                  ),
                  onChanged: (_) {
                    if (dialogError != null) setDialogState(() => dialogError = null);
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 6),
                  Text(dialogError!,
                      style: const TextStyle(fontSize: 16, color: AppColors.alertDangerText)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Bumalik'),
            ),
            ElevatedButton(
              onPressed: () {
                final remarks = remarksController.text.trim();
                if (selectedReason == 'Other') {
                  final err = Validators.rejectionReason(remarks);
                  if (err != null) {
                    setDialogState(() => dialogError = err);
                    return;
                  }
                }
                final finalReason = selectedReason == 'Other'
                    ? remarks
                    : (remarks.isNotEmpty ? '$selectedReason ($remarks)' : selectedReason);
                Navigator.pop(ctx, finalReason);
              },
              child: const Text('Tanggihan'),
            ),
          ],
        ),
      ),
    ).whenComplete(remarksController.dispose);
  }

  Future<double?> _askAmount(String title, String hint, double? initial,
      {double min = 0.0}) async {
    final controller =
        TextEditingController(text: initial == null ? '' : initial.toStringAsFixed(2));
    String? dialogError;
    return showDialog<double>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title,
              style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(fontSize: 18),
                  decoration: InputDecoration(
                      prefixText: '₱ ', hintText: hint, border: const OutlineInputBorder()),
                  onChanged: (_) {
                    if (dialogError != null) setDialogState(() => dialogError = null);
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 6),
                  Text(dialogError!,
                      style: const TextStyle(fontSize: 16, color: AppColors.alertDangerText)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('Bumalik')),
            ElevatedButton(
              onPressed: () {
                final textVal = controller.text.replaceAll(',', '').trim();
                final err = Validators.amount(textVal, min: min);
                if (err != null) {
                  setDialogState(() => dialogError = err);
                  return;
                }
                final v = double.tryParse(textVal);
                if (v == null) {
                  setDialogState(() => dialogError = 'Please enter a valid amount.');
                  return;
                }
                Navigator.pop(ctx, v);
              },
              child: const Text('Kumpirmahin'),
            ),
          ],
        ),
      ),
    ).whenComplete(controller.dispose);
  }

  /// One line of consequence, in the sheet, before the Admin commits — the
  /// gate's whole trick is naming what the tap will do (ADR-0015).
  String _consequence(BookingModel booking, AdminAction action) {
    final dates = DateFormatter.formatStayRange(
        booking.checkInDate, booking.checkOutDate);
    switch (action) {
      case AdminAction.approve:
        final amount = booking.amountClaimed;
        if (amount == null || amount <= 0) {
          return 'Suriin ang payment proof at naitalang downpayment bago aprubahan ang booking.';
        }
        return 'Be-verify nito ang ₱${amount.toStringAsFixed(0)} at ifi-firm ang petsang '
            '$dates. Magiging Approved ang booking at hindi ito maibabalik.';
      case AdminAction.verifyPayment:
        return 'Itatala nitong aktwal nang natanggap ang bayad at ililipat ang booking '
            'sa paid state na nararapat sa halaga.';
      case AdminAction.cancel:
        return 'Palalayain nito ang petsa. Ang Reserved booking ay susundin sa '
            'published refund policy.';
      case AdminAction.markRefunded:
        final refund = booking.refundTotal;
        return refund == null
            ? 'Itatala ang refund bilang naisauli na sa Guest; walang halagang naitala sa booking.'
            : 'Itatala ang ₱${refund.toStringAsFixed(2)} bilang naisauli na sa Guest.';
      case AdminAction.rejectPaymentProof:
        return 'Kapag tinanggihan nang walang resend, kakanselahin ang booking. '
            'Walang verified money na kailangang i-refund.';
      case AdminAction.revokeKey:
        return 'Hindi na gagana ang door Credential sa susunod na gamit. '
            'Hindi ito maibabalik mula rito.';
      default:
        return '';
    }
  }

  Future<SecurityTicket?> _ticket(
      BookingModel booking, AdminAction action) async {
    if (!mounted) return null;
    return requirePinTicket(
      context,
      ref: ref,
      title: '${action.label} — ${booking.guestName}',
      consequence: _consequence(booking, action),
    );
  }

  Future<void> _onAction(BookingModel booking, AdminAction action) {
    return _serialize(() => _handleAction(booking, action));
  }

  Future<void> _handleAction(BookingModel booking, AdminAction action) async {
    switch (action) {
      case AdminAction.approve:
        final ticket = await _ticket(booking, action);
        if (ticket != null) await _run(booking, action, ticket: ticket);
        return;
      case AdminAction.reject:
        final reason = await _askRejectionReason(title: 'Tanggihan ang Booking');
        if (reason != null && reason.isNotEmpty) {
          await _run(booking, action, input: ActionInput(reason: reason));
        }
        return;
      case AdminAction.verifyPayment:
        final owed = booking.amountDue == null
            ? null
            : booking.amountDue! + (booking.securityDeposit ?? 0);
        final amount = await _askAmount(
          'Beripikahin ang bayad',
          owed != null
              ? 'Halaga sa proof (₱${owed.toStringAsFixed(2)} ang naitalang due)'
              : 'Ilagay ang eksaktong halagang nakasaad sa patunay',
          booking.amountClaimed ?? (owed != null && owed > 0 ? owed : null),
          min: 0.01,
        );
        if (amount != null) {
          final ticket = await _ticket(booking, action);
          if (ticket != null) {
            await _run(booking, action,
                input: ActionInput(amountVerified: amount), ticket: ticket);
          }
        }
        return;
      case AdminAction.rejectPaymentProof:
        final reason = await _askRejectionReason(title: 'Reject Payment Proof');
        if (reason == null || reason.isEmpty) return;
        if (!mounted) return;
        final resubmits = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text('Let the Guest resend?',
                style:
                    GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 20)),
            content: const Text(
                'Oo: mananatili sa Payment Pending para makapadala muli ang Guest. Hindi: kakanselahin ang booking (walang verified money na kailangang i-refund).'),
            actions: [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Hindi — kanselahin ang Booking')),
                  ElevatedButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Oo — hayaang magpadala muli')),
                ],
              ),
            ],
          ),
        );
        if (resubmits == null) return;
        // Cancelling the Booking is the PIN tier; letting them resend is
        // already covered by the reason dialog (ADR-0015).
        SecurityTicket? ticket;
        if (!resubmits) {
          ticket = await _ticket(booking, action);
          if (ticket == null) return;
        }
        await _run(booking, action,
            input: ActionInput(reason: reason, guestResubmits: resubmits),
            ticket: ticket);
        return;
      case AdminAction.cancel:
        final choice = await _askCancel(booking);
        if (choice == null || !mounted) return;
        if (choice.reschedule) {
          await _onReschedule(booking);
          return;
        }
        final reason = choice.reason ?? '';
        double? damage;
        if (booking.rawStatus == BookingStatuses.reserved) {
          damage = await _askAmount('Damage deduction',
              'Deducted from the Security deposit (0 if none)', 0);
          if (damage == null) return;
        }
        final ticket = await _ticket(booking, action);
        if (ticket == null) return;
        await _run(booking, action,
            input: ActionInput(
                reason: reason.isEmpty ? null : reason,
                damageDeduction: damage),
            ticket: ticket);
        return;
      case AdminAction.markRefunded:
        final ticket = await _ticket(booking, action);
        if (ticket != null) await _run(booking, action, ticket: ticket);
        return;
      case AdminAction.revokeKey:
        final ticket = await _ticket(booking, action);
        if (ticket != null) await _run(booking, action, ticket: ticket);
        return;
      case AdminAction.expire:
        if (await showSecureConfirm(context,
            title: 'Record the expired hold?',
            body: 'The 24-hour Date hold has run out. Recording it frees the dates on every surface and files the expiry on the Activity log.')) {
          await _run(booking, action, actor: const Actor.system());
        }
        return;
      case AdminAction.checkIn:
        final checkInTime = DateFormatter.formatFull(DateTime.now());
        if (await showSecureConfirm(context,
            title: 'Check in ${booking.guestName}?',
            body: 'Check-In Timestamp: $checkInTime\nScheduled Check-In: ${DateFormatter.toIsoDate(booking.checkInDate)}\n\nThe Booking becomes Checked-In for the stay recorded on it.')) {
          await _run(booking, action);
        }
        return;
      case AdminAction.beginStay:
        final beginTime = DateFormatter.formatFull(DateTime.now());
        if (await showSecureConfirm(context,
            title: 'Begin the stay?',
            body: 'Start Stay Timestamp: $beginTime\nScheduled Check-In: ${DateFormatter.toIsoDate(booking.checkInDate)}\n\nThe Booking becomes Staying — the Guest is on the property.')) {
          await _run(booking, action);
        }
        return;
      case AdminAction.checkOut:
        if (await showSecureConfirm(context,
            title: 'Check out ${booking.guestName}?',
            body: 'The Booking becomes Checked-Out, which opens the Review window.')) {
          await _run(booking, action);
        }
        return;
      case AdminAction.complete:
        if (await showSecureConfirm(context,
            title: 'Complete this Booking?',
            body: 'The Booking becomes Completed — its last state, and the stay counts as finished.')) {
          await _run(booking, action);
        }
        return;
    }
  }

  Future<void> _onReschedule(BookingModel booking) async {
    final now = DateTime.now();
    final initialCheckIn = booking.checkInDate;

    final newCheckIn = await showDatePicker(
      context: context,
      initialDate: initialCheckIn.isBefore(now) ? now : initialCheckIn,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
      helpText: 'Select New Check-In Date',
    );
    if (newCheckIn == null) return;

    if (!mounted) return;
    final newCheckOut = await showDatePicker(
      context: context,
      initialDate: newCheckIn.add(const Duration(days: 1)),
      firstDate: newCheckIn.add(const Duration(days: 1)),
      lastDate: newCheckIn.add(const Duration(days: 365)),
      helpText: 'Select New Check-Out Date',
    );
    if (newCheckOut == null) return;

    if (!mounted) return;
    final reason = await _askText('Reschedule Reason', 'Why is this stay being rescheduled?', confirm: 'Reschedule');
    if (reason == null || reason.isEmpty || !mounted) return;

    final confirmed = await showSecureConfirm(
      context,
      title: 'I-reschedule ang booking?',
      body: 'Ililipat ang stay sa ${DateFormatter.formatStayRange(newCheckIn, newCheckOut)}. '
          'Susuriin muli ang availability; hindi ito magpapatuloy kung may conflict.',
      confirm: 'I-reschedule',
    );
    if (!confirmed || !mounted) return;

    final service = ref.read(firestoreServiceProvider);
    final result = await service.rescheduleBooking(
      booking: booking,
      newCheckIn: newCheckIn,
      newCheckOut: newCheckOut,
      reason: reason,
      actor: _actor(),
    );
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      messenger.showSnackBar(SnackBar(
        content: Text('Rescheduled from ${DateFormatter.toIsoDate(newCheckIn)} to ${DateFormatter.toIsoDate(newCheckOut)}'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Reschedule refused.'),
        duration: const Duration(seconds: 6),
      ));
    }
  }

  Future<void> _onRejectCancellation(BookingModel booking) async {
    final reason = await _askText('Reject Cancellation Request', 'Why is the cancellation request rejected? The Guest reads this.', confirm: 'Reject Cancellation');
    if (reason == null || reason.isEmpty || !mounted) return;

    final confirmed = await showSecureConfirm(
      context,
      title: 'Tanggihan ang cancellation request?',
      body: 'Mananatiling aktibo ang booking at ipababatid sa Guest ang dahilan. '
          'Hindi ito magkakansela ng booking.',
      confirm: 'Tanggihan ang Request',
      danger: true,
    );
    if (!confirmed || !mounted) return;

    final service = ref.read(firestoreServiceProvider);
    final result = await service.rejectCancellationRequest(
      booking: booking,
      reason: reason,
      actor: _actor(),
    );
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Cancellation request rejected. Booking remains active.'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Refused.'),
        duration: const Duration(seconds: 6),
      ));
    }
  }

  Future<void> _delete(BookingModel booking) async {
    final ticket = await requirePinTicket(
      context,
      ref: ref,
      title: 'Delete Booking',
      consequence:
          'This removes the document entirely — the Activity log with it. Prefer Reject or Cancel; this is for test entries and duplicates.',
    );
    if (ticket == null) return;
    if (!mounted) return;
    final problem = await ref
        .read(firestoreServiceProvider)
        .deleteBooking(booking.id, ticket: ticket);
    if (!mounted) return;
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(problem),
        duration: const Duration(seconds: 6),
      ));
      return;
    }
    Navigator.of(context).pop();
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  void _showInvoice(BookingModel booking) {
    showDialog(
      context: context,
      builder: (_) => BookingInvoiceDialog(booking: booking),
    );
  }

  Future<void> _handleLateCheckoutRequest(BookingModel booking, bool approve) async {
    final req = booking.raw['late_checkout_request'] as Map<String, dynamic>?;
    if (req == null) return;

    final hours = (req['hours'] is num) ? (req['hours'] as num).toInt() : 1;
    final fee = (req['fee'] is num) ? (req['fee'] as num).toDouble() : (hours * 250.0);

    final confirmed = await showSecureConfirm(
      context,
      title: approve ? 'Aprubahan ang late checkout?' : 'Tanggihan ang late checkout?',
      body: approve
          ? 'Magdaragdag ito ng +$hours oras at ₱${fee.toStringAsFixed(2)} sa naitalang singil at balance ni ${booking.guestName}.'
          : 'Tatanggihan ang +$hours oras na request. Walang dagdag na singil na ilalagay.',
      confirm: approve ? 'Aprubahan ang Dagdag' : 'Tanggihan ang Request',
      danger: !approve,
    );
    if (!confirmed || !mounted) return;

    final rawCharges = booking.raw['additional_charges'] is List
        ? List<Map<String, dynamic>>.from(booking.raw['additional_charges'] as List)
        : <Map<String, dynamic>>[];

    if (approve) {
      rawCharges.add({
        'description': 'Late Checkout Extension (+$hours hrs)',
        'amount': fee,
      });
    }

    final newLateReq = Map<String, dynamic>.from(req);
    newLateReq['status'] = approve ? 'approved' : 'rejected';

    final patch = <String, dynamic>{
      'late_checkout_request': newLateReq,
      if (approve) 'late_checkout_fee': fee,
      if (approve) 'additional_charges': rawCharges,
      if (approve) 'balance_due': (booking.balanceDue ?? 0.0) + fee,
    };

    final entry = <String, dynamic>{
      'booking_id': booking.id,
      'action': approve ? 'LateCheckoutApproved' : 'LateCheckoutRejected',
      'from_status': booking.rawStatus,
      'to_status': booking.rawStatus,
      'actor': _actor().kind,
      'actor_id': _actor().id,
      'at': DateTime.now().toUtc().toIso8601String(),
      'reason': approve ? 'Approved +$hours hrs late checkout (₱$fee)' : 'Late checkout request declined',
    };

    await _patchAndNotify(
      booking,
      patch,
      entry,
      approve
          ? 'Naaprubahan ang late checkout (+₱${fee.toStringAsFixed(2)}).'
          : 'Tinanggihan ang late-checkout request. Walang dagdag na singil.',
    );
  }

  Future<void> _patchAndNotify(BookingModel booking, Map<String, dynamic> patch, Map<String, dynamic> entry, String snackbarMsg) async {
    if (!mounted) return;
    final service = ref.read(firestoreServiceProvider);
    if (!service.isCloud) {
      // This legacy direct-write flow has no local activity/transaction
      // equivalent. Fail explicitly rather than claiming a demo-only success.
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text('Hindi naisagawa ang late-checkout update. Walang aktibong cloud connection; walang binagong record.'),
        duration: Duration(seconds: 7),
      ));
      return;
    }
    try {
      final refDoc = FirebaseFirestore.instance.collection(AppConstants.colBookings).doc(booking.id);
      final log = refDoc.collection('activity');
      final written = await log.get();
      var seq = -1;
      for (final d in written.docs) {
        final v = d.data()['seq'];
        if (v is num && v > seq) seq = v.toInt();
      }
      seq += 1;
      final batch = FirebaseFirestore.instance.batch();
      batch.update(refDoc, patch);
      batch.set(log.doc('$seq'), {...entry, 'seq': seq});
      await batch.commit();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          backgroundColor: AppColors.statusAlert,
          content: Text('Hindi naisagawa ang late-checkout update. ${ErrorUtils.toUserMessage(e)}'),
          duration: const Duration(seconds: 7),
        ));
      }
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(snackbarMsg)));
  }

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(bookingByIdProvider(widget.bookingId));
    final activity = ref.watch(bookingActivityProvider(widget.bookingId));

    if (booking == null) {
      return const Scaffold(
        appBar: AdminPageHeader(
          title: 'Booking',
          subtitle: 'This record is no longer listed',
        ),
        body: EmptyState(
          icon: Icons.event_busy_outlined,
          title: 'Booking not found',
          subtitle:
              'This Booking is no longer in the live list. Go back and refresh the queue.',
        ),
      );
    }

    final now = DateTime.now();
    final doc = booking.toLifecycleDoc();
    final effective = effectiveStatus(doc, now);
    final expiredButStored = effective == BookingStatuses.expired &&
        booking.rawStatus != BookingStatuses.expired;
    final actions = adminActionsFor(booking.rawStatus);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AdminPageHeader(
        title: booking.refId ?? booking.guestName,
        subtitle: booking.guestName,
        actions: [
          IconButton(
            tooltip: 'Call Guest',
            icon: const Icon(Icons.phone_outlined),
            onPressed: () =>
                _open('tel:${booking.guestPhone.replaceAll(' ', '')}'),
          ),
          PopupMenuButton<String>(
            enabled: !_busy && !_openingProof,
            tooltip: 'More actions',
            onSelected: (v) {
              if (v == 'delete') _serialize(() => _delete(booking));
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'delete', child: Text('Delete Booking…')),
            ],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _header(booking, effective),
          if (expiredButStored) ...[
            const SizedBox(height: 12),
            HaciendaCard(
              borderColor: const Color(0x80F59E0B),
              child: Row(
                children: [
                  const Icon(Icons.timer_off_outlined,
                      color: AppColors.statusWarning),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                        'The 24-hour Date hold ran out before review. The dates are free again; record the expiry so every surface agrees.'),
                  ),
                  TextButton(
                    onPressed: (_busy || _openingProof)
                        ? null
                        : () => _onAction(booking, AdminAction.expire),
                    child: const Text('Record'),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          _actionsCard(booking, actions, expiredButStored),
          const SizedBox(height: 12),
          _stayCard(booking, now, activity.asData?.value ?? const []),
          if (booking.raw['late_checkout_request'] is Map) ...[
            const SizedBox(height: 12),
            _lateCheckoutCard(booking),
          ],
          const SizedBox(height: 12),
          _moneyCard(booking),
          const SizedBox(height: 16),
          const SectionHeader(title: 'Booking Timeline & Activity Log', padding: EdgeInsets.zero),
          const SizedBox(height: 8),
          activity.when(
            data: (entries) => BookingTimelineWidget(activityEntries: entries),
            loading: () => const SizedBox(
              height: 130,
              child: LoadingState(label: 'Reading the activity log…'),
            ),
            error: (e, _) => AdminInlineNotice(
              title: 'Activity log could not be read',
              message: e.toString().split('\n').first,
              tone: AdminNoticeTone.danger,
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _header(BookingModel booking, String effective) {
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(booking.guestName,
                  style: GoogleFonts.inter(
                      fontSize: 22, fontWeight: FontWeight.bold, height: 1.25)),
              const SizedBox(height: 10),
              StatusPill(label: effective, color: _statusColor(effective)),
            ],
          ),
          const SizedBox(height: 4),
          Text('${booking.guestPhone}\n${booking.guestEmail}',
              style: GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted, height: 1.4)),
          if (booking.refId != null || booking.source != null) ...[
            const SizedBox(height: 4),
            Text(
                [
                  if (booking.refId != null) 'Ref ${booking.refId}',
                  if (booking.source != null) 'via ${booking.source}',
                ].join(', '),
                style:
                    GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted)),
          ],
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.primaryForest.withOpacity(0.07),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text('Susunod na hakbang: ${booking.nextStep}',
                style: GoogleFonts.inter(
                    fontSize: 18,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primaryForest)),
          ),
        ],
      ),
    );
  }

  Widget _actionsCard(
      BookingModel booking, List<AdminAction> actions, bool expired) {
    final doc = booking.toLifecycleDoc();
    final blockedReasons = actions
        .map((a) => adminActionBlockedReason(doc, a))
        .whereType<String>()
        .toSet()
        .toList();
    if (actions.isEmpty) {
      return HaciendaCard(
        key: TourKeys.detailActions,
        child: Text(
          'Walang susunod na aksyon — final status na ang ${booking.rawStatus}.',
          style: GoogleFonts.inter(fontSize: 17, color: AppColors.textMuted),
        ),
      );
    }
    return HaciendaCard(
      key: TourKeys.detailActions,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Mga Aksyon',
              style: GoogleFonts.inter(
                  fontSize: 19,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ...actions.map((a) {
                final primary = _isPrimary(a);
                final danger = _isDanger(a);
                final blocked = adminActionBlockedReason(doc, a);
                final onPressed = (_busy || _openingProof || expired || blocked != null)
                    ? null
                    : () => _onAction(booking, a);
                if (primary) {
                  return ElevatedButton.icon(
                    onPressed: onPressed,
                    icon: Icon(_icon(a), size: 16),
                    label: Text(a.label),
                    style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.statusSuccess),
                  );
                }
                return OutlinedButton.icon(
                  onPressed: onPressed,
                  icon: Icon(_icon(a),
                      size: 16,
                      color: danger ? AppColors.statusAlert : null),
                  label: Text(a.label,
                      style: TextStyle(
                          color: danger ? AppColors.statusAlert : null)),
                  style: danger
                      ? OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.statusAlert))
                      : null,
                );
              }),
              if (!['Cancelled', 'Rejected', 'Completed', 'Expired'].contains(booking.rawStatus)) ...[
                OutlinedButton.icon(
                  onPressed: (_busy || _openingProof) ? null : () => _serialize(() => _onReschedule(booking)),
                  icon: const Icon(Icons.edit_calendar, size: 16),
                  label: const Text('Reschedule'),
                ),
                OutlinedButton.icon(
                  onPressed: (_busy || _openingProof) ? null : () => _serialize(() => _onRejectCancellation(booking)),
                  icon: const Icon(Icons.cancel_schedule_send, size: 16),
                  label: const Text('Reject Cancellation'),
                ),
              ],
            ],
          ),
          if (blockedReasons.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(blockedReasons.join(' '),
                style: GoogleFonts.inter(
                    fontSize: 16, color: AppColors.textMuted, height: 1.4)),
          ],
          if (_busy) ...[
            const SizedBox(height: 12),
            const LinearProgressIndicator(minHeight: 4),
            const SizedBox(height: 8),
            const Text(
              'Isinasagawa ang aksyon… huwag pindutin muli.',
              style: TextStyle(fontSize: 16, color: AppColors.textMuted),
            ),
          ],
        ],
      ),
    );
  }

  /// When the stay was actually checked in, begun and checked out, read from the
  /// Activity log (every one of those actions is logged with its time). Shown
  /// only once the Booking has reached that stage; a stage reached before the
  /// log recorded it says so instead of leaving the line out.
  List<Widget> _stayRecordRows(
      BookingModel booking, List<Map<String, dynamic>> log) {
    DateTime? when(String action) {
      DateTime? found;
      for (final e in log) {
        if ('${e['action']}' != action) continue;
        final at = parseInstant(e['at']);
        if (at != null && (found == null || at.isAfter(found))) found = at;
      }
      return found;
    }

    String show(DateTime? d) =>
        d == null ? 'Date not recorded' : DateFormatter.formatFull(d.toLocal());

    final status = booking.rawStatus;
    final rows = <Widget>[];
    if (['Checked-In', 'Staying', 'Checked-Out', 'Completed'].contains(status)) {
      rows.add(_kv('Checked in', show(when('CheckIn'))));
    }
    if (['Staying', 'Checked-Out', 'Completed'].contains(status)) {
      rows.add(_kv('Stay began', show(when('BeginStay'))));
    }
    if (['Checked-Out', 'Completed'].contains(status)) {
      rows.add(_kv('Checked out', show(when('CheckOut'))));
    }
    return rows;
  }

  /// The cancel dialog: a reason from a list (like Reject), what the Guest gets
  /// back under the policy stamped on the Booking, and a way out to Reschedule.
  Future<_CancelChoice?> _askCancel(BookingModel booking) {
    const reasons = [
      'Guest requested cancellation',
      'Accommodation unavailable',
      'Payment problem',
      'Weather or property closure',
      'Other',
    ];
    var selected = reasons.first;
    final remarks = TextEditingController();
    String? dialogError;

    // The owner's policy, not a computed refund: a paid booking is never
    // refunded; the Guest may reschedule within three months; after that the
    // payment is forfeited. The downpayment is non-refundable.
    final paid = booking.rawStatus == BookingStatuses.reserved ||
        (booking.rawStatus == BookingStatuses.approved &&
            booking.toLifecycleDoc()['payment_status'] == 'verified');
    final String refundLine = paid
        ? 'Policy: the downpayment is non-refundable. The Guest may reschedule within 3 months; after that the payment is forfeited. Use "Reschedule instead" to keep the payment, or cancel to forfeit it.'
        : 'No payment has been verified on this Booking, so nothing is charged and nothing is forfeited.';

    return showDialog<_CancelChoice>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('Cancel Booking',
              style:
                  GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 20)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(refundLine, style: const TextStyle(fontSize: 16)),
                const SizedBox(height: 12),
                const Text('Select cancellation reason:',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: selected,
                  isExpanded: true,
                  items: reasons
                      .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                      .toList(),
                  onChanged: (val) {
                    if (val != null) {
                      setDialogState(() {
                        selected = val;
                        dialogError = null;
                      });
                    }
                  },
                  decoration:
                      const InputDecoration(border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                Text(
                  selected == 'Other'
                      ? 'Remarks (Required for "Other"):'
                      : 'Remarks (Optional):',
                  style:
                      const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: remarks,
                  maxLines: 2,
                  style: const TextStyle(fontSize: 18),
                  decoration: const InputDecoration(
                      hintText: 'Notes the Guest will read...',
                      border: OutlineInputBorder()),
                  onChanged: (_) {
                    if (dialogError != null) {
                      setDialogState(() => dialogError = null);
                    }
                  },
                ),
                if (dialogError != null) ...[
                  const SizedBox(height: 6),
                  Text(dialogError!,
                      style: const TextStyle(fontSize: 16, color: AppColors.alertDangerText)),
                ],
              ],
            ),
          ),
          actions: [
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx),
                    child: const Text('Bumalik')),
                TextButton(
                    onPressed: () =>
                        Navigator.pop(ctx, const _CancelChoice.reschedule()),
                    child: const Text('Mag-reschedule na lang')),
                ElevatedButton(
                  onPressed: () {
                    final text = remarks.text.trim();
                    if (selected == 'Other' && text.isEmpty) {
                      setDialogState(
                          () => dialogError = 'Please say why, so the Guest knows.');
                      return;
                    }
                    final reason = selected == 'Other'
                        ? text
                        : (text.isNotEmpty ? '$selected ($text)' : selected);
                    Navigator.pop(ctx, _CancelChoice(reason));
                  },
                  child: const Text('Kanselahin ang Booking'),
                ),
              ],
            ),
          ],
        ),
      ),
    ).whenComplete(remarks.dispose);
  }

  Widget _stayCard(BookingModel booking, DateTime now,
      List<Map<String, dynamic>> log) {
    final hold = holdRemaining(booking.toLifecycleDoc(), now);
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The stored id, named from the published rates document.
          _kv(
              'Accommodation',
              BookingModel.accommodationLabel(
                  booking.accommodation, ref.watch(accommodationsProvider))),
          _kv('Dates',
              '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)}, ${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)}'),
          _kv('Guests', '${booking.guestCount}'),
          if (booking.specialRequests != null &&
              booking.specialRequests!.isNotEmpty)
            _kv('Notes', booking.specialRequests!),
          _kv('Submitted', DateFormatter.formatFull(booking.createdAt)),
          ..._stayRecordRows(booking, log),
          if (isHoldExpirable(booking.rawStatus))
            _kv('Date hold',
                booking.holdExpiresAt == null
                    ? 'No hold recorded (pre-hold Booking)'
                    : formatHoldCountdown(hold)),
          if (booking.rejectionReason != null)
            _kv('Rejected because', booking.rejectionReason!),
          if (booking.cancellationReason != null)
            _kv('Cancelled because', booking.cancellationReason!),
        ],
      ),
    );
  }

  Widget _moneyCard(BookingModel booking) {
    String peso(double? v) => v == null ? '—' : '₱${v.toStringAsFixed(2)}';
    final paymentStatus = (booking.paymentStatus ?? 'unpaid').toLowerCase();
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Bayad at Patunay',
                  style: GoogleFonts.inter(
                      fontSize: 19, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              StatusPill(
                  label: paymentStatus.toUpperCase(),
                  color: _paymentColor(paymentStatus)),
            ],
          ),
          const SizedBox(height: 8),
          if (booking.paymentPlan != null) _kv('Plan', booking.paymentPlan!),
          if (booking.policyVersion != null)
            _kv('Policy version', booking.policyVersion!),
          if (booking.rateClassification != null)
            _kv('Rate schedule', booking.rateClassification == 'weekend_holiday'
                ? 'Weekend / Admin holiday (Friday/Saturday check-in night)'
                : 'Weekday (Sunday–Thursday check-in night)'),
          if (booking.raw['rate_amount'] is num)
            _kv('Stay rate snapshot', peso((booking.raw['rate_amount'] as num).toDouble())),
          _kv('Stay total', peso(booking.stayTotal ?? booking.totalAmount)),
          if (booking.amountDue != null) _kv('Due now', peso(booking.amountDue)),
          if (booking.securityDeposit != null)
            _kv('Security deposit', peso(booking.securityDeposit)),
          if (booking.balanceDue != null)
            _kv('Balance due at check-in', peso(booking.balanceDue)),
          if (booking.amountClaimed != null)
            _kv('Guest says they sent', peso(booking.amountClaimed)),
          if (booking.amountVerified != null)
            _kv('Verified', peso(booking.amountVerified)),
          if (booking.paymentProofUrl != null)
            _proofButton(booking),
          if (booking.paymentRejectReason != null)
            _kv('Proof rejected because', booking.paymentRejectReason!),
          if (booking.refundStatus != null && booking.refundStatus != 'none') ...[
            const Divider(height: 20),
            _kv('Refund', '${booking.refundStatus}, ${peso(booking.refundTotal)}'),
            if (booking.raw['refund_breakdown'] is Map)
              ...((booking.raw['refund_breakdown'] as Map).entries.map(
                  (e) => _kv('  ${e.key}', peso((e.value as num?)?.toDouble())))),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _showInvoice(booking),
              icon: const Icon(Icons.receipt, size: 18),
              label: const Text('Tingnan ang Opisyal na Invoice'),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.primaryForest),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _lateCheckoutCard(BookingModel booking) {
    final req = Map<String, dynamic>.from(booking.raw['late_checkout_request'] as Map);
    final hours = req['hours'] ?? 1;
    final fee = req['fee'] ?? (hours * 250);
    final status = (req['status'] ?? 'pending').toString();
    final statusColor = StatusStyle.lateCheckout(status);

    return HaciendaCard(
      borderColor: AppColors.accentGold,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Late Checkout Request',
            style: GoogleFonts.inter(fontSize: 19, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          StatusPill(
            label: status.toUpperCase(),
            color: statusColor,
          ),
          const SizedBox(height: 12),
          Text(
            'Hiling ng Guest: +$hours oras, Fee: ₱$fee',
            style: GoogleFonts.inter(fontSize: 18, color: AppColors.textDark, height: 1.4),
          ),
          if (status == 'pending') ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_busy || _openingProof) ? null : () => _serialize(() => _handleLateCheckoutRequest(booking, true)),
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusSuccess),
                child: Text('Aprubahan (+₱$fee)'),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: (_busy || _openingProof) ? null : () => _serialize(() => _handleLateCheckoutRequest(booking, false)),
                style: OutlinedButton.styleFrom(foregroundColor: AppColors.statusAlert),
                child: const Text('Tanggihan ang Request'),
              ),
            ),
          ],
        ],
      ),
    );
  }


  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(k, style: GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted)),
            const SizedBox(height: 3),
            Text(
              v,
              style: GoogleFonts.inter(fontSize: 18, height: 1.35, color: AppColors.textDark),
            ),
          ],
        ),
      );

  /// Open the proof as a photo.
  ///
  /// payment_proof_url is a Supabase storage path, not a link, and the bucket
  /// is private, so there is nothing here to launch. The function signs a URL
  /// that lasts 60 seconds and the viewer opens on it.
  Future<void> _openProof(BookingModel booking) async {
    if (_busy || _openingProof) return;
    final path = booking.paymentProofUrl;
    if (path == null || path.isEmpty) return;

    setState(() => _openingProof = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await PaymentProofService.signedUrl(path);
      if (!mounted) return;
      final failure = result.error;
      if (failure != null) {
        messenger.showSnackBar(SnackBar(
          content: Text(failure),
          backgroundColor: AppColors.statusAlert,
        ));
        return;
      }
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => PaymentProofViewer(url: result.url!)),
      );
    } catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text('Hindi mabuksan ang proof. ${error.toString().split('\n').first}'),
      ));
    } finally {
      if (mounted) setState(() => _openingProof = false);
    }
  }

  /// A real button rather than a line of text that happens to be tappable:
  /// reading the screenshot is the step this screen exists for, and it should
  /// look like the step it is.
  Widget _proofButton(BookingModel booking) => Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 2),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: (_busy || _openingProof) ? null : () => _openProof(booking),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.accentGold,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            icon: _openingProof
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.black))
                : const Icon(Icons.receipt_long, size: 18),
            label: Text(
              _openingProof ? 'Binubuksan ang proof…' : 'Buksan at Suriin ang Payment Proof',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ),
      );


  static bool _isPrimary(AdminAction a) =>
      a == AdminAction.approve ||
      a == AdminAction.verifyPayment ||
      a == AdminAction.checkIn ||
      a == AdminAction.beginStay ||
      a == AdminAction.checkOut ||
      a == AdminAction.complete ||
      a == AdminAction.markRefunded;

  static bool _isDanger(AdminAction a) =>
      a == AdminAction.reject ||
      a == AdminAction.rejectPaymentProof ||
      a == AdminAction.cancel ||
      a == AdminAction.revokeKey;

  static IconData _icon(AdminAction a) {
    switch (a) {
      case AdminAction.approve:
        return Icons.check;
      case AdminAction.reject:
        return Icons.close;
      case AdminAction.verifyPayment:
        return Icons.verified_outlined;
      case AdminAction.rejectPaymentProof:
        return Icons.receipt_long;
      case AdminAction.cancel:
        return Icons.cancel_outlined;
      case AdminAction.markRefunded:
        return Icons.currency_exchange;
      case AdminAction.revokeKey:
        return Icons.key_off_outlined;
      case AdminAction.expire:
        return Icons.timer_off_outlined;
      case AdminAction.checkIn:
        return Icons.door_front_door_outlined;
      case AdminAction.beginStay:
        return Icons.night_shelter_outlined;
      case AdminAction.checkOut:
        return Icons.logout;
      case AdminAction.complete:
        return Icons.task_alt;
    }
  }

  static Color _statusColor(String status) => StatusStyle.color(status);

  static Color _paymentColor(String s) => StatusStyle.payment(s);
}

/// What the Admin chose in the cancel dialog: a reason to cancel, or a
/// reschedule instead.
class _CancelChoice {
  final String? reason;
  final bool reschedule;
  const _CancelChoice(this.reason) : reschedule = false;
  const _CancelChoice.reschedule()
      : reason = null,
        reschedule = true;
}
