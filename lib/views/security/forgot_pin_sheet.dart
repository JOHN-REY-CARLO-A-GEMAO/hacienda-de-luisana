import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../providers/app_providers.dart';
import '../../services/pin_reset_service.dart';

/// The way out of a gate nobody can open (ADR-0027).
///
/// ADR-0016 built this as a 24 h self-service delete and said plainly what it
/// cost: anyone holding a signed-in, unlocked phone could wipe the PIN record
/// and choose a new one. That is the door the product owner sent back — a reset
/// that needed no proof at all.
///
/// This sheet asks for proof first. The proof is a **six-digit code mailed to the
/// Admin's own verified Firebase address**:
///
///   1. tap *Send the code* — the `admin-pin-reset` function mints the digits,
///      keeps only a salted hash, and mails them; nothing is deleted yet;
///   2. type the six digits here;
///   3. only when the server says the code matched does it dispose of the PIN
///      record — and only then does the app drop its cached copy.
///
/// What it is not: it is not a password reset (the PIN is not a credential, and
/// CONTEXT.md owns the word), and it is not a way past the PIN for someone
/// holding the phone. A person with the phone and no access to the Admin's inbox
/// cannot get through, which is the whole difference from ADR-0016.
///
/// Returns true when the reset actually happened, so the caller re-resolves.
Future<bool> showForgotPinSheet(BuildContext context, {required String uid}) {
  return showModalBottomSheet<bool>(
    context: context,
    backgroundColor: Colors.white,
    // Dismissable while idle — this is a way out, not a gate — but not while a
    // call is in flight, so a double tap cannot ask for two codes.
    isDismissible: true,
    enableDrag: true,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _ForgotPinSheetBody(uid: uid),
  ).then((done) => done ?? false);
}

/// Which half of the conversation the sheet is in.
enum _Step {
  /// No code asked for yet: the address, and what sending costs.
  idle,

  /// The mail is being sent.
  sending,

  /// A code was mailed: six digits, a resend, and a way back.
  entered,

  /// Six digits are being checked by the server.
  checking,

  /// The code was used up, wrong too often, or too old — ask again.
  restart,
}

class _ForgotPinSheetBody extends ConsumerStatefulWidget {
  final String uid;

  const _ForgotPinSheetBody({required this.uid});

  @override
  ConsumerState<_ForgotPinSheetBody> createState() => _ForgotPinSheetBodyState();
}

class _ForgotPinSheetBodyState extends ConsumerState<_ForgotPinSheetBody> {
  final _codeController = TextEditingController();
  final _codeFocus = FocusNode();

  _Step _step = _Step.idle;

  /// `g***s@gmail.com`, once the server has said where the code went.
  String? _maskedEmail;

  /// When the mailed code stops working, on this phone's clock.
  ///
  /// A wall-clock stamp rather than a ticking countdown: a per-second timer
  /// would rebuild the sheet sixty times a minute to change one word, and it
  /// would make the sheet impossible to settle in a widget test. The server
  /// holds the real expiry anyway — this is only the sentence that tells the
  /// Admin how long they have.
  DateTime? _expiresAt;

  /// A sentence under the field: a wrong code, a refusal, a cooldown.
  String? _note;

  /// Digits typed so far, so the button only lights at six.
  String _code = '';

  bool get _busy => _step == _Step.sending || _step == _Step.checking;

  @override
  void dispose() {
    _codeController.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  /// Ask the function to mail a code. Nothing is deleted by this call.
  Future<void> _send() async {
    if (_busy) return;
    setState(() {
      _step = _Step.sending;
      _note = null;
    });

    final request = await ref.read(pinGateProvider).requestPinResetCode();
    if (!mounted) return;

    if (!request.sent) {
      setState(() {
        _step = _Step.idle;
        _note = request.error ??
            'The code could not be sent. Check the connection and try again.';
      });
      return;
    }

    HapticFeedback.lightImpact();
    setState(() {
      _step = _Step.entered;
      _maskedEmail = request.maskedEmail;
      _expiresAt =
          DateTime.now().add(request.expiresIn ?? kPinResetCodeTtl);
      _code = '';
      _note = null;
    });
    _codeController.clear();
    // The keyboard after the frame that enabled the field, or the request is
    // dropped rather than queued.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _codeFocus.requestFocus();
    });
  }

  /// Hand the six digits to the server. Only [PinResetOutcome.reset] closes the
  /// sheet — anything else leaves the PIN exactly where it was.
  Future<void> _confirm() async {
    if (_busy) return;
    if (_code.length != 6) {
      setState(() => _note = 'Enter all six digits from the email.');
      return;
    }

    setState(() {
      _step = _Step.checking;
      _note = null;
    });
    _codeFocus.unfocus();

    final check =
        await ref.read(pinGateProvider).confirmPinResetCode(widget.uid, _code);
    if (!mounted) return;

    switch (check.outcome) {
      case PinResetOutcome.reset:
        HapticFeedback.mediumImpact();
        Navigator.of(context).pop(true);
        return;
      case PinResetOutcome.wrongCode:
        HapticFeedback.heavyImpact();
        setState(() {
          _step = _Step.entered;
          _code = '';
          _note = check.message;
        });
        _codeController.clear();
        _codeFocus.requestFocus();
        return;
      case PinResetOutcome.unusable:
        // The code cannot be tried again. Offer the only useful next step
        // rather than leaving six dead digits on screen.
        setState(() {
          _step = _Step.restart;
          _code = '';
          _note = check.message;
        });
        _codeController.clear();
        return;
      case PinResetOutcome.unavailable:
        // Offline, or a server fault. The code may still be good, so keep it.
        setState(() {
          _step = _Step.entered;
          _note = check.message;
        });
        return;
    }
  }

  /// The clock time the code stops working, in the phone's own hours — "until
  /// 3:42 PM" is a fact the Admin can act on; "14 minutes" has to be counted.
  String? get _expiryText {
    final expiresAt = _expiresAt;
    if (expiresAt == null) return null;
    final hour = expiresAt.hour % 12 == 0 ? 12 : expiresAt.hour % 12;
    final minute = expiresAt.minute.toString().padLeft(2, '0');
    final meridiem = expiresAt.hour < 12 ? 'AM' : 'PM';
    return '$hour:$minute $meridiem';
  }

  /// True once the local clock has passed the expiry. The server is the real
  /// judge — this only saves the Admin typing six digits into a dead code.
  bool get _expired {
    final expiresAt = _expiresAt;
    return expiresAt != null && !DateTime.now().isBefore(expiresAt);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_busy,
      child: SafeArea(
        child: Padding(
          // The keyboard covers the field on a short phone; let the sheet scroll
          // rather than push its own footer off the top.
          padding: EdgeInsets.fromLTRB(
              24, 12, 24, 24 + MediaQuery.of(context).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.cardBorder,
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.mark_email_read_outlined,
                      size: 18,
                      color: AppColors.primaryForest,
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        // The action, not the gate's question again: the
                        // trigger below the pad already says "Cannot remember
                        // your PIN?".
                        'Reset the Security PIN',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.cinzel(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textDark,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _step == _Step.idle
                      ? 'A six-digit code will be sent to the Admin email on '
                          'this account. Type it here and you can choose a new '
                          'PIN.'
                      : 'Enter the six digits sent to your email. The code is '
                          'checked by the server, then the old PIN is set '
                          'aside.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    height: 1.5,
                    color: AppColors.textMuted,
                  ),
                ),
                if (_maskedEmail != null) ...[
                  const SizedBox(height: 10),
                  _AddressChip(address: _maskedEmail!),
                ],
                const SizedBox(height: 12),
                // What this costs, in the Admin's own words. A reset that
                // carries a real proof still clears the lockout counters — and
                // the record still goes — so it is said before the button, not
                // after it.
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.statusAlert.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'This clears the PIN record, so the lockout count and any '
                    'waiting time go with it. Your bookings and money are not '
                    'affected.',
                    style: GoogleFonts.inter(
                      fontSize: 11.5,
                      height: 1.5,
                      color: AppColors.textDark,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                ..._body(),
                if (_note != null) ...[
                  const SizedBox(height: 10),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      _note!,
                      key: const Key('forgot-pin-note'),
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                        color: AppColors.statusAlert,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: TextButton(
                    key: const Key('forgot-pin-back'),
                    // ADR-0015 §6: `Back` is the cancel word in this house.
                    onPressed:
                        _busy ? null : () => Navigator.of(context).pop(false),
                    child: Text(
                      'Back',
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The middle of the sheet, which is the only part the step changes.
  List<Widget> _body() {
    switch (_step) {
      case _Step.idle:
      case _Step.sending:
        return [
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              key: const Key('forgot-pin-send'),
              onPressed: _busy ? null : _send,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryForest,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _step == _Step.sending
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      'Send the code',
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
            ),
          ),
        ];

      case _Step.restart:
        return [
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              key: const Key('forgot-pin-resend'),
              onPressed: _send,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryForest,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                'Send a new code',
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ];

      case _Step.entered:
      case _Step.checking:
        final expired = _expired;
        return [
          TextField(
            key: const Key('forgot-pin-code'),
            controller: _codeController,
            focusNode: _codeFocus,
            enabled: !_busy && !expired,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            maxLength: 6,
            autocorrect: false,
            enableSuggestions: false,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: GoogleFonts.inter(
              fontSize: 26,
              letterSpacing: 10,
              fontWeight: FontWeight.w700,
              color: AppColors.textDark,
            ),
            decoration: InputDecoration(
              counterText: '',
              hintText: '••••••',
              hintStyle: GoogleFonts.inter(
                fontSize: 26,
                letterSpacing: 10,
                color: AppColors.cardBorder,
              ),
              filled: true,
              fillColor: AppColors.surfaceSunken,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
            onChanged: (value) => setState(() {
              _code = value;
              if (_note != null) _note = null;
            }),
            onSubmitted: (_) => _confirm(),
          ),
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            child: Text(
              expired
                  ? 'That code has expired. Send a new one.'
                  : 'The code works until ${_expiryText ?? 'shortly'}.',
              style: GoogleFonts.inter(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: expired ? AppColors.statusAlert : AppColors.textMuted,
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              key: const Key('forgot-pin-confirm'),
              onPressed: _busy || expired || _code.length != 6
                  ? null
                  : _confirm,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryForest,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _step == _Step.checking
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      'Set the PIN aside',
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
            ),
          ),
          TextButton(
            key: const Key('forgot-pin-resend'),
            onPressed: _busy ? null : _send,
            child: Text(
              'Didn\'t get it? Send again',
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.primaryForest,
              ),
            ),
          ),
        ];
    }
  }
}

/// The address the code went to, half-masked — enough to recognise the inbox,
/// not enough for anyone else holding the phone to harvest.
class _AddressChip extends StatelessWidget {
  final String address;

  const _AddressChip({required this.address});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.accentGoldLight.withOpacity(0.35),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.accentGold.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.mail_outline_rounded,
              size: 14, color: AppColors.accentGoldDark),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              address,
              key: const Key('forgot-pin-address'),
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textDark,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
