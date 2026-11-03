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
import '../../services/payment_reference_service.dart'
    show PaymentReferenceService, receiptReadRefusalMessage, receiptWriteAdvice, receiptWriteFailureFor;
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

  /// Why the collection could not be read, when it could not. Null while the
  /// read is healthy — an empty list and a refused read must not look the same.
  String? _loadError;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  StreamSubscription<QuerySnapshot>? _subscription;

  /// Bookings a backfill has already been attempted for.
  ///
  /// The write itself is idempotent — a deterministic document id and a
  /// transaction that inserts only when the row is absent — but the Bookings
  /// stream re-emits on every change, and a read per Booking per snapshot is
  /// not something this screen should do to Firestore. A Booking that is not
  /// verified yet is not remembered here, so one that becomes verified later
  /// still gets its row when this screen is next open.
  final Set<String> _backfilled = <String>{};

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
    _subscription?.cancel();
    _subscription = _firestore
        .collection(AppConstants.colPaymentReferences)
        .orderBy('created_at', descending: true)
        .snapshots()
        .listen((snapshot) {
      setState(() {
        _loadError = null;
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
      // A refused read used to be printed and nothing else, so the screen fell
      // through to "No payment records yet" — an empty list and a denial look
      // identical to the person holding the phone. `payment_references` is
      // Admin-only (`allow read: if isAdmin()`), so a permission error here is
      // a statement about the session, not about the data.
      debugPrint('Error loading payment references: $e');
      if (!mounted) return;
      setState(() => _loadError = receiptReadRefusalMessage(e));
    });
  }

  /// Retry the subscription after a refused or dropped read.
  void _resubscribePaymentReferences() {
    setState(() {
      _rows.clear();
      _loadError = null;
    });
    _subscribeToPaymentReferences();
  }

  /// Files the `payment_references` rows that verified payments already owed.
  ///
  /// A row used to be written only by the verification queue, so a payment
  /// approved from the Booking detail screen or from a card in the Bookings
  /// list left this screen reading "No payment records yet" about money that
  /// had been verified days earlier. The write now happens on every approval
  /// path; this repairs the Bookings that were approved before it did.
  ///
  /// Safe to run more than once: `recordVerifiedBookingReference` derives the
  /// document id from the reference and the Booking id and inserts only when
  /// that document is absent, so a row that is already there is a no-op.
  void _scheduleBackfill(List<BookingModel> bookings) {
    if (!bookings.any((b) => !_backfilled.contains(b.id) && _needsBackfill(b))) {
      return;
    }
    // After the frame, not during build: filing a row is a write, and build
    // stays free of side effects.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      for (final booking in bookings) {
        if (!_needsBackfill(booking)) continue;
        if (!_backfilled.add(booking.id)) continue;
        PaymentReferenceService.instance.recordVerifiedBookingReference(
          booking,
          verifiedAmount: booking.amountVerified ??
              booking.amountClaimed ??
              booking.amountDue ??
              0,
        );
      }
    });
  }

  /// A Booking whose money is verified but whose reference was never filed:
  /// the state an approval from before this write existed left behind.
  static bool _needsBackfill(BookingModel booking) {
    final flagged = (booking.paymentStatus ?? '').toLowerCase() == 'verified';
    if (!booking.paymentIsVerified && !flagged) return false;
    final reference = booking.effectivePaymentReference?.trim() ?? '';
    return reference.isNotEmpty;
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
      // A refused create is a statement about the session or the deployed
      // ruleset, not about the reference that was typed.
      final advice = receiptWriteAdvice(receiptWriteFailureFor(e));
      _toast(advice.isEmpty
          ? 'Failed to add reference: $e'
          : 'Hindi na-add ang reference. $advice');
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
    // Where the number came from, when it is not simply "a human typed it".
    // `ocr` is the one an Admin still has to agree with: the machine read it and
    // nobody has confirmed it, so it stays `pending_review` and says so here.
    final sourceLabel = switch (row.source) {
      'ocr' => 'OCR — hindi pa nakumpirma',
      'admin_confirmed' => 'Kinumpirma ng Admin',
      'guest_claimed' => 'Mula sa bisita',
      _ => '',
    };
    final metaParts = <String>[
      if (row.paymentDate != null) row.paymentDate!,
      if (row.senderName != null) row.senderName!,
      if (sourceLabel.isNotEmpty) sourceLabel,
    ];
    final metaLine = metaParts.join(' · ');

    return HaciendaCard(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: row.proofUrl != null
                    ? AppColors.primaryForest.withValues(alpha: 0.10)
                    : AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.cardBorder),
              ),
              child: row.proofUrl != null
                  ? IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                      padding: EdgeInsets.zero,
                      icon: const Icon(Icons.receipt_long, size: 20, color: AppColors.primaryForest),
                      tooltip: 'Open payment proof',
                      onPressed: () => _openProof(row.proofUrl!),
                    )
                  : const Icon(Icons.description_outlined, size: 20, color: AppColors.textMuted),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.reference,
                    style: AppTheme.metric(fontSize: 19, color: AppColors.textDark),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    guestLine,
                    style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (metaLine.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      metaLine,
                      style: AppTheme.label(fontSize: 11, color: AppColors.textMuted, fontWeight: FontWeight.w500),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '₱${row.amount.toStringAsFixed(2)}',
                  style: AppTheme.metric(fontSize: 15, color: AppColors.primaryForest),
                ),
                const SizedBox(height: 6),
                _statusChip(row.status),
                if (row.canCorrect || row.deletable) ...[
                  const SizedBox(height: 2),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (row.canCorrect)
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          padding: EdgeInsets.zero,
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          tooltip: 'Correct extraction',
                          onPressed: () => _correctRow(row),
                        ),
                      if (row.deletable)
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          padding: EdgeInsets.zero,
                          icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.statusAlert),
                          tooltip: 'Delete reference',
                          onPressed: () => _confirmDelete(row),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Sentence-case status pill with a status dot — quiet, but scannable.
  Widget _statusChip(String status) {
    final color = _statusColor(status);
    final raw = status.replaceAll('_', ' ');
    final label = raw.isEmpty ? raw : '${raw[0].toUpperCase()}${raw.substring(1)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(label, style: AppTheme.label(fontSize: 11, color: color)),
        ],
      ),
    );
  }

  /// The list, its two empty states, and the difference between them.
  ///
  /// A refused read and an empty collection are not the same fact, and the
  /// screen must not say the same thing about both.
  Widget _buildListArea(List<_RefRow> filtered, Map<String, BookingModel> byId) {
    if (_loadError != null) {
      return EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Hindi ma-read ang payment references',
        subtitle: _loadError,
        action: OutlinedButton.icon(
          onPressed: _resubscribePaymentReferences,
          icon: const Icon(Icons.refresh, size: 18),
          label: const Text('Try again'),
        ),
      );
    }
    if (filtered.isEmpty) {
      return EmptyState(
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
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: filtered.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, i) => _buildRow(filtered[i], byId),
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
        _scheduleBackfill(allBookings);

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
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted, height: 1.4),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _search,
                            decoration: InputDecoration(
                              hintText: 'Search reference, sender, booking or guest',
                              hintStyle: GoogleFonts.inter(fontSize: 13, color: AppColors.textMuted),
                              prefixIcon: const Icon(Icons.search, size: 20),
                              filled: true,
                              fillColor: AppColors.surfaceLight,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(color: AppColors.accentGold, width: 1.5),
                              ),
                            ),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        const SizedBox(width: 8),
                        DropdownButton<String>(
                          value: _sort,
                          isDense: true,
                          underline: Container(height: 1, color: AppColors.cardBorder),
                          style: GoogleFonts.inter(fontSize: 13, color: AppColors.textDark),
                          items: const [
                            DropdownMenuItem(value: 'created_at', child: Text('Newest first')),
                            DropdownMenuItem(value: 'reference', child: Text('By reference')),
                            DropdownMenuItem(value: 'amount', child: Text('By amount')),
                            DropdownMenuItem(value: 'status', child: Text('By status')),
                          ],
                          onChanged: (v) => setState(() => _sort = v ?? 'created_at'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: AppColors.cardBorder),
              Expanded(child: _buildListArea(filtered, byId)),
              const Divider(height: 1, color: AppColors.cardBorder),
              // Manual catalog entry (unchanged workflow for exceptions).
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                child: HaciendaCard(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Add a reference by hand', style: AppTheme.title(fontSize: 14)),
                      const SizedBox(height: 10),
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
                          FilledButton.icon(
                            onPressed: _add,
                            icon: const Icon(Icons.add, size: 18),
                            label: const Text('Add'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Catalog references (available / used / void) are what a proof is checked against. Payment rows appear above once the Admin verifies a proof.',
                        style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted, height: 1.4),
                      ),
                    ],
                  ),
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
