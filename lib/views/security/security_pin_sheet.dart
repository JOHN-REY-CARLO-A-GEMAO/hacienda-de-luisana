import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/pin_store.dart';

/// The Security gate's first tier (ADR-0015): a bottom sheet that asks for
/// the Admin's six-digit Security PIN before a sensitive action runs.
///
/// [requirePinTicket] is what screens call. A ticket minted less than two
/// minutes ago answers without a prompt — approving a morning's arrivals
/// costs one entry, not one per arrival — and the service backstop in
/// `FirestoreService.applyBookingAction` re-checks whatever this returns, so
/// a stale or absent ticket refuses the action rather than sneaking through.
Future<SecurityTicket?> requirePinTicket(
  BuildContext context, {
  required WidgetRef ref,
  required String title,
  required String consequence,
}) {
  final fresh = ref.read(pinGateProvider).freshTicket();
  if (fresh != null) return Future<SecurityTicket?>.value(fresh);
  return showSecurityPinSheet(context, title: title, consequence: consequence);
}

/// Always asks. The setup sheet and Settings' change flow drive [PinGate]
/// directly instead.
Future<SecurityTicket?> showSecurityPinSheet(
  BuildContext context, {
  required String title,
  required String consequence,
}) {
  return showModalBottomSheet<SecurityTicket>(
    context: context,
    backgroundColor: Colors.white,
    isDismissible: true,
    enableDrag: false,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _SecurityPinSheetBody(
      title: title,
      consequence: consequence,
    ),
  );
}

class _SecurityPinSheetBody extends ConsumerStatefulWidget {
  final String title;
  final String consequence;

  const _SecurityPinSheetBody({
    required this.title,
    required this.consequence,
  });

  @override
  ConsumerState<_SecurityPinSheetBody> createState() =>
      _SecurityPinSheetBodyState();
}

class _SecurityPinSheetBodyState extends ConsumerState<_SecurityPinSheetBody> {
  final GlobalKey<PinEntryPadState> _pad = GlobalKey<PinEntryPadState>();
  bool _busy = false;

  /// Non-null while the ladder holds the sheet open; a live countdown runs
  /// underneath and the keypad is dead until it drains.
  DateTime? _lockedUntil;
  Timer? _countdown;

  bool get _locked => _lockedUntil != null;

  @override
  void dispose() {
    _countdown?.cancel();
    super.dispose();
  }

  String get _uid {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return auth.uid ?? auth.sessionEmail ?? 'admin';
  }

  void _lock(DateTime until) {
    _countdown?.cancel();
    setState(() => _lockedUntil = until);
    _countdown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (!DateTime.now().isBefore(until)) {
        timer.cancel();
        setState(() => _lockedUntil = null);
        _pad.currentState?.reset();
      } else {
        setState(() {}); // tick the countdown text
      }
    });
  }

  Future<void> _submit(String pin) async {
    if (_busy || _locked) return;
    setState(() => _busy = true);
    final result =
        await ref.read(pinGateProvider).verify(_uid, pin);
    if (!mounted) return;
    if (result.outcome == PinVerifyOutcome.verified && result.ticket != null) {
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(result.ticket);
      return;
    }
    setState(() => _busy = false);
    switch (result.outcome) {
      case PinVerifyOutcome.wrongPin:
        HapticFeedback.heavyImpact();
        _pad.currentState?.reset();
        final lockedUntil = result.lockedUntil;
        if (lockedUntil != null) _lock(lockedUntil);
        return;
      case PinVerifyOutcome.locked:
        if (result.lockedUntil != null) _lock(result.lockedUntil!);
        return;
      case PinVerifyOutcome.notSetUp:
      case PinVerifyOutcome.unavailable:
        // Offline with no cached record: refuse loudly rather than fail
        // open. The Admin reconnects and tries again.
        _pad.currentState?.reset();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          backgroundColor: AppColors.statusAlert,
          content: Text(
              'The Security PIN could not be checked — you appear to be offline. Reconnect and try again.'),
          duration: Duration(seconds: 6),
        ));
        return;
    }
  }

  String get _lockMessage {
    final until = _lockedUntil;
    if (until == null) return '';
    final remaining = until.difference(DateTime.now());
    final seconds = remaining.inSeconds <= 0 ? 0 : remaining.inSeconds;
    return 'Too many wrong entries. Try again in ${seconds}s.';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // A locked sheet does not close — not by swipe, not by tapping outside.
      // The countdown is the way out, and it is the point of the lockout.
      canPop: !_locked,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
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
                  const Icon(Icons.lock_outline_rounded,
                      size: 18, color: AppColors.primaryForest),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      widget.title,
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
                widget.consequence,
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  height: 1.5,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 16),
              PinEntryPad(
                key: _pad,
                enabled: !_busy && !_locked,
                message: _lockMessage,
                messageColor: AppColors.statusAlert,
                onComplete: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The six dots and the 3×4 keypad, shared by the PIN sheet and the setup /
/// change-PIN sheets so every PIN entry in the app looks and behaves the
/// same: 64px targets, a haptic per digit, auto-submit at six, and a shake
/// with a red flash when an entry is refused.
class PinEntryPad extends StatefulWidget {
  /// Typed so far; the parent verifies and calls [PinEntryPadState.reset].
  final void Function(String pin) onComplete;

  /// False while verifying or locked out; dead keys, live dots.
  final bool enabled;

  /// One line under the dots — the countdown, or a wrong-entry note.
  final String? message;
  final Color? messageColor;

  const PinEntryPad({
    super.key,
    required this.onComplete,
    this.enabled = true,
    this.message,
    this.messageColor,
  });

  @override
  State<PinEntryPad> createState() => PinEntryPadState();
}

class PinEntryPadState extends State<PinEntryPad>
    with SingleTickerProviderStateMixin {
  static const int pinLength = 6;

  String _digits = '';
  bool _flashing = false;
  late final AnimationController _shake = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );

  @override
  void dispose() {
    _shake.dispose();
    super.dispose();
  }

  /// Clear the entry with the wrong-PIN shake: dots flash statusAlert, the
  /// pad sways, and the digits drain ready for the next try.
  void reset() {
    setState(() => _flashing = true);
    _shake.forward(from: 0);
    Timer(const Duration(milliseconds: 460), () {
      if (!mounted) return;
      setState(() {
        _digits = '';
        _flashing = false;
      });
    });
  }

  void _tap(String digit) {
    if (!widget.enabled || _digits.length >= pinLength) return;
    HapticFeedback.selectionClick();
    final next = _digits + digit;
    setState(() => _digits = next);
    if (next.length == pinLength) {
      widget.onComplete(next);
    }
  }

  void _delete() {
    if (!widget.enabled || _digits.isEmpty) return;
    HapticFeedback.selectionClick();
    setState(() => _digits = _digits.substring(0, _digits.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    final dotColor = _flashing ? AppColors.statusAlert : AppColors.textDark;
    return AnimatedBuilder(
      animation: _shake,
      builder: (context, child) {
        final offset = _shake.isAnimating ? _offset(_shake.value) : 0.0;
        return Transform.translate(
          offset: Offset(offset, 0),
          child: child,
        );
      },
      child: Column(
        children: [
          if (widget.message != null && widget.message!.isNotEmpty) ...[
            Text(
              widget.message!,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: widget.messageColor ?? AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 10),
          ],
          Semantics(
            label:
                '${_digits.length} of $pinLength digits of the Security PIN entered',
            container: true,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < pinLength; i++) ...[
                  if (i > 0) const SizedBox(width: 14),
                  Container(
                    key: Key('pin-dot-$i'),
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i < _digits.length
                          ? dotColor
                          : (_flashing
                              ? AppColors.statusAlert.withOpacity(0.25)
                              : AppColors.cardBorder),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (final d in ['1', '2', '3']) _key(d),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (final d in ['4', '5', '6']) _key(d),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (final d in ['7', '8', '9']) _key(d),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _spacerKey(),
              _key('0'),
              _deleteKey(),
            ],
          ),
        ],
      ),
    );
  }

  double _offset(double t) {
    // Three sways, decaying: sin(3πt)·9·(1−t).
    final sway = 3 * 3.1415926535897932 * t;
    return math.sin(sway) * 9 * (1 - t);
  }

  Widget _key(String digit) {
    return Semantics(
      label: digit,
      button: true,
      child: InkWell(
        key: Key('pin-key-$digit'),
        onTap: () => _tap(digit),
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 72,
          height: 64,
          child: Center(
            child: Text(
              digit,
              style: GoogleFonts.inter(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: widget.enabled
                    ? AppColors.textDark
                    : AppColors.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _deleteKey() {
    return Semantics(
      label: 'Delete the last digit',
      button: true,
      child: InkWell(
        key: const Key('pin-key-backspace'),
        onTap: _delete,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 72,
          height: 64,
          child: const Center(
            child: Icon(Icons.backspace_outlined,
                size: 22, color: AppColors.textDark),
          ),
        ),
      ),
    );
  }

  Widget _spacerKey() {
    return const SizedBox(width: 72, height: 64);
  }
}
