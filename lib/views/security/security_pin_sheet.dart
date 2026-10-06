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
    // Size to the keypad rather than to 9/16 of the screen. The default cap
    // is what four 64px rows and the lockout countdown do not fit inside, and
    // a sheet that overflows takes the lockout message — the one line telling
    // the Admin how long is left — with it.
    isScrollControlled: true,
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
  final GlobalKey<PinKeyboardInputState> _keyboard =
      GlobalKey<PinKeyboardInputState>();
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
      case PinVerifyOutcome.verified:
        // Reached only when the store reports a correct PIN but mints no
        // ticket — the shape the pad above cannot act on. Fail closed rather
        // than pop a null ticket the call site would treat as "cancelled".
        _pad.currentState?.reset();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          backgroundColor: AppColors.statusAlert,
          content: Text(
              'The Security PIN was accepted but no session ticket was issued. Run the action again.'),
          duration: Duration(seconds: 6),
        ));
        return;
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
        // Same arrangement as the gate: the keyboard layer underneath, so the
        // keys keep their own taps and empty space raises the keyboard.
        child: Stack(
          children: [
            Positioned.fill(
              child: PinKeyboardInput(
                key: _keyboard,
                enabled: !_busy && !_locked,
                // Off: this sheet is opened by a tap on a sensitive control,
                // and raising a keyboard the Admin did not ask for covers the
                // control they are answering for. A tap on empty space still
                // brings it up.
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

/// A transparent field that holds the platform keyboard open for a
/// [PinEntryPad].
///
/// The pad draws its own keys, which on a phone means no keyboard ever opens
/// and the digits have to be tapped one at a time. This is the other route:
/// an invisible field sitting underneath the pad keeps focus — and therefore
/// the numeric keyboard — up, and turns typed digits into the same entry a tap
/// would have made. Both routes stay live; nothing here replaces the pad.
///
/// Put it *below* the pad in a [Stack] and fill the space: the keys sit on
/// top and take their own taps, while a tap on any empty part of the screen
/// falls through to this and raises the keyboard.
class PinKeyboardInput extends StatefulWidget {
  /// Digits typed so far, oldest first. Only digits are ever reported.
  final ValueChanged<String> onChanged;

  /// False while verifying or locked out — the field is unfocused and the
  /// keyboard closes, so a PIN cannot be typed into a gate that is not asking.
  final bool enabled;

  /// Raise the keyboard as soon as the gate appears. On for the standing
  /// gate; off for a sheet, where the Admin has just tapped a control and
  /// raising a keyboard would cover the question they are answering.
  final bool autofocus;

  const PinKeyboardInput({
    super.key,
    required this.onChanged,
    this.enabled = true,
    this.autofocus = true,
  });

  @override
  State<PinKeyboardInput> createState() => PinKeyboardInputState();
}

class PinKeyboardInputState extends State<PinKeyboardInput> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focus = FocusNode();

  /// True while [clear] is emptying the field, so the resulting `onChanged('')`
  /// is not mistaken for the Admin deleting a digit.
  bool _suppress = false;

  @override
  void initState() {
    super.initState();
    if (widget.autofocus) {
      // After the first frame, so the field is mounted and the keyboard has a
      // window to come up over.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.enabled) _focus.requestFocus();
      });
    }
  }

  @override
  void didUpdateWidget(PinKeyboardInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled) {
      if (_focus.hasFocus) {
        // A wrong PIN or a lockout: put the keyboard away rather than leave a
        // digit field the gate is not currently reading.
        _focus.unfocus();
      }
      return;
    }
    if (_focus.hasFocus || !widget.autofocus) return;
    // The gate asks while it is still `checking`, so the field is born
    // disabled and a disabled TextField refuses focus. Ask again after the
    // rebuild that enables it — a request on a node whose field is not
    // attached yet is dropped, not queued.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.enabled) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// Clear the field without telling the parent — used after a submission, so
  /// the next attempt starts from empty whichever route typed the last one.
  void clear() {
    if (_controller.text.isEmpty) return;
    _suppress = true;
    _controller.clear();
    _suppress = false;
  }

  @override
  Widget build(BuildContext context) {
    return Opacity(
      // Invisible, not absent: the field has to hold a real connection to the
      // platform IME, which a removed widget does not have.
      opacity: 0,
      child: TextField(
        key: const Key('pin-keyboard-input'),
        controller: _controller,
        focusNode: _focus,
        enabled: widget.enabled,
        autofocus: false,
        showCursor: false,
        enableSuggestions: false,
        autocorrect: false,
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.done,
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(PinEntryPadState.pinLength),
        ],
        style: const TextStyle(
          height: 0.01,
          fontSize: 1,
          color: Colors.transparent,
        ),
        decoration: const InputDecoration(
          border: InputBorder.none,
          contentPadding: EdgeInsets.zero,
          isDense: true,
        ),
        onChanged: (value) {
          if (_suppress) return;
          widget.onChanged(value);
        },
      ),
    );
  }
}

/// The colours one PIN entry surface uses.
///
/// [PinEntryPad] is drawn in two places that share no colours: the white
/// sheets, and the gate, whose background is the deep forest green. One set
/// cannot serve both — the house dark ink that reads perfectly on white is
/// effectively invisible on `primaryDark` — so each surface names its own and
/// the gate passes [PinPadTheme.onDark].
///
/// White and gold, and nothing else, on the dark surface: white is the primary
/// (digits, backspace, empty outlines) and gold is the accent (the entered
/// dots), which is also what makes "filled" legible without a label.
class PinPadTheme {
  /// The digit colour, and the colour of a filled dot when `dotAccent` is
  /// false.
  final Color filled;

  /// The gold used for entered dots on the dark surface. Null on light, where
  /// the entered dot is simply the filled ink.
  final Color? dotAccent;

  /// The fill of an empty dot. Transparent on both surfaces — an empty slot is
  /// an outline, not a pale disc.
  final Color emptyFill;

  /// The outline of an empty dot: what makes "empty" readable at a glance.
  final Color emptyBorder;

  final Color backspace;

  /// The background behind a key. Faint on the dark gate so the keypad reads
  /// as buttons; invisible on the white sheets, which already have a card.
  final Color keyFill;

  const PinPadTheme({
    required this.filled,
    required this.emptyFill,
    required this.emptyBorder,
    required this.backspace,
    required this.keyFill,
    this.dotAccent,
  });

  /// On a white sheet: the house dark ink.
  static const PinPadTheme onLight = PinPadTheme(
    filled: AppColors.textDark,
    emptyFill: Colors.transparent,
    emptyBorder: AppColors.cardBorder,
    backspace: AppColors.textDark,
    keyFill: Colors.transparent,
  );

  /// On the gate's deep green.
  static const PinPadTheme onDark = PinPadTheme(
    filled: Colors.white,
    dotAccent: AppColors.accentGold,
    emptyFill: Colors.transparent,
    emptyBorder: Color(0x59FFFFFF),
    backspace: Colors.white,
    keyFill: Color(0x0FFFFFFF),
  );
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

  /// Every change to what has been typed, whichever route it came from — a tap
  /// on these keys, or the platform keyboard via [PinKeyboardInput].
  final ValueChanged<String>? onChanged;

  /// Which surface this pad is being drawn on. Defaults to the white sheets.
  final PinPadTheme theme;

  const PinEntryPad({
    super.key,
    required this.onComplete,
    this.enabled = true,
    this.message,
    this.messageColor,
    this.onChanged,
    this.theme = PinPadTheme.onLight,
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
      widget.onChanged?.call(_digits);
    });
  }

  /// Take digits typed on the platform keyboard as if they had been tapped.
  ///
  /// Returns true when the entry reached [pinLength], so the parent submits
  /// the way it does after a tap. Only the last [pinLength] digits are kept:
  /// a held key can overshoot, and the extra digit is not part of this PIN.
  bool typeFromKeyboard(String digits) {
    if (!widget.enabled) return false;
    final next = digits.length > pinLength
        ? digits.substring(digits.length - pinLength)
        : digits;
    setState(() => _digits = next);
    widget.onChanged?.call(next);
    return next.length == pinLength;
  }

  void _tap(String digit) {
    if (!widget.enabled || _digits.length >= pinLength) return;
    HapticFeedback.selectionClick();
    final next = _digits + digit;
    setState(() => _digits = next);
    widget.onChanged?.call(next);
    if (next.length == pinLength) {
      widget.onComplete(next);
    }
  }

  void _delete() {
    if (!widget.enabled || _digits.isEmpty) return;
    HapticFeedback.selectionClick();
    final next = _digits.substring(0, _digits.length - 1);
    setState(() => _digits = next);
    widget.onChanged?.call(next);
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    // A wrong entry flashes every dot red regardless of theme: it is an error,
    // not a colour scheme, and it has to be the same on both surfaces.
    final emptyBorder =
        _flashing ? AppColors.statusAlert : theme.emptyBorder;
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
                      // Entered: a solid disc, in the accent where the surface
                      // has one. Empty: an outline with nothing inside it, so
                      // "not yet" is a shape difference and not only a
                      // difference of intensity.
                      color: i < _digits.length
                          ? (_flashing
                              // The flash wins over the accent: a wrong entry
                              // has to read as wrong, not as "entered".
                              ? AppColors.statusAlert
                              : (theme.dotAccent ?? theme.filled))
                          : (_flashing
                              ? AppColors.statusAlert.withOpacity(0.25)
                              : theme.emptyFill),
                      border: i < _digits.length
                          ? null
                          : Border.all(color: emptyBorder, width: 1.5),
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
    final theme = widget.theme;
    return Semantics(
      label: digit,
      button: true,
      // Without this the child's own Text label merges in and a screen reader
      // announces the key twice — "5, 5" — because `Semantics` annotates its
      // child's node rather than replacing it.
      excludeSemantics: true,
      child: InkWell(
        key: Key('pin-key-$digit'),
        onTap: () => _tap(digit),
        customBorder: const CircleBorder(),
        child: Container(
          width: 72,
          height: 64,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: theme.keyFill,
          ),
          child: Text(
            digit,
            style: GoogleFonts.inter(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              // Dimmed rather than recoloured, so a dead keypad is still the
              // same colour as a live one — just quieter.
              color: widget.enabled
                  ? theme.filled
                  : theme.filled.withOpacity(0.4),
            ),
          ),
        ),
      ),
    );
  }

  Widget _deleteKey() {
    final theme = widget.theme;
    return Semantics(
      label: 'Delete the last digit',
      button: true,
      child: InkWell(
        key: const Key('pin-key-backspace'),
        onTap: _delete,
        customBorder: const CircleBorder(),
        child: Container(
          width: 72,
          height: 64,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: theme.keyFill,
          ),
          child: Icon(
            Icons.backspace_outlined,
            size: 22,
            color: widget.enabled
                ? theme.backspace
                : theme.backspace.withOpacity(0.4),
          ),
        ),
      ),
    );
  }

  Widget _spacerKey() {
    return const SizedBox(width: 72, height: 64);
  }
}
