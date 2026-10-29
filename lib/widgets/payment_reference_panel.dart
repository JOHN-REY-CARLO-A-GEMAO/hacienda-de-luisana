// ---------------------------------------------------------------------------
// The Payment Reference section of the Admin app.
//
// One panel, used by the Booking detail screen and by the payment verification
// queue, so the two places an Admin decides about money can never disagree about
// what the receipt said.
//
// What it shows, and why each part is there:
//
//  - **The reference field itself**, pre-filled with whatever a human accepted,
//    falling back to what OCR read. A Booking whose reference no human has
//    touched shows the machine's number behind an `OCR` label rather than
//    passing it off as recorded fact.
//  - **The evidence beside it** — amount, transaction date and time, sender and
//    recipient — each marked with where it came from, because "the Guest typed
//    this", "a machine read this" and "an Admin confirmed this" are three
//    different levels of trust and the Admin's decision depends on which one
//    they are looking at.
//  - **Warnings instead of invented values**: a receipt that could not be read,
//    a date that reads two ways, an amount that disagrees with the claim, a
//    reference already filed against another Booking.
//  - **Reading and correcting**, never verifying. The Approve button lives on
//    the screens, behind the Security PIN, and nothing here can stand in for it.
// ---------------------------------------------------------------------------

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/date_formatter.dart';
import '../models/booking_model.dart';
import '../models/receipt_extraction.dart';
import '../services/payment_reference_service.dart';
import '../services/receipt_ocr_service.dart';
import 'admin_ui.dart';
import 'hacienda_card.dart';
import 'status_pill.dart';

/// What the Admin typed into the correction dialog, before it is saved.
class ReferenceCorrectionForm {
  final String reference;
  final String? senderName;

  /// `YYYY-MM-DD`, or '' to clear the field. Null means "leave as it is".
  final String? paymentDateIso;

  /// The Admin pressed past an explicit duplicate-reference warning.
  final bool confirmDuplicate;

  const ReferenceCorrectionForm({
    required this.reference,
    this.senderName,
    this.paymentDateIso,
    this.confirmDuplicate = false,
  });
}

/// The editable Payment Reference dialog.
///
/// Deliberately separate from saving: the payment verification queue opens the
/// same dialog to confirm a machine-read reference *before* verifying, and both
/// call sites go through [PaymentReferenceService.saveCorrection], which is
/// where the guards live.
///
/// A duplicate is checked here, before the Admin can save, so the warning is a
/// second deliberate press rather than a toast after the write.
Future<ReferenceCorrectionForm?> showPaymentReferenceCorrectionDialog(
  BuildContext context, {
  required BookingModel booking,
  required PaymentReferenceService service,
  String title = 'Itama ang Payment Reference',
  String? initialReference,
  bool requireReference = false,
}) async {
  final referenceController = TextEditingController(
    text: initialReference ?? booking.effectivePaymentReference ?? '',
  );
  final senderController = TextEditingController(
    text: booking.paymentSenderName ?? booking.ocrSenderName ?? '',
  );
  final dateController = TextEditingController(
    text: booking.paymentDate ?? booking.ocrPaymentDate ?? '',
  );

  var duplicateWarning = '';
  var busy = false;
  String? error;

  final result = await showDialog<ReferenceCorrectionForm>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> onSave() async {
          final reference = normalizeReference(referenceController.text);
          if (reference.isEmpty) {
            setDialogState(() => error = requireReference
                ? 'Kailangan ang reference bago i-verify ang bayad.'
                : 'Kailangan ang reference. I-type ito mula sa resibo.');
            return;
          }
          if (!isValidReference(reference)) {
            setDialogState(() => error =
                'Ang reference ay 6–40 na letra, numero at hyphen lamang.');
            return;
          }
          final date = dateController.text.trim();
          if (date.isNotEmpty && normalizeIsoDate(date) == null) {
            setDialogState(() =>
                error = 'Ilagay ang petsa sa YYYY-MM-DD (hal. 2026-08-26).');
            return;
          }

          setDialogState(() {
            busy = true;
            error = null;
          });
          final lookup = await service.checkReference(
            reference,
            excludeBookingId: booking.id,
          );
          if (!context.mounted) return;
          if (lookup.isDuplicate && duplicateWarning.isEmpty) {
            final who = lookup.otherGuestName?.isNotEmpty == true
                ? lookup.otherGuestName
                : lookup.otherBookingId;
            setDialogState(() {
              busy = false;
              duplicateWarning =
                  'Nakatala na ang $reference para sa Booking ni $who. '
                  'Isang reference, isang bayad. Pindutin muli ang Save kung '
                  'nasuri mo na ang dalawang Booking.';
            });
            return;
          }

          Navigator.pop(
            ctx,
            ReferenceCorrectionForm(
              reference: reference,
              senderName: senderController.text.trim(),
              paymentDateIso: date.isEmpty ? '' : normalizeIsoDate(date),
              confirmDuplicate: duplicateWarning.isNotEmpty,
            ),
          );
        }

        return AlertDialog(
          title: Text(title, style: AppTheme.serif(fontSize: 19)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (booking.ocrReference?.isNotEmpty == true &&
                    booking.ocrReference !=
                        (booking.paymentReference ?? '')) ...[
                  Text(
                    'Nabasa ng OCR: ${booking.ocrReference}. Ito ay hindi pa beripikado — ito ang pagkakataong itama ito.',
                    style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  controller: referenceController,
                  autofocus: true,
                  textCapitalization: TextCapitalization.characters,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9\-]')),
                    LengthLimitingTextInputFormatter(referenceMaxLength),
                  ],
                  style: const TextStyle(fontSize: 17, letterSpacing: 0.5),
                  decoration: const InputDecoration(
                    labelText: 'Payment reference',
                    helperText: 'Tulad ng nakasulat sa resibo (6–40 characters)',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) {
                    final upper = value.toUpperCase();
                    if (upper != value) {
                      referenceController.value = TextEditingValue(
                        text: upper,
                        selection: TextSelection.collapsed(offset: upper.length),
                      );
                    }
                    if (error != null) setDialogState(() => error = null);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: senderController,
                  style: const TextStyle(fontSize: 16),
                  decoration: const InputDecoration(
                    labelText: 'Sender / account name',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: dateController,
                  style: const TextStyle(fontSize: 16),
                  keyboardType: TextInputType.datetime,
                  decoration: const InputDecoration(
                    labelText: 'Transaction date (YYYY-MM-DD)',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (booking.ocrAmount?.isNotEmpty == true) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Halaga sa resibo: ₱${booking.ocrAmount} (hindi na-editable — ito ang nabasa ng OCR; ang halagang ibinayad ay pinagpapasyahan sa Approve)',
                    style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
                if (duplicateWarning.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  AdminInlineNotice(
                    title: 'Possible duplicate',
                    message: duplicateWarning,
                    tone: AdminNoticeTone.caution,
                  ),
                ],
                if (error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    error!,
                    style: AppTheme.body(fontSize: 14, color: AppColors.statusAlert),
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
                TextButton(
                  onPressed: busy ? null : () => Navigator.pop(ctx),
                  child: const Text('Bumalik'),
                ),
                ElevatedButton(
                  onPressed: busy ? null : onSave,
                  child: Text(
                    busy
                        ? 'Sinusuri…'
                        : duplicateWarning.isNotEmpty
                            ? 'Ituloy pa rin'
                            : 'I-save',
                  ),
                ),
              ],
            ),
          ],
        );
      },
    ),
  );

  referenceController.dispose();
  senderController.dispose();
  dateController.dispose();
  return result;
}

/// The Payment Reference panel: OCR evidence, the accepted reference, and the
/// two things an Admin may do with them — read the receipt, and correct the
/// value. It never approves anything.
class PaymentReferencePanel extends StatefulWidget {
  final BookingModel booking;

  /// False while the screen is running another action.
  final bool enabled;

  /// Fewer rows, for the verification queue's card.
  final bool dense;

  /// Opens the stored proof image, when the screen has a way to sign a URL.
  final Future<void> Function()? onOpenProof;

  /// The Admin's uid, written beside a correction. Falls back to the signed-in
  /// user when a caller has none to offer.
  final String? actorUid;

  const PaymentReferencePanel({
    super.key,
    required this.booking,
    this.enabled = true,
    this.dense = false,
    this.onOpenProof,
    this.actorUid,
  });

  @override
  State<PaymentReferencePanel> createState() => _PaymentReferencePanelState();
}

class _PaymentReferencePanelState extends State<PaymentReferencePanel> {
  final PaymentReferenceService _service = PaymentReferenceService.instance;

  bool _busy = false;
  String? _notice;
  AdminNoticeTone _noticeTone = AdminNoticeTone.info;
  ReferenceLookup? _lookup;
  String _lookupFor = '';

  @override
  void initState() {
    super.initState();
    _refreshLookup();
  }

  @override
  void didUpdateWidget(PaymentReferencePanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.booking.effectivePaymentReference !=
        widget.booking.effectivePaymentReference) {
      _refreshLookup();
    }
  }

  /// The uid written beside a correction. The screens pass their own actor when
  /// they have one; otherwise the signed-in Admin's uid is the truthful answer,
  /// and only a build with no Auth at all falls back to a placeholder.
  String get _actorUid {
    if (widget.actorUid != null && widget.actorUid!.isNotEmpty) {
      return widget.actorUid!;
    }
    try {
      return FirebaseAuth.instance.currentUser?.uid ?? 'admin';
    } catch (_) {
      return 'admin';
    }
  }

  Future<void> _refreshLookup() async {
    final reference = widget.booking.effectivePaymentReference;
    if (reference == null || reference.isEmpty) {
      if (_lookup != null && mounted) setState(() => _lookup = null);
      return;
    }
    if (_lookupFor == reference && _lookup != null) return;
    _lookupFor = reference;
    final lookup = await _service.checkReference(
      reference,
      excludeBookingId: widget.booking.id,
    );
    if (!mounted || _lookupFor != reference) return;
    setState(() => _lookup = lookup);
  }

  Future<void> _readReceipt({bool force = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    final result = await _service.readAndStore(widget.booking, force: force);
    if (!mounted) return;

    final status = result.outcome.status;
    final extraction = result.extraction;
    AdminNoticeTone tone;
    String? message;

    switch (status) {
      case ReceiptOcrStatus.extracted:
        if (result.writeError != null) {
          tone = AdminNoticeTone.danger;
          message = result.writeError;
        } else {
          tone = extraction != null &&
                  extraction.confidence == ReceiptConfidence.high
              ? AdminNoticeTone.success
              : AdminNoticeTone.caution;
          message = extraction != null && extraction.reference.isNotEmpty
              ? 'Nabasa ang resibo. Punan ang reference mula sa OCR at i-confirm bago i-verify.'
              : 'Nabasa ang resibo pero walang maaasahang reference. I-type ito mula sa patunay.';
        }
      case ReceiptOcrStatus.alreadyProcessed:
        tone = AdminNoticeTone.info;
        message =
            'Ang nakahaing detalye ay galing sa dating nabasa para sa patunay na ito. '
            'Pindutin ang "Basahin muli" para muling basahin.';
      case ReceiptOcrStatus.noProof:
        tone = AdminNoticeTone.danger;
        message = result.outcome.message;
      case ReceiptOcrStatus.unsupported:
        tone = AdminNoticeTone.caution;
        message = result.outcome.message;
      case ReceiptOcrStatus.notAnImage:
      case ReceiptOcrStatus.downloadFailed:
      case ReceiptOcrStatus.failed:
        tone = AdminNoticeTone.danger;
        message = result.outcome.message;
      case ReceiptOcrStatus.noText:
        tone = AdminNoticeTone.caution;
        message = result.outcome.message;
    }

    setState(() {
      _busy = false;
      _noticeTone = tone;
      _notice = message;
    });
    await _refreshLookup();
  }

  Future<void> _correctReference() async {
    if (_busy) return;
    final form = await showPaymentReferenceCorrectionDialog(
      context,
      booking: widget.booking,
      service: _service,
    );
    if (form == null || !mounted) return;

    setState(() {
      _busy = true;
      _notice = null;
    });

    var confirmDuplicate = form.confirmDuplicate;
    var confirmOverwrite = false;
    var result = await _service.saveCorrection(
      widget.booking,
      reference: form.reference,
      actorUid: _actorUid,
      senderName: form.senderName,
      paymentDateIso: form.paymentDateIso,
      confirmDuplicate: confirmDuplicate,
    );

    if (result.needsDuplicateConfirmation && mounted) {
      final proceed = await _ask(
        title: 'Duplicate reference',
        body: result.message ?? '',
        confirm: 'Ituloy pa rin',
        danger: true,
      );
      if (proceed) {
        confirmDuplicate = true;
        result = await _service.saveCorrection(
          widget.booking,
          reference: form.reference,
          actorUid: _actorUid,
          senderName: form.senderName,
          paymentDateIso: form.paymentDateIso,
          confirmDuplicate: true,
        );
      }
    }

    if (result.needsOverwriteConfirmation && mounted) {
      final proceed = await _ask(
        title: 'Verified reference',
        body: result.message ?? '',
        confirm: 'Palitan',
        danger: true,
      );
      if (proceed) {
        confirmOverwrite = true;
        result = await _service.saveCorrection(
          widget.booking,
          reference: form.reference,
          actorUid: _actorUid,
          senderName: form.senderName,
          paymentDateIso: form.paymentDateIso,
          confirmDuplicate: confirmDuplicate,
          confirmOverwrite: true,
        );
      }
    }

    if (!mounted) return;
    setState(() {
      _busy = false;
      _noticeTone = result.ok ? AdminNoticeTone.success : AdminNoticeTone.danger;
      _notice = result.ok
          ? (confirmOverwrite
              ? 'Naitala ang bagong reference. Nananatili ang beripikadong bayad — '
                  'hindi binago ang halaga o status.'
              : 'Nai-save ang reference. Mananatiling pending ang bayad hanggang aprubahan ito.')
          : result.message ?? 'Hindi na-save ang reference.';
    });
    await _refreshLookup();
  }

  Future<bool> _ask({
    required String title,
    required String body,
    required String confirm,
    bool danger = false,
  }) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: AppTheme.serif(fontSize: 18)),
        content: Text(body, style: AppTheme.body(fontSize: 15)),
        actions: [
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Bumalik'),
              ),
              ElevatedButton(
                style: danger
                    ? ElevatedButton.styleFrom(backgroundColor: AppColors.statusAlert)
                    : null,
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(confirm),
              ),
            ],
          ),
        ],
      ),
    );
    return ok == true;
  }

  @override
  Widget build(BuildContext context) {
    final booking = widget.booking;
    final verified = booking.paymentIsVerified;
    final reference = booking.effectivePaymentReference;
    final machineRead = booking.paymentReferenceIsMachineRead;
    final extraction = ReceiptExtraction.fromBooking(booking);
    final hasProof = (booking.paymentProofUrl?.trim() ?? '').isNotEmpty;
    final readFor = booking.ocrEngine?.isNotEmpty == true
        ? booking.ocrEngine!
        : 'ocr';

    final statusLabel = verified
        ? 'VERIFIED'
        : reference == null
            ? 'WALANG REFERENCE'
            : machineRead
                ? 'OCR — HINDI PA BERIPIKADO'
                : booking.paymentReferenceWasCorrected
                    ? 'ITINAMA — HINDI PA BERIPIKADO'
                    : 'MULA SA BISITA — HINDI PA BERIPIKADO';
    final statusColor = verified
        ? AppColors.statusSuccess
        : reference == null
            ? AppColors.textMuted
            : AppColors.statusWarning;

    final warnings = <String>[];
    if (!hasProof) {
      warnings.add('Walang nakalakip na patunay sa Booking na ito.');
    }
    if (booking.ocrReadIsStale) {
      warnings.add(
        'Ang nakahaing OCR ay para sa lumang patunay. Basahin muli ang bagong larawan bago umasa sa mga detalyeng ito.',
      );
    }
    if (hasProof && reference == null) {
      warnings.add(
        'Walang reference sa Booking. Basahin ang patunay o i-type ang reference mula sa resibo.',
      );
    }
    if (!verified) warnings.addAll(extraction.notes);

    // The Guest's claim and the machine's read are two different statements. When
    // they disagree, the Admin is looking at a mistyped reference or a receipt
    // for somebody else's payment, and that is exactly the moment a warning is
    // worth more than a pre-filled field.
    final claimedReference = normalizeReference(booking.paymentReference ?? '');
    final readReference = normalizeReference(booking.ocrReference ?? '');
    if (claimedReference.isNotEmpty &&
        readReference.isNotEmpty &&
        claimedReference != readReference) {
      warnings.add(
        'Ang reference na sinasabi ng bisita ay $claimedReference, pero ang '
        'nabasa sa resibo ay $readReference. Itama ang tama bago i-verify.',
      );
    }

    final receiptAmount = double.tryParse(booking.ocrAmount ?? '');
    final claimed = booking.amountClaimed;
    if (receiptAmount != null && claimed != null && claimed > 0) {
      if ((receiptAmount - claimed).abs() > 0.005) {
        warnings.add(
          'Ang nabasang halaga sa resibo ay ₱${receiptAmount.toStringAsFixed(2)}, '
          'pero ang sinasabi ng bisita ay ₱${claimed.toStringAsFixed(2)}. Suriin ang larawan.',
        );
      }
    }
    final due = booking.amountDue;
    if (receiptAmount != null && due != null && due > 0 && receiptAmount + 0.005 < due) {
      warnings.add(
        'Mas mababa ang nabasang halaga (₱${receiptAmount.toStringAsFixed(2)}) '
        'sa hinihinging bayad (₱${due.toStringAsFixed(2)}).',
      );
    }
    final lookup = _lookup;
    if (lookup != null && lookup.isDuplicate) {
      warnings.add(
        'Nakatala na ang reference na ito para sa Booking '
        '${lookup.otherGuestName?.isNotEmpty == true ? lookup.otherGuestName : lookup.otherBookingId}.',
      );
    }
    if (lookup != null && lookup.catalogAlreadyUsed && !lookup.isDuplicate) {
      warnings.add(
        'Nasa listahan na ang reference na ito bilang ginamit (used). Huwag itong tanggapin nang hindi nililinaw.',
      );
    }

    return HaciendaCard(
      borderColor: verified
          ? AppColors.statusSuccess
          : machineRead
              ? AppColors.accentGold
              : null,
      borderWidth: verified || machineRead ? 1.5 : 1,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.tag, size: 20, color: AppColors.primaryForest),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Payment Reference',
                  style: AppTheme.serif(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
              StatusPill(label: statusLabel, color: statusColor, fontSize: 10.5),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            verified
                ? 'Na-verify na ang bayad na ito. Ang reference sa ibaba ang pinagbatayan ng desisyon.'
                : 'Pre-filled mula sa resibo. Hindi pa ito beripikasyon — mananatiling pending ang bayad hanggang aprubahan ng Admin.',
            style: AppTheme.body(fontSize: 12.5, color: AppColors.textMuted),
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: machineRead ? AppColors.goldMist : AppColors.sageMist,
              borderRadius: BorderRadius.circular(AppTheme.radiusField),
              border: Border.all(
                color: (machineRead ? AppColors.accentGold : AppColors.primaryForestLight)
                    .withValues(alpha: 0.35),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'PAYMENT REFERENCE',
                  style: AppTheme.label(fontSize: 10.5, color: AppColors.textMuted),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  reference ?? '— walang reference —',
                  style: AppTheme.title(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: reference == null ? AppColors.textMuted : AppColors.textDark,
                  ),
                ),
                if (machineRead) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Nabasa ng OCR ($readFor). I-confirm o itama bago i-verify.',
                    style: AppTheme.body(fontSize: 11.5, color: AppColors.accentGoldDark),
                  ),
                ],
                if (booking.paymentReferencePrevious?.isNotEmpty == true) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Pinalitan ang dating reference: ${booking.paymentReferencePrevious}',
                    style: AppTheme.body(fontSize: 11.5, color: AppColors.textMuted),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          _row(
            'Halaga sa resibo',
            booking.ocrAmount?.isNotEmpty == true
                ? '₱${booking.ocrAmount}'
                    '${extraction.amounts.length > 1 ? ' · ${extraction.amountLabel}' : ''}'
                : 'Hindi nabasa',
            muted: booking.ocrAmount?.isNotEmpty != true,
          ),
          _row(
            'Petsa ng transaksyon',
            _dateLine(booking, extraction),
            muted: (booking.paymentDate ?? booking.ocrPaymentDate ?? '').isEmpty,
          ),
          if (!widget.dense)
            _row(
              'Sender',
              booking.paymentSenderName ?? booking.ocrSenderName ?? 'Hindi nabasa',
              muted: (booking.paymentSenderName ?? booking.ocrSenderName ?? '').isEmpty,
            ),
          if (!widget.dense)
            _row(
              'Recipient / merchant',
              booking.ocrRecipientName ?? 'Hindi nabasa',
              muted: (booking.ocrRecipientName ?? '').isEmpty,
            ),
          if (hasProof)
            _row(
              'Nabasa mula sa',
              _proofLine(booking, readFor),
              muted: booking.ocrProofUrl == null,
            ),
          if (warnings.isNotEmpty) ...[
            const SizedBox(height: 6),
            AdminInlineNotice(
              title: warnings.length == 1
                  ? 'Isang bagay na kailangang suriin'
                  : '${warnings.length} bagay na kailangang suriin',
              message: warnings.map((w) => '• $w').join('\n'),
              tone: AdminNoticeTone.caution,
              icon: Icons.report_outlined,
            ),
          ],
          if (_notice != null) ...[
            const SizedBox(height: 10),
            AdminInlineNotice(
              title: _noticeTone == AdminNoticeTone.success
                  ? 'Nagtagumpay'
                  : _noticeTone == AdminNoticeTone.danger
                      ? 'May problema'
                      : 'Paalala',
              message: _notice,
              tone: _noticeTone,
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: (!widget.enabled || _busy || !hasProof)
                      ? null
                      : () => _readReceipt(
                          force: booking.ocrReference?.isNotEmpty == true ||
                              booking.ocrReadIsStale),
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.document_scanner_outlined, size: 18),
                  label: Text(
                    _busy
                        ? 'Binabasa…'
                        : booking.ocrReference?.isNotEmpty == true
                            ? 'Basahin muli'
                            : 'Basahin ang resibo',
                  ),
                ),
              ),
              if (widget.onOpenProof != null) ...[
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: (!widget.enabled || _busy || !hasProof)
                        ? null
                        : widget.onOpenProof,
                    icon: const Icon(Icons.receipt_long, size: 18),
                    label: const Text('Buksan ang proof'),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: (!widget.enabled || _busy || (!hasProof && reference == null))
                  ? null
                  : _correctReference,
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: Text(
                booking.paymentReferenceWasCorrected
                    ? 'Itama muli ang reference'
                    : 'I-confirm o itama ang reference',
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryForest,
                foregroundColor: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Ang OCR ay hindi beripikasyon. Hindi nito nababago ang status ng bayad — '
            'ang Approve at Verify sa itaas ang tanging paraan para mabayaran ang Booking.',
            style: AppTheme.body(fontSize: 11.5, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  String _dateLine(BookingModel booking, ReceiptExtraction extraction) {
    final confirmed = booking.paymentDate?.trim() ?? '';
    final read = booking.ocrPaymentDate?.trim() ?? '';
    final time = extraction.paymentTime;
    if (confirmed.isNotEmpty) {
      return time.isEmpty ? confirmed : '$confirmed · $time';
    }
    if (read.isNotEmpty) {
      return '${time.isEmpty ? read : '$read · $time'} (OCR)';
    }
    return 'Hindi nabasa';
  }

  String _proofLine(BookingModel booking, String engine) {
    final path = booking.ocrProofUrl?.trim() ?? '';
    if (path.isEmpty) return 'Walang naitalang pinagmulan';
    final name = path.split('/').last;
    final at = booking.ocrExtractedAt;
    final when = at == null ? '' : ' · ${DateFormatter.formatFull(at.toLocal())}';
    return '$name · $engine$when';
  }

  Widget _row(String label, String value, {bool muted = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTheme.label(fontSize: 11.5, color: AppColors.textMuted)),
          const SizedBox(height: 2),
          Text(
            value,
            style: AppTheme.body(
              fontSize: 15,
              color: muted ? AppColors.textMuted : AppColors.textDark,
              fontWeight: muted ? FontWeight.normal : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
