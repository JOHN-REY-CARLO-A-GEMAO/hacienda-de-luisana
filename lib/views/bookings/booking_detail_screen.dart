import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';

import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/section_header.dart';
import '../../widgets/status_pill.dart';

/// One Booking, end to end: who, when, the KYC documents, the money, the
/// refund, and every lifecycle action the Admin can take from its current
/// status — plus the append-only Activity log underneath.
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

  Actor _actor() {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return Actor.admin(
      auth.uid ?? auth.sessionEmail ?? 'admin',
      auth.displayName ?? auth.sessionEmail,
    );
  }

  Future<void> _run(BookingModel booking, AdminAction action,
      {ActionInput input = const ActionInput(), Actor? actor}) async {
    setState(() => _busy = true);
    final service = ref.read(firestoreServiceProvider);
    final result = await service.applyBookingAction(
      booking,
      action,
      actor ?? _actor(),
      input: input,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    final messenger = ScaffoldMessenger.of(context);
    if (result.ok) {
      messenger.showSnackBar(SnackBar(
        content: Text(
            '${action.label}: ${result.patch['status']} — ${booking.guestName}'),
      ));
    } else {
      messenger.showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(result.reason ?? 'Refused.'),
        duration: const Duration(seconds: 6),
      ));
    }
  }

  Future<String?> _askText(String title, String hint,
      {String confirm = 'Save', bool optional = false}) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title,
            style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          decoration: InputDecoration(
              hintText: hint, border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Back')),
          ElevatedButton(
            onPressed: () {
              final text = controller.text.trim();
              if (text.isEmpty && !optional) return;
              Navigator.pop(ctx, text);
            },
            child: Text(confirm),
          ),
        ],
      ),
    );
    return value;
  }

  Future<double?> _askAmount(String title, String hint, double? initial) async {
    final controller =
        TextEditingController(text: initial == null ? '' : initial.toStringAsFixed(2));
    return showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title,
            style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
              prefixText: '₱ ', hintText: hint, border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Back')),
          ElevatedButton(
            onPressed: () {
              final v = double.tryParse(controller.text.replaceAll(',', ''));
              if (v == null) return;
              Navigator.pop(ctx, v);
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  Future<bool> _confirm(String title, String body,
      {String confirm = 'Confirm', bool danger = false}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title,
            style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Text(body),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Back')),
          ElevatedButton(
            style: danger
                ? ElevatedButton.styleFrom(
                    backgroundColor: AppColors.statusAlert)
                : null,
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(confirm),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _onAction(BookingModel booking, AdminAction action) async {
    switch (action) {
      case AdminAction.approve:
        if (await _confirm('Approve Booking',
            'The ID is reviewed and the dates are re-checked against other Bookings. The Guest is then asked to pay.')) {
          await _run(booking, action);
        }
        return;
      case AdminAction.reject:
        final reason = await _askText('Reject Booking',
            'Why is this Booking refused? The Guest reads this.',
            confirm: 'Reject');
        if (reason != null) {
          await _run(booking, action, input: ActionInput(reason: reason));
        }
        return;
      case AdminAction.rejectKyc:
        final reason = await _askText('Refuse this ID',
            'What is wrong with the ID? The Guest can send another.',
            confirm: 'Refuse ID');
        if (reason != null) {
          await _run(booking, action, input: ActionInput(reason: reason));
        }
        return;
      case AdminAction.verifyPayment:
        final owed = (booking.amountDue ?? 0) + (booking.securityDeposit ?? 0);
        final amount = await _askAmount('Verify payment',
            'Amount on the proof (₱${owed.toStringAsFixed(2)} due)',
            booking.amountClaimed ?? (owed > 0 ? owed : null));
        if (amount != null) {
          await _run(booking, action,
              input: ActionInput(amountVerified: amount));
        }
        return;
      case AdminAction.rejectPaymentProof:
        final reason = await _askText('Reject payment proof',
            'Why is the proof rejected? The Guest reads this.',
            confirm: 'Next');
        if (reason == null) return;
        if (!mounted) return;
        final resubmits = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text('Let the Guest resend?',
                style:
                    GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
            content: const Text(
                'Yes keeps the Booking in Payment Pending so the Guest can send another proof. No cancels the Booking (no verified money, so nothing to refund).'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('No — cancel Booking')),
              ElevatedButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Yes — let them resend')),
            ],
          ),
        );
        if (resubmits == null) return;
        await _run(booking, action,
            input: ActionInput(reason: reason, guestResubmits: resubmits));
        return;
      case AdminAction.cancel:
        final reason = await _askText('Cancel Booking',
            'Reason (optional). A Reserved Booking is settled under the published refund policy.',
            confirm: 'Cancel Booking', optional: true);
        if (reason == null) return;
        double? damage;
        if (booking.rawStatus == BookingStatuses.reserved) {
          damage = await _askAmount('Damage deduction',
              'Deducted from the Security deposit (0 if none)', 0);
          if (damage == null) return;
        }
        await _run(booking, action,
            input: ActionInput(
                reason: reason.isEmpty ? null : reason,
                damageDeduction: damage));
        return;
      case AdminAction.markRefunded:
        if (await _confirm('Mark refunded',
            '₱${(booking.refundTotal ?? 0).toStringAsFixed(2)} has been returned to the Guest?')) {
          await _run(booking, action);
        }
        return;
      case AdminAction.purgeKyc:
        if (await _confirm('Purge government ID',
            'Clears the ID and receipt URLs from this Booking (RA 10173). Delete the files in Storage as well.',
            confirm: 'Purge', danger: true)) {
          await _run(booking, action);
        }
        return;
      case AdminAction.revokeKey:
        if (await _confirm('Revoke Credential',
            'The Guest\'s door Credential is revoked; the lock drops it on its next touch.',
            confirm: 'Revoke', danger: true)) {
          await _run(booking, action);
        }
        return;
      case AdminAction.expire:
        await _run(booking, action, actor: const Actor.system());
        return;
      case AdminAction.checkIn:
      case AdminAction.beginStay:
      case AdminAction.checkOut:
      case AdminAction.complete:
        await _run(booking, action);
        return;
    }
  }

  Future<void> _delete(BookingModel booking) async {
    if (!await _confirm('Delete Booking',
        'Remove this Booking document entirely? Prefer Reject or Cancel — this is for test entries and duplicates.',
        confirm: 'Delete', danger: true)) {
      return;
    }
    await ref.read(firestoreServiceProvider).deleteBooking(booking.id);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(bookingByIdProvider(widget.bookingId));
    final activity = ref.watch(bookingActivityProvider(widget.bookingId));

    if (booking == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Booking')),
        body: const Center(child: Text('This Booking is no longer listed.')),
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
      appBar: AppBar(
        title: Text(booking.refId ?? booking.guestName,
            style: GoogleFonts.cinzel(fontSize: 16, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            tooltip: 'Call Guest',
            icon: const Icon(Icons.phone_outlined),
            onPressed: () =>
                _open('tel:${booking.guestPhone.replaceAll(' ', '')}'),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'delete') _delete(booking);
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
              borderColor: AppColors.statusWarning.withOpacity(0.5),
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
                    onPressed: _busy
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
          _stayCard(booking, now),
          const SizedBox(height: 12),
          _kycCard(booking),
          const SizedBox(height: 12),
          _moneyCard(booking),
          const SizedBox(height: 16),
          const SectionHeader(title: 'Activity log', padding: EdgeInsets.zero),
          const SizedBox(height: 6),
          activity.when(
            data: (entries) => entries.isEmpty
                ? const HaciendaCard(
                    child: Text('No entries yet.',
                        style: TextStyle(color: AppColors.textMuted)))
                : Column(
                    children: entries.reversed
                        .map((e) => _activityTile(e))
                        .toList()),
            loading: () => const Center(
                child: Padding(
                    padding: EdgeInsets.all(12),
                    child: CircularProgressIndicator())),
            error: (e, _) => Text('Could not load the log: $e'),
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
          Row(
            children: [
              Expanded(
                child: Text(booking.guestName,
                    style: GoogleFonts.inter(
                        fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              StatusPill(label: effective, color: _statusColor(effective)),
            ],
          ),
          const SizedBox(height: 4),
          Text('${booking.guestPhone} · ${booking.guestEmail}',
              style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
          if (booking.refId != null || booking.source != null) ...[
            const SizedBox(height: 4),
            Text(
                [
                  if (booking.refId != null) 'Ref ${booking.refId}',
                  if (booking.source != null) 'via ${booking.source}',
                ].join(' · '),
                style:
                    GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
          ],
          const SizedBox(height: 10),
          Text(booking.nextStep,
              style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.primaryForest)),
        ],
      ),
    );
  }

  Widget _actionsCard(
      BookingModel booking, List<AdminAction> actions, bool expired) {
    if (actions.isEmpty) {
      return HaciendaCard(
        child: Text(
          'Nothing to do — ${booking.rawStatus} is a final status.',
          style: GoogleFonts.inter(color: AppColors.textMuted),
        ),
      );
    }
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Actions',
              style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.1,
                  color: AppColors.textMuted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: actions.map((a) {
              final primary = _isPrimary(a);
              final danger = _isDanger(a);
              final onPressed =
                  (_busy || expired) ? null : () => _onAction(booking, a);
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
            }).toList(),
          ),
          if (_busy) ...[
            const SizedBox(height: 10),
            const LinearProgressIndicator(minHeight: 2),
          ],
        ],
      ),
    );
  }

  Widget _stayCard(BookingModel booking, DateTime now) {
    final hold = holdRemaining(booking.toLifecycleDoc(), now);
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv('Accommodation', booking.accommodation),
          _kv('Dates',
              '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)} · ${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)}'),
          _kv('Guests', '${booking.guestCount}'),
          if (booking.specialRequests != null &&
              booking.specialRequests!.isNotEmpty)
            _kv('Notes', booking.specialRequests!),
          _kv('Submitted', DateFormatter.formatFull(booking.createdAt)),
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

  Widget _kycCard(BookingModel booking) {
    final status = (booking.kycStatus ?? 'required').toLowerCase();
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('KYC — government ID',
                    style: GoogleFonts.inter(
                        fontSize: 13, fontWeight: FontWeight.bold)),
              ),
              StatusPill(label: status.toUpperCase(), color: _kycColor(status)),
            ],
          ),
          const SizedBox(height: 8),
          if (booking.kycIdUrl == null && booking.kycReceiptUrl == null)
            Text('Nothing uploaded yet.',
                style: GoogleFonts.inter(color: AppColors.textMuted, fontSize: 12)),
          if (booking.kycIdUrl != null)
            _link('Open government ID', booking.kycIdUrl!),
          if (booking.kycReceiptUrl != null)
            _link('Open receipt', booking.kycReceiptUrl!),
          if (booking.kycRejectReason != null)
            _kv('Refused because', booking.kycRejectReason!),
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
          Row(
            children: [
              Expanded(
                child: Text('Payment',
                    style: GoogleFonts.inter(
                        fontSize: 13, fontWeight: FontWeight.bold)),
              ),
              StatusPill(
                  label: paymentStatus.toUpperCase(),
                  color: _paymentColor(paymentStatus)),
            ],
          ),
          const SizedBox(height: 8),
          if (booking.paymentPlan != null) _kv('Plan', booking.paymentPlan!),
          if (booking.policyVersion != null)
            _kv('Policy version', booking.policyVersion!),
          _kv('Stay total', peso(booking.stayTotal ?? booking.totalAmount)),
          if (booking.amountDue != null) _kv('Due now', peso(booking.amountDue)),
          if (booking.securityDeposit != null)
            _kv('Security deposit', peso(booking.securityDeposit)),
          if (booking.balanceDue != null)
            _kv('Balance at stay', peso(booking.balanceDue)),
          if (booking.amountClaimed != null)
            _kv('Guest says they sent', peso(booking.amountClaimed)),
          if (booking.amountVerified != null)
            _kv('Verified', peso(booking.amountVerified)),
          if (booking.paymentProofUrl != null)
            _link('Open payment proof', booking.paymentProofUrl!),
          if (booking.paymentRejectReason != null)
            _kv('Proof rejected because', booking.paymentRejectReason!),
          if (booking.refundStatus != null && booking.refundStatus != 'none') ...[
            const Divider(height: 20),
            _kv('Refund', '${booking.refundStatus} · ${peso(booking.refundTotal)}'),
            if (booking.raw['refund_breakdown'] is Map)
              ...((booking.raw['refund_breakdown'] as Map).entries.map(
                  (e) => _kv('  ${e.key}', peso((e.value as num?)?.toDouble())))),
          ],
        ],
      ),
    );
  }

  Widget _activityTile(Map<String, dynamic> e) {
    final at = parseInstant(e['at']);
    final actor = e['actor_name'] != null
        ? '${e['actor_name']} (${_roleLabel(e['actor'])})'
        : _roleLabel(e['actor']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: HaciendaCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_headline(e['action']?.toString() ?? ''),
                style: GoogleFonts.inter(
                    fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text('${e['from_status']} → ${e['to_status']} · $actor',
                style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
            Text(at == null ? '${e['at']}' : DateFormatter.formatFull(at.toLocal()),
                style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
            if (e['reason'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${e['reason']}',
                    style: GoogleFonts.inter(
                        fontSize: 12, fontStyle: FontStyle.italic)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 130,
              child: Text(k,
                  style: GoogleFonts.inter(
                      fontSize: 12, color: AppColors.textMuted)),
            ),
            Expanded(
              child: Text(v, style: GoogleFonts.inter(fontSize: 13)),
            ),
          ],
        ),
      );

  Widget _link(String label, String url) => Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => _open(url),
          icon: const Icon(Icons.open_in_new, size: 16),
          label: Text(label),
        ),
      );

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
      'Submit': 'Booking submitted',
      'UploadKyc': 'Government ID uploaded for KYC',
      'Approve': 'Booking approved',
      'Reject': 'Booking rejected',
      'RejectKyc': 'Government ID refused — the Guest can send another',
      'ChoosePaymentPlan': 'Payment plan chosen',
      'UploadPaymentProof': 'Payment proof uploaded',
      'VerifyPayment': 'Payment proof verified — Booking Reserved',
      'RejectPaymentProof': 'Payment proof rejected',
      'MarkRefunded': 'Refund returned to the Guest',
      'PurgeKyc': 'Government ID and receipt purged after the stay',
      'RevokeKey': 'Credential revoked by the Admin',
      'Cancel': 'Booking cancelled',
      'Expire': 'Date hold ran out',
      'CheckIn': 'First Credential use — Guest checked in',
      'BeginStay': 'Stay in progress',
      'CheckOut': 'Guest checked out',
      'Complete': 'Stay completed',
      'SetStatus': 'Status set directly by the Admin',
    };
    return headlines[action] ?? action;
  }

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
      a == AdminAction.rejectKyc ||
      a == AdminAction.rejectPaymentProof ||
      a == AdminAction.cancel ||
      a == AdminAction.revokeKey ||
      a == AdminAction.purgeKyc;

  static IconData _icon(AdminAction a) {
    switch (a) {
      case AdminAction.approve:
        return Icons.check;
      case AdminAction.reject:
        return Icons.close;
      case AdminAction.rejectKyc:
        return Icons.badge_outlined;
      case AdminAction.verifyPayment:
        return Icons.verified_outlined;
      case AdminAction.rejectPaymentProof:
        return Icons.receipt_long_outlined;
      case AdminAction.cancel:
        return Icons.cancel_outlined;
      case AdminAction.markRefunded:
        return Icons.currency_exchange;
      case AdminAction.purgeKyc:
        return Icons.delete_sweep_outlined;
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

  static Color _statusColor(String status) {
    switch (status) {
      case BookingStatuses.pending:
      case BookingStatuses.kycSubmitted:
        return AppColors.statusWarning;
      case BookingStatuses.approved:
      case BookingStatuses.paymentPending:
        return AppColors.accentGoldDark;
      case BookingStatuses.paymentVerified:
      case BookingStatuses.reserved:
        return AppColors.statusSuccess;
      case BookingStatuses.checkedIn:
      case BookingStatuses.staying:
        return const Color(0xFF1D3557);
      case BookingStatuses.checkedOut:
      case BookingStatuses.completed:
        return AppColors.textMuted;
      default:
        return AppColors.statusAlert;
    }
  }

  static Color _kycColor(String s) {
    switch (s) {
      case 'approved':
        return AppColors.statusSuccess;
      case 'submitted':
        return AppColors.statusWarning;
      case 'rejected':
        return AppColors.statusAlert;
      default:
        return AppColors.textMuted;
    }
  }

  static Color _paymentColor(String s) {
    switch (s) {
      case 'verified':
        return AppColors.statusSuccess;
      case 'pending':
        return AppColors.statusWarning;
      case 'rejected':
        return AppColors.statusAlert;
      default:
        return AppColors.textMuted;
    }
  }
}
