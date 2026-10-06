import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/pin_store.dart';
import 'security_pin_sheet.dart';

/// Create — or, from Settings, change — the Admin's Security PIN.
///
/// The create flow is forced on first Admin sign-in (`MainShellScreen`
/// checks `PinGate.setupState` and opens this before anything else); the
/// change flow asks for the current PIN first, so a borrowed phone cannot
/// rotate its way around a PIN it does not know. Being forced is the point:
/// a gate that can be dismissed is not a gate, and the PIN cannot be
/// disabled at all (disabling it would itself be a bypass — ADR-0015).
///
/// Returns true when a PIN is in place.
Future<bool> showSetupPinSheet(BuildContext context, {bool change = false}) {
  return showModalBottomSheet<bool>(
    context: context,
    backgroundColor: Colors.white,
    isDismissible: false,
    enableDrag: false,
    // Size to the keypad, for the same reason as the entry sheet: the default
    // 9/16 cap is smaller than four 64px rows plus the mismatch note.
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _SetupPinSheetBody(change: change),
  ).then((done) => done ?? false);
}

/// The change flow's three steps: verify the current PIN, choose one, repeat
/// it. The create flow starts at [enter].
enum _Phase { current, enter, repeat }

class _SetupPinSheetBody extends ConsumerStatefulWidget {
  final bool change;

  const _SetupPinSheetBody({required this.change});

  @override
  ConsumerState<_SetupPinSheetBody> createState() => _SetupPinSheetBodyState();
}

class _SetupPinSheetBodyState extends ConsumerState<_SetupPinSheetBody> {
  final GlobalKey<PinEntryPadState> _pad = GlobalKey<PinEntryPadState>();
  final GlobalKey<PinKeyboardInputState> _keyboard =
      GlobalKey<PinKeyboardInputState>();
  bool _busy = false;
  bool _locked = false;
  DateTime? _lockedUntil;
  Timer? _countdown;

  /// `current` → `enter` → `repeat`. `current` only exists in change mode.
  _Phase _phase = _Phase.enter;
  String _firstPin = '';
  bool _mismatch = false;

  @override
  void initState() {
    super.initState();
    if (widget.change) _phase = _Phase.current;
  }

  @override
  void dispose() {
    _countdown?.cancel();
    super.dispose();
  }

  String get _uid {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    return auth.uid ?? auth.sessionEmail ?? 'admin';
  }

  String get _title {
    switch (_phase) {
      case _Phase.current:
        return 'Enter your current PIN';
      case _Phase.enter:
        return 'Create your Security PIN';
      case _Phase.repeat:
        return 'Enter it once more';
    }
  }

  String get _consequence {
    switch (_phase) {
      case _Phase.current:
        return 'Changing the PIN starts with the one you have. '
            'Approve, publish and delete all ask for it.';
      case _Phase.enter:
        return 'Six digits, something nobody at the counter can guess. '
            'Approve, publish and delete all ask for it. It cannot be turned off.';
      case _Phase.repeat:
        return 'Once more, to catch a typo before it locks you out.';
    }
  }

  void _lock(DateTime until) {
    _countdown?.cancel();
    setState(() {
      _lockedUntil = until;
      _locked = true;
    });
    _countdown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (!DateTime.now().isBefore(until)) {
        timer.cancel();
        setState(() {
          _lockedUntil = null;
          _locked = false;
        });
        _pad.currentState?.reset();
      } else {
        setState(() {});
      }
    });
  }

  /// The pad's own keys. The hidden field is emptied so the two routes cannot
  /// both hold digits — the pad is what the Admin sees, so it is what the
  /// entry is read from once a key has been tapped.
  void _onPadChanged(String digits) {
    _keyboard.currentState?.clear();
  }

  /// The platform keyboard. Pushed into the pad so the dots fill the same way
  /// a tap fills them, and a full entry submits the same way too.
  void _onKeyboardChanged(String digits) {
    final complete = _pad.currentState?.typeFromKeyboard(digits) ?? false;
    if (complete) {
      _keyboard.currentState?.clear();
      _submit(digits);
    }
  }

  Future<void> _submit(String pin) async {
    if (_busy || _locked) return;
    final gate = ref.read(pinGateProvider);
    setState(() => _busy = true);

    if (_phase == _Phase.current) {
      final result = await gate.verify(_uid, pin);
      if (!mounted) return;
      setState(() => _busy = false);
      if (result.outcome == PinVerifyOutcome.verified) {
        setState(() => _phase = _Phase.enter);
        _pad.currentState?.reset();
        return;
      }
      HapticFeedback.heavyImpact();
      _pad.currentState?.reset();
      if (result.outcome == PinVerifyOutcome.locked ||
          result.lockedUntil != null) {
        _lock(result.lockedUntil ?? DateTime.now());
      }
      return;
    }

    if (_phase == _Phase.enter) {
      setState(() {
        _busy = false;
        _mismatch = false;
        _firstPin = pin;
        _phase = _Phase.repeat;
      });
      _pad.currentState?.reset();
      return;
    }

    // repeat
    if (pin != _firstPin) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      if (!mounted) return;
      setState(() {
        _busy = false;
        _mismatch = true;
        _firstPin = '';
        _phase = _Phase.enter;
      });
      HapticFeedback.heavyImpact();
      _pad.currentState?.reset();
      return;
    }

    final problem = await gate.setPin(_uid, pin);
    if (!mounted) return;
    if (problem != null) {
      setState(() => _busy = false);
      _pad.currentState?.reset();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(problem),
      ));
      return;
    }
    HapticFeedback.mediumImpact();
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Setup cannot be dismissed — the app has no ungated state to fall
      // back to. The change flow, entered from Settings, is a normal sheet.
      canPop: !widget.change ? false : true,
      child: SafeArea(
        // Same arrangement as the gate and the entry sheet: the keyboard layer
        // underneath, so the keys keep their own taps and empty space raises
        // the keyboard.
        child: Stack(
          children: [
            Positioned.fill(
              child: PinKeyboardInput(
                key: _keyboard,
                enabled: !_busy && !_locked,
                // Off: this sheet is opened by a tap on a control, and raising
                // a keyboard nobody asked for covers the answer they are
                // giving. A tap on empty space still brings it up.
                autofocus: false,
                onChanged: _onKeyboardChanged,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
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
                      Icon(
                        _phase == _Phase.current
                            ? Icons.lock_outline_rounded
                            : Icons.shield_outlined,
                        size: 18,
                        color: AppColors.primaryForest,
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          _title,
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
                    _consequence,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      height: 1.5,
                      color: AppColors.textMuted,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_locked)
                    Text(
                      'Too many wrong entries. Try again in '
                      '${_lockedUntil == null ? 0 : _lockedUntil!.difference(DateTime.now()).inSeconds}s.',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.statusAlert,
                      ),
                    ),
                  PinEntryPad(
                    key: _pad,
                    enabled: !_busy && !_locked,
                    message: _mismatch
                        ? 'Those two did not match — start again.'
                        : null,
                    messageColor: AppColors.statusAlert,
                    onChanged: _onPadChanged,
                    onComplete: _submit,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Settings' door into the change flow: current PIN, then the new one twice.
/// Offered from the More sheet, beside sign-out. Not offering a "turn the
/// PIN off" is deliberate — see ADR-0015.
Future<void> showChangePinSheet(BuildContext context) {
  return showSetupPinSheet(context, change: true);
}
