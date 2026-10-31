import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/status_style.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_lifecycle.dart';
import '../../services/payment_proof_service.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../bookings/payment_proof_viewer.dart';
import '../bookings/payment_verification_queue_screen.dart';
import '../security/secure_action_sheet.dart';

/// Admin's view of payment references.
///
/// Two kinds of row share the `payment_references` collection:
/// * catalog rows the Admin adds by hand (`status` `available`/`used`/`void`,
///   no Booking link) — the list a proof is checked against; and
/// * payment rows written when the Admin verifies a Guest's proof
///   (`status` `verified`/`pending_review`, linked to a Booking through
///   `booking_id`, with sender name, payment date and proof path).
///
/// OCR extraction alone never marks anything verified: an Admin opens the
/// proof, checks the reference and amount, and only then does a row become
/// `verified`. Rows the Admin is unsure of stay `pending_review` and can be
/// corrected here instead of being silently overwritten.
class PaymentRefsScreen extends ConsumerStatefulWidget {
  const PaymentRefsScreen({super.key});

  @override
  ConsumerState<PaymentRefsScreen> createState() => _PaymentRefsScreenState();
}

class _RefRow {
  _RefRow({
    required this.reference,
    required this.amount,
    required this.status,
    this.bookingId,
    this.senderName,
    this.paymentDate,
    this.proofUrl,
    this.source,
    this.docId,
  });
  final String reference;
  final double amount;
  final String status;
  final String? bookingId;
  final String? senderName;
  final String? paymentDate;
  final String? proofUrl;

  /// `admin_confirmed`, `guest_claimed` or `ocr` — who supplied the reference
  /// on a payment row. Only the first two can carry `verified`.
  final String? source;
  final String? docId;

  /// Whether this row records a Guest's actual payment on a Booking.
  bool get isPaymentRow => bookingId != null && bookingId!.isNotEmpty;

  /// Whether the rules allow this row to be deleted (only unused catalog rows).
  bool get deletable => status == 'available' && !isPaymentRow;

  bool get canCorrect => status == 'pending_review';
}

class _PaymentRefsScreenState extends ConsumerState<PaymentRefsScreen> {
  final _ref = TextEditingController();
  final _amount = TextEditingController();
  final _search = TextEditingController();
  String _sort = 'created_at';
  final List<_RefRow> _rows = [];
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  StreamSubscription<QuerySnapshot>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscribeToPaymentReferences();
  }

  @override
  void dispose() {
    _ref.dispose();
    _amount.dispose();
    _search.dispose();
    _subscription?.cancel();
    super.dispose();
  }

  void _subscribeToPaymentReferences() {
    _subscription = _firestore
        .collection(AppConstants.colPaymentReferences)
        .orderBy('created_at', descending: true)
        .snapshots()
        .listen((snapshot) {
      setState(() {
        _rows.clear();
        for (var doc in snapshot.docs) {
          final data = doc.data();
          _rows.add(_RefRow(
            reference: data['reference'] as String? ?? '',
            amount: (data['amount'] as num?)?.toDouble() ?? 0.0,
            status: data['status'] as String? ?? 'available',
            bookingId: data['booking_id'] as String?,
            senderName: data['sender_name'] as String?,
            paymentDate: data['payment_date'] as String?,
            proofUrl: data['proof_url'] as String?,
            source: data['reference_source'] as String?,
            docId: doc.id,
          ));
        }
      });
    }, onError: (e) {
      print('Error loading payment references: $e');
    });
  }

  Future<void> _add() async {
    final reference = _ref.text.trim().toUpperCase();
    final amt = double.tryParse(_amount.text.trim().replaceAll(',', ''));
    if (_ref.text.isEmpty || !RegExp(r'^[A-Z0-9-]{6,40}$').hasMatch(reference)) {
      _toast('Enter a valid reference (letters, numbers, hyphens).');
      return;
    }
    if (amt == null || amt <= 0) {
      _toast('Enter a valid amount.');
      return;
    }
    if (_rows.any((r) => r.reference == reference)) {
      _toast('That reference is already on the list.');
      return;
    }
    final ok = await showSecureConfirm(
      context,
      title: 'Add the reference?',
      body: '$reference for ₱${amt.toStringAsFixed(2)} joins the list a proof is checked against.',
      confirm: 'Add',
    );
    if (!ok || !mounted) return;

    try {
      await _firestore.collection(AppConstants.colPaymentReferences).add({
        'reference': reference,
        'amount': amt,
        'status': 'available',
        'created_at': FieldValue.serverTimestamp(),
      });
      _ref.clear();
      _amount.clear();
      _toast('Reference added successfully.');
    } catch (e) {
      _toast('Failed to add reference: $e');
    }
  }

  void _toast(String m) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _confirmDelete(_RefRow row) async {
    final ok = await showSecureConfirm(
      context,
      title: 'Delete reference?',
      body: 'Remove ${row.reference} from the payment reference list?',
      confirm: 'Delete',
      danger: true,
    );
    if (ok == true && mounted) {
      try {
        await _firestore
            .collection(AppConstants.colPaymentReferences)
            .doc(row.docId)
            .delete();
        _toast('Reference deleted successfully.');
      } catch (e) {
        _toast('Failed to delete reference: $e');
      }
    }
  }

  /// Correct an uncertain extraction: sender name, payment date and the
  /// verification status. The reference number and amount are the evidence on
  /// the receipt and may not be moved once written.
  Future<void> _correctRow(_RefRow row) async {
    final refCtrl = TextEditingController(text: row.senderName ?? '');
    final dateCtrl = TextEditingController(text: row.paymentDate ?? '');
    var status = row.status;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Correct payment record'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(
                'Reference ${row.reference} (cannot be changed here — rules keep '
                'a filed reference as evidence; correct it on the Booking)',
                style: const TextStyle(fontSize: 13, color: Colors.grey),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: refCtrl,
                decoration: const InputDecoration(
                  labelText: 'Sender name',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: dateCtrl,
                decoration: const InputDecoration(
                  labelText: 'Payment date (YYYY-MM-DD)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: status,
                items: const [
                  DropdownMenuItem(value: 'pending_review', child: Text('Pending review')),
                  DropdownMenuItem(value: 'verified', child: Text('Verified')),
                ],
                onChanged: (v) => setDialogState(() => status = v ?? 'pending_review'),
                decoration: const InputDecoration(
                  labelText: 'Verification status',
                  border: OutlineInputBorder(),
                ),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Bumalik')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _firestore
          .collection(AppConstants.colPaymentReferences)
          .doc(row.docId)
          .set({
        'sender_name': refCtrl.text.trim().isEmpty ? null : refCtrl.text.trim(),
        'payment_date': dateCtrl.text.trim().isEmpty ? null : dateCtrl.text.trim(),
        'status': status,
      }, SetOptions(merge: true));
      _toast('Payment record updated.');
    } catch (e) {
      _toast('Failed to update record: $e');
    }
  }

  /// Open the stored proof through the Admin's signed URL (ADR-0011).
  Future<void> _openProof(String path) async {
    final result = await PaymentProofService.signedUrl(path);
    if (!mounted) return;
    if (result.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(result.error!),
        backgroundColor: AppColors.statusAlert,
      ));
      return;
    }
    if (result.url != null) {
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => PaymentProofViewer(url: result.url!)),
      );
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'verified':
        return AppColors.statusSuccess;
      case 'pending_review':
        return AppColors.statusWarning;
      case 'available':
        return AppColors.statusInfo;
      case 'used':
        return AppColors.textMuted;
      case 'void':
        return AppColors.statusAlert;
      default:
        return AppColors.textMuted;
    }
  }

  Widget _buildRow(_RefRow row, Map<String, BookingModel> byId) {
    final booking = row.bookingId != null ? byId[row.bookingId!] : null;
    final guestLine = booking != null
        ? '${booking.guestName}${booking.refId != null ? ' (Ref ${booking.refId})' : ''}'
        : row.isPaymentRow
            ? 'Booking not found'
            : 'catalog entry';
    final dateLine =
        row.paymentDate != null ? ' · ${row.paymentDate}' : '';
    final senderLine = row.senderName != null ? ' · ${row.senderName!}' : '';
    // Where the number came from, when it is not simply "a human typed it".
    // `ocr` is the one an Admin still has to agree with: the machine read it and
    // nobody has confirmed it, so it stays `pending_review` and says so here.
    final sourceLine = switch (row.source) {
      'ocr' => ' · OCR (hindi pa nakumpirma)',
      'admin_confirmed' => ' · Kinumpirma ng Admin',
      'guest_claimed' => ' · Mula sa bisita',
      _ => '',
    };

    return HaciendaCard(
      child: ListTile(
        contentPadding: const EdgeInsets.all(14),
        leading: row.proofUrl != null
            ? IconButton(
                icon: const Icon(Icons.receipt_long, size: 20),
                tooltip: 'Open payment proof',
                onPressed: () => _openProof(row.proofUrl!),
              )
            : const Icon(Icons.description_outlined, size: 20, color: AppColors.textMuted),
        title: Text(row.reference),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '₱${row.amount.toStringAsFixed(2)}$senderLine$dateLine$sourceLine  ${guestLine.isNotEmpty ? '· $guestLine' : ''}',
              style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: _statusColor(row.status).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: _statusColor(row.status).withValues(alpha: 0.4)),
                  ),
                  child: Text(
                    row.status.replaceAll('_', ' ').toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: _statusColor(row.status),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (row.canCorrect)
              IconButton(
                icon: const Icon(Icons.edit_outlined, size: 20),
                tooltip: 'Correct extraction',
                onPressed: () => _correctRow(row),
              ),
            if (row.deletable)
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.statusAlert),
                tooltip: 'Delete reference',
                onPressed: () => _confirmDelete(row),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);
    final q = _search.text.trim().toLowerCase();

    return bookingsAsync.when(
      data: (allBookings) {
        final byId = <String, BookingModel>{};
        for (final b in allBookings) byId[b.id] = b;

        final filtered = _rows.where((r) {
          if (q.isEmpty) return true;
          final blob = '${r.reference} ${r.senderName ?? ''} ${r.paymentDate ?? ''} ${r.status}'.toLowerCase();
          if (blob.contains(q)) return true;
          final booking = r.bookingId != null ? byId[r.bookingId!] : null;
          if (booking != null) {
            return '${booking.guestName} ${booking.refId ?? ''} ${booking.guestEmail}'.toLowerCase().contains(q);
          }
          return false;
        }).toList()
          ..sort((a, b) {
            switch (_sort) {
              case 'amount':
                return a.amount.compareTo(b.amount);
              case 'status':
                return a.status.compareTo(b.status);
              case 'reference':
              default:
                return a.reference.compareTo(b.reference);
            }
          });

        return Scaffold(
          backgroundColor: AppColors.surfaceLight,
          appBar: const AdminPageHeader(
            title: 'Payment references',
            subtitle: 'Verify references against real proof',
          ),
          body: Column(
            children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'OCR extraction is never verification. Match reference and amount against the proof, reject duplicates, and only then mark a record verified.',
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _search,
                      decoration: const InputDecoration(
                        labelText: 'Search',
                        hintText: 'Reference, sender, booking or guest',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    DropdownButton<String>(
                      value: _sort,
                      items: const [
                        DropdownMenuItem(value: 'created_at', child: Text('Sort: newest first')),
                        DropdownMenuItem(value: 'reference', child: Text('Sort by reference')),
                        DropdownMenuItem(value: 'amount', child: Text('Sort by amount')),
                        DropdownMenuItem(value: 'status', child: Text('Sort by status')),
                      ],
                      onChanged: (v) => setState(() => _sort = v ?? 'created_at'),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: AppColors.cardBorder),
              Expanded(
                child: filtered.isEmpty
                    ? EmptyState(
                        icon: Icons.receipt_long_outlined,
                        title: 'No payment records yet',
                        subtitle:
                            'Verified payment proofs appear here, linked to their Booking. Review submitted proofs in the verification queue, or add a catalog reference below.',
                        action: OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => const PaymentVerificationQueueScreen(),
                            ),
                          ),
                          icon: const Icon(Icons.fact_check_outlined, size: 18),
                          label: const Text('Open verification queue'),
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: filtered.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (context, i) => _buildRow(filtered[i], byId),
                      ),
              ),
              const Divider(height: 1, color: AppColors.cardBorder),
              // Manual catalog entry (unchanged workflow for exceptions).
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Add a valid reference by hand',
                        style: GoogleFonts.inter(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _ref,
                            decoration: const InputDecoration(labelText: 'Reference'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: _amount,
                            decoration: const InputDecoration(labelText: 'Amount'),
                            keyboardType: TextInputType.number,
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(onPressed: _add, icon: const Icon(Icons.add_circle_outline)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Catalog references (available / used / void) are what a proof is checked against. Payment rows appear above once the Admin verifies a proof.',
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
      loading: () => const LoadingState(label: 'Reading bookings…'),
      error: (err, _) => EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Payment references could not be read',
        subtitle:
            'Check the connection. ${err.toString().split('\n').first}',
        action: OutlinedButton.icon(
          onPressed: () => ref.invalidate(bookingsStreamProvider),
          icon: const Icon(Icons.refresh),
          label: const Text('Try again'),
        ),
      ),
    );
  }
}
