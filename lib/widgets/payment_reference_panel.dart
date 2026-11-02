// ---------------------------------------------------------------------------
// The Payment Reference section of the Admin app.
//
// One panel, used by the Booking detail screen and by the payment verification
// queue, so the two places an Admin decides about money can never disagree about
// what the receipt said.
//
// What it shows, and why each part is there:
//
//  - **The money first**, large, because that is the figure the decision is
//    about. Then the **reference**, in a container with a one-tap copy, because
//    that is the number the Admin types into a banking app. Then the **date**
//    and the **sender**. Raw storage paths and engine names never appear: they
//    are the developer's business, not the Admin's.
//  - **Where each figure came from**, marked only where it changes the trust:
//    an `OCR` tag on a value no human has accepted, and a status pill. A record
//    a human has confirmed carries no disclaimer about the recognizer.
//  - **Warnings instead of invented values**: a receipt that could not be read,
//    a date that reads two ways, an amount that disagrees with the claim, a
//    reference already filed against another Booking.
//  - **Reading and correcting**, never verifying. The Approve button lives on
//    the screens, behind the Security PIN, and nothing here can stand in for it.
//    Which actions are offered depends on the state the money is in: a verified
//    payment gets one large button (open the proof) and a quiet way to edit;
//    an unverified one keeps reading, correcting and re-reading all reachable.
// ---------------------------------------------------------------------------

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

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
///
/// The TextEditingControllers live in [_PaymentReferenceCorrectionDialogState],
/// not in the function scope. `showDialog` resolves when `Navigator.pop` is
/// called — before the dialog widget is unmounted — so disposing controllers
/// in the function scope races with `_onSave`'s `await service.checkReference`:
/// the Admin taps outside the dialog while the duplicate check is running, the
/// dialog closes, the controllers are disposed, and `_onSave` resumes to read
/// `_senderController.text` off a dead controller. The State class owns them
/// and disposes them in `dispose()`, which is the correct lifecycle.
class _PaymentReferenceCorrectionDialog extends StatefulWidget {
  final BookingModel booking;
  final PaymentReferenceService service;
  final String title;
  final String? initialReference;
  final bool requireReference;

  const _PaymentReferenceCorrectionDialog({
    required this.booking,
    required this.service,
    required this.title,
    this.initialReference,
    this.requireReference = false,
  });

  @override
  State<_PaymentReferenceCorrectionDialog> createState() =>
      _PaymentReferenceCorrectionDialogState();
}

class _PaymentReferenceCorrectionDialogState
    extends State<_PaymentReferenceCorrectionDialog> {
  late final TextEditingController _referenceController;
  late final TextEditingController _senderController;
  late final TextEditingController _dateController;

  bool _busy = false;
  String? _error;
  String _duplicateWarning = '';

  @override
  void initState() {
    super.initState();
    _referenceController = TextEditingController(
      text: widget.initialReference ?? widget.booking.effectivePaymentReference ?? '',
    );
    _senderController = TextEditingController(
      text: widget.booking.paymentSenderName ?? widget.booking.ocrSenderName ?? '',
    );
    _dateController = TextEditingController(
      text: widget.booking.paymentDate ?? widget.booking.ocrPaymentDate ?? '',
    );
  }

  @override
  void dispose() {
    _referenceController.dispose();
    _senderController.dispose();
    _dateController.dispose();
    super.dispose();
  }

  Future<void> _onSave() async {
    final reference = normalizeReference(_referenceController.text);
    if (reference.isEmpty) {
      setState(() => _error = widget.requireReference
          ? 'Kailangan ang reference bago i-verify ang bayad.'
          : 'Kailangan ang reference. I-type ito mula sa resibo.');
      return;
    }
    if (!isValidReference(reference)) {
      setState(() => _error =
          'Ang reference ay 6–40 na letra, numero at hyphen lamang.');
      return;
    }
    final date = _dateController.text.trim();
    if (date.isNotEmpty && normalizeIsoDate(date) == null) {
      setState(() =>
          _error = 'Ilagay ang petsa sa YYYY-MM-DD (hal. 2026-08-26).');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    final lookup = await widget.service.checkReference(
      reference,
      excludeBookingId: widget.booking.id,
    );
    if (!mounted) return;
    if (lookup.isDuplicate && _duplicateWarning.isEmpty) {
      final who = lookup.otherGuestName?.isNotEmpty == true
          ? lookup.otherGuestName
          : lookup.otherBookingId;
      setState(() {
        _busy = false;
        _duplicateWarning =
            'Nakatala na ang $reference para sa Booking ni $who. '
            'Isang reference, isang bayad. Pindutin muli ang Save kung '
            'nasuri mo na ang dalawang Booking.';
      });
      return;
    }

    Navigator.pop(
      context,
      ReferenceCorrectionForm(
        reference: reference,
        senderName: _senderController.text.trim(),
        paymentDateIso: date.isEmpty ? '' : normalizeIsoDate(date),
        confirmDuplicate: _duplicateWarning.isNotEmpty,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title, style: AppTheme.serif(fontSize: 19)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.booking.ocrReference?.isNotEmpty == true &&
                widget.booking.ocrReference !=
                    (widget.booking.paymentReference ?? '')) ...[
              Text(
                'Nabasa ng OCR: ${widget.booking.ocrReference}. Ito ay hindi pa beripikado — ito ang pagkakataong itama ito.',
                style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
              ),
              const SizedBox(height: 10),
            ],
            TextField(
              controller: _referenceController,
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
                  _referenceController.value = TextEditingValue(
                    text: upper,
                    selection: TextSelection.collapsed(offset: upper.length),
                  );
                }
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _senderController,
              style: const TextStyle(fontSize: 16),
              decoration: const InputDecoration(
                labelText: 'Sender / account name',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _dateController,
              style: const TextStyle(fontSize: 16),
              keyboardType: TextInputType.datetime,
              decoration: const InputDecoration(
                labelText: 'Transaction date (YYYY-MM-DD)',
                border: OutlineInputBorder(),
              ),
            ),
            if (widget.booking.ocrAmount?.isNotEmpty == true) ...[
              const SizedBox(height: 12),
              Text(
                'Halaga sa resibo: ₱${widget.booking.ocrAmount} (hindi na-editable — ito ang nabasa ng OCR; ang halagang ibinayad ay pinagpapasyahan sa Approve)',
                style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
            if (_duplicateWarning.isNotEmpty) ...[
              const SizedBox(height: 12),
              AdminInlineNotice(
                title: 'Possible duplicate',
                message: _duplicateWarning,
                tone: AdminNoticeTone.caution,
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
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
              onPressed: _busy ? null : () => Navigator.pop(context),
              child: const Text('Bumalik'),
            ),
            ElevatedButton(
              onPressed: _busy ? null : _onSave,
              child: Text(
                _busy
                    ? 'Sinusuri…'
                    : _duplicateWarning.isNotEmpty
                        ? 'Ituloy pa rin'
                        : 'I-save',
              ),
            ),
          ],
        ),
      ],
    );
  }
}

Future<ReferenceCorrectionForm?> showPaymentReferenceCorrectionDialog(
  BuildContext context, {
  required BookingModel booking,
  required PaymentReferenceService service,
  String title = 'Itama ang Payment Reference',
  String? initialReference,
  bool requireReference = false,
}) {
  return showDialog<ReferenceCorrectionForm>(
    context: context,
    builder: (ctx) => _PaymentReferenceCorrectionDialog(
      booking: booking,
      service: service,
      title: title,
      initialReference: initialReference,
      requireReference: requireReference,
    ),
  );
}

/// Makes a human accept the reference before money is verified against it.
///
/// A number nobody has seen cannot carry a verified payment: when the only
/// reference on the record is what OCR read, the Admin confirms it here — in
/// the same field they would otherwise type into — and the approval that
/// follows records a reference a human has actually looked at.
///
/// Returns null when there is nothing to confirm: either the Booking already
/// carries a reference a human accepted, or the Admin has just accepted one
/// here. Otherwise it returns the sentence to show, and the caller **must**
/// abort the approval — verifying against a machine read is exactly the state
/// this prevents, and the row it would file is `pending_review` rather than
/// `verified`.
///
/// Shared by every screen that approves a payment (the verification queue, the
/// Booking detail screen) so the prompt cannot exist in one place and be
/// missing from another.
Future<String?> confirmReferenceBeforeVerification(
  BuildContext context, {
  required BookingModel booking,
  required String actorUid,
  PaymentReferenceService? service,
}) async {
  if (!booking.paymentReferenceIsMachineRead) return null;
  final referenceService = service ?? PaymentReferenceService.instance;

  final form = await showPaymentReferenceCorrectionDialog(
    context,
    booking: booking,
    service: referenceService,
    title: 'I-confirm ang reference bago i-verify',
    requireReference: true,
  );
  if (form == null) {
    return 'Kailangang kumpirmahin ang reference bago i-verify ang bayad.';
  }
  if (!context.mounted) {
    return 'Hindi na natuloy ang verification. Buksan muli ang booking.';
  }

  final saved = await referenceService.saveCorrection(
    booking,
    reference: form.reference,
    actorUid: actorUid,
    senderName: form.senderName,
    paymentDateIso: form.paymentDateIso,
    confirmDuplicate: form.confirmDuplicate,
  );
  if (!saved.ok) {
    return saved.message ??
        'Hindi na-save ang reference, kaya hindi natuloy ang verification.';
  }
  return null;
}

/// The Payment Reference panel: the money, the reference, the evidence behind
/// them, and the two things an Admin may do with them — read the receipt, and
/// correct the value. It never approves anything.
///
/// Scannable in one pass, because the Admin reads it standing in front of a
/// receipt and a decision: amount first and large, then the reference with a
/// one-tap copy, then the date and the sender. Nothing here is addressed to a
/// developer — no storage paths, no engine names — and nothing is repeated: the
/// wordy "OCR is not verification" paragraph that used to sit under every button
/// is gone, because the `(OCR)` tag on the value and the status pill already say
/// it, once.
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

  /// True only while the recognizer is running, so the spinner sits on the
  /// button that is actually working rather than on all of them.
  bool _reading = false;
  String? _notice;
  AdminNoticeTone _noticeTone = AdminNoticeTone.info;
  ReferenceLookup? _lookup;
  String _lookupFor = '';

  /// A read taken on this device that has not landed on the Booking — the save
  /// failed, or the stream has not delivered it yet. Shown in place so the
  /// Admin still sees the amount and date they just read, instead of an error
  /// above four rows that still say "Hindi nabasa".
  ReceiptExtraction? _freshExtraction;

  /// The proof [_freshExtraction] describes. A different path means the Guest
  /// replaced the image, and the read must not stand beside it.
  String _freshForPath = '';

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
    // The attached proof changed underneath an on-device read: the read
    // describes an image that is no longer on screen and must not be merged
    // into what the Admin sees.
    final currentPath = widget.booking.paymentProofUrl?.trim() ?? '';
    if (_freshExtraction != null && _freshForPath != currentPath) {
      _freshExtraction = null;
      _freshForPath = '';
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
      _reading = true;
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
          // The read is shown below anyway (see `_freshExtraction`): the Admin
          // can decide with it, they only need to know it will not be there
          // when the screen reloads.
          //
          // The cause decides the next step — a refused write needs the rules
          // deployed, a dropped connection needs signal — so it is named rather
          // than left as one sentence that reads the same for both.
          final failure = result.writeFailure;
          final advice = failure == null ? '' : receiptWriteAdvice(failure);
          message = '${result.writeError} '
              '${advice.isEmpty ? '' : '$advice '}'
              'Makikita pa rin sa ibaba ang nabasang detalye para sa desisyon ngayon — '
              'hindi lang ito mananatili pagkaalis sa screen na ito.';
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
      _reading = false;
      _noticeTone = tone;
      _notice = message;
      if (extraction != null && result.outcome.producedValues) {
        _freshExtraction = extraction;
        _freshForPath = widget.booking.paymentProofUrl?.trim() ?? '';
      }
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
    final storedExtraction = ReceiptExtraction.fromBooking(booking);
    // A read taken on this device whose save failed (or whose write has not
    // streamed back yet) still belongs on screen. Fresh values win and the
    // stored ones fill the gaps — the same merge the service would have filed.
    final freshExtraction = (_freshExtraction != null &&
            _freshForPath == (booking.paymentProofUrl?.trim() ?? ''))
        ? _freshExtraction!
        : null;
    final extraction = freshExtraction == null
        ? storedExtraction
        : freshExtraction.mergedWith(storedExtraction);
    final hasProof = (booking.paymentProofUrl?.trim() ?? '').isNotEmpty;
    final canOpenProof = hasProof && widget.onOpenProof != null;

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

    // The merged read, not just the stored field: when the on-device read could
    // not be filed, its figure is the only receipt evidence there is to compare
    // the Guest's claim against.
    final receiptAmount = _printedAmount(extraction.amount);
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
    // What the evidence rows show, most trusted first: a name a human confirmed
    // beats the machine's read, and the read taken on this device beats a row
    // that would otherwise only say "Hindi nabasa".
    final shownSender = booking.paymentSenderName?.trim().isNotEmpty == true
        ? booking.paymentSenderName!.trim()
        : extraction.senderName;
    final shownRecipient = extraction.recipientName.isNotEmpty
        ? extraction.recipientName
        : (booking.ocrRecipientName ?? '');

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

    // Which of the figures on screen are the machine's rather than a human's.
    // The amount is the receipt's own when the read produced one; the date is
    // the machine's when no confirmed date sits on the Booking.
    final amountFromReceipt = receiptAmount != null && receiptAmount > 0;
    final dateFromReceipt = (booking.paymentDate?.trim() ?? '').isEmpty &&
        (((booking.ocrPaymentDate?.trim() ?? '').isNotEmpty) ||
            extraction.paymentDateIso.isNotEmpty);
    // The caption belongs only where something on screen came off the image.
    // A record a human has confirmed needs no disclaimer about OCR.
    final ocrShown = machineRead || amountFromReceipt || dateFromReceipt;

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
          // Title and status in one header, in a Wrap: the unverified labels
          // run long ("MULA SA BISITA — HINDI PA BERIPIKADO") and a plain Row
          // squeezed the title into a column a few letters wide on a phone.
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            alignment: WrapAlignment.spaceBetween,
            spacing: 8,
            runSpacing: 8,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.tag, size: 20, color: AppColors.primaryForest),
                  const SizedBox(width: 8),
                  Text(
                    'Payment Reference',
                    style: AppTheme.serif(
                        fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              StatusPill(label: statusLabel, color: statusColor, fontSize: 10.5),
            ],
          ),
          const SizedBox(height: 14),

          // 1. The money, first and large: this is the figure the decision is
          // about, so it is the first thing the eye lands on.
          Text('HALAGA',
              style: AppTheme.label(
                  fontSize: 11.5, color: AppColors.textMuted)),
          const SizedBox(height: 2),
          Text(
            amountFromReceipt ? _peso(receiptAmount!) : _amountFallback(booking),
            style: AppTheme.metric(fontSize: 30, color: AppColors.textDark),
          ),
          const SizedBox(height: 14),

          // 2. The reference itself, with one tap to copy it — the number the
          // Admin types into a banking app, so it is the second thing they need.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.only(left: 14, right: 6, top: 11, bottom: 11),
            decoration: BoxDecoration(
              color: machineRead ? AppColors.goldMist : AppColors.sageMist,
              borderRadius: BorderRadius.circular(AppTheme.radiusField),
              border: Border.all(
                color: (machineRead
                        ? AppColors.accentGold
                        : AppColors.primaryForestLight)
                    .withValues(alpha: 0.35),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('REFERENCE NO.',
                          style: AppTheme.label(
                              fontSize: 10.5, color: AppColors.textMuted)),
                      const SizedBox(height: 4),
                      SelectableText(
                        reference ?? '— walang reference —',
                        style: AppTheme.title(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: reference == null
                              ? AppColors.textMuted
                              : AppColors.textDark,
                        ),
                      ),
                      if (machineRead) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Nabasa ng OCR. I-confirm o itama bago i-verify.',
                          style: AppTheme.body(
                              fontSize: 11.5, color: AppColors.accentGoldDark),
                        ),
                      ],
                      if (booking.paymentReferencePrevious?.isNotEmpty == true) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Pinalitan ang dating reference: ${booking.paymentReferencePrevious}',
                          style: AppTheme.body(
                              fontSize: 11.5, color: AppColors.textMuted),
                        ),
                      ],
                    ],
                  ),
                ),
                if (reference != null)
                  IconButton(
                    tooltip: 'Kopyahin ang reference number',
                    onPressed: () => _copyReference(reference),
                    icon: const Icon(Icons.copy_rounded, size: 20),
                    color: AppColors.primaryForest,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 3. When it was paid, and by whom. An evidence row appears only when
          // it carries evidence: "Hindi nabasa" beside a field the recognizer
          // was never going to fill reads as a fault in the app rather than as
          // an answer.
          _row(
            'Petsa',
            _dateLine(booking, extraction, verified),
            muted: !dateFromReceipt &&
                (booking.paymentDate?.trim() ?? '').isEmpty,
          ),
          if (shownSender.isNotEmpty) _row('Sender', shownSender),
          if (!widget.dense && shownRecipient.isNotEmpty)
            _row('Recipient / merchant', shownRecipient),

          // One quiet caption, only when something on screen is the machine's
          // read. The wordy disclaimer that used to sit under every button is
          // gone: the OCR tag on the value and the status pill already say it.
          if (ocrShown) ...[
            const SizedBox(height: 2),
            Text(
              'Awtomatikong binasa mula sa resibo.',
              style: AppTheme.body(fontSize: 11.5, color: AppColors.textMuted),
            ),
          ],

          if (warnings.isNotEmpty) ...[
            const SizedBox(height: 10),
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
              message: _notice!,
              tone: _noticeTone,
            ),
          ],
          const SizedBox(height: 14),

          // 4. What the Admin may do, ranked by the state the money is in.
          // Verified: opening the proof is the only thing worth a large button,
          // and correcting a settled record is the exception rather than the
          // next step. Pending: reading, correcting and re-reading all stay
          // reachable, because the decision has not been made yet.
          if (verified) ...[
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: (!widget.enabled || _busy || !canOpenProof)
                    ? null
                    : widget.onOpenProof,
                icon: const Icon(Icons.receipt_long_outlined, size: 20),
                label: const Text('Buksan ang Resibo'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryForest,
                  foregroundColor: Colors.white,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Center(
              child: TextButton.icon(
                onPressed: (!widget.enabled || _busy) ? null : _correctReference,
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('I-edit ang detalye'),
              ),
            ),
          ] else ...[
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: (!widget.enabled || _busy || !canOpenProof)
                    ? null
                    : widget.onOpenProof,
                icon: const Icon(Icons.receipt_long_outlined, size: 18),
                label: const Text('Buksan ang Resibo'),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppColors.primaryForest),
                ),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: (!widget.enabled ||
                        _busy ||
                        (!hasProof && reference == null))
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
            const SizedBox(height: 2),
            Center(
              child: TextButton.icon(
                onPressed: (!widget.enabled || _busy || !hasProof)
                    ? null
                    : () => _readReceipt(
                          force: booking.ocrReference?.isNotEmpty == true ||
                              booking.ocrReadIsStale,
                        ),
                icon: _reading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.document_scanner_outlined, size: 18),
                label: Text(
                  _reading
                      ? 'Binabasa…'
                      : booking.ocrReference?.isNotEmpty == true
                          ? 'Basahin muli'
                          : 'Basahin ang resibo',
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// The transaction date in the form a person reads — `Aug 26, 2026`, not
  /// `2026-08-26` — with the time when the read carried one.
  ///
  /// The `(OCR)` tag marks a date nobody has accepted, so it stays only while
  /// the payment is unverified: once money is verified the date on the record
  /// *is* the record.
  String _dateLine(BookingModel booking, ReceiptExtraction extraction, bool verified) {
    final confirmed = booking.paymentDate?.trim() ?? '';
    // The stored read first, then the read taken on this device: when the
    // latest one could not be filed it is still the date the Admin is
    // deciding with.
    final read = (booking.ocrPaymentDate?.trim().isNotEmpty == true)
        ? booking.ocrPaymentDate!.trim()
        : extraction.paymentDateIso;
    final time = extraction.paymentTime;
    if (confirmed.isNotEmpty) {
      final date = _humanDate(confirmed);
      return time.isEmpty ? date : '$date · $time';
    }
    if (read.isNotEmpty) {
      final date = _humanDate(read);
      final stamped = time.isEmpty ? date : '$date · $time';
      return verified ? stamped : '$stamped (OCR)';
    }
    return 'Hindi nabasa';
  }

  /// `2026-08-26` becomes `Aug 26, 2026`. A value that is not an ISO date is
  /// shown verbatim rather than guessed at.
  static String _humanDate(String iso) {
    final trimmed = iso.trim();
    final parsed = DateTime.tryParse(trimmed);
    if (parsed == null) return trimmed;
    return DateFormatter.formatDate(parsed);
  }

  /// Puts the reference on the clipboard and says so. A copy that gives no
  /// feedback leaves the Admin wondering whether the tap landed, and the number
  /// is the one they are about to type into a banking app.
  Future<void> _copyReference(String reference) async {
    await Clipboard.setData(ClipboardData(text: reference));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Nakopya ang reference number'),
      duration: Duration(seconds: 2),
    ));
  }

  /// `₱5,000.00`, with the thousands separators a person reads.
  static final NumberFormat _pesoFormat = NumberFormat('#,##0.00');

  static String _peso(double value) => '₱${_pesoFormat.format(value)}';

  /// The amount a receipt printed, as a number. Commas and a peso sign are
  /// stripped first: the recognizer keeps whatever the receipt printed.
  static double? _printedAmount(String printed) {
    final cleaned = printed.replaceAll(RegExp(r'[^0-9.]'), '');
    if (cleaned.isEmpty || cleaned == '.') return null;
    return double.tryParse(cleaned);
  }

  /// What to show when the receipt's own figure is unreadable: the amount the
  /// Admin verified, then what the Guest claimed. A blank where the amount is
  /// known would be the one thing this panel must never show.
  String _amountFallback(BookingModel booking) {
    for (final candidate in [booking.amountVerified, booking.amountClaimed]) {
      if (candidate != null && candidate > 0) return _peso(candidate);
    }
    return 'Hindi nabasa';
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
