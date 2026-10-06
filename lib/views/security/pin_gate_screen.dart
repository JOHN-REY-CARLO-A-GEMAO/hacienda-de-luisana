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
import 'forgot_pin_sheet.dart';
import 'security_pin_sheet.dart';

/// The gate in front of the whole app, the way a banking app puts its MPIN in
/// front of the balance (ADR-0015).
///
/// [requirePinTicket] asks for the PIN before one *sensitive action*. This
/// screen asks for it before *the app*, on the way in: a signed-in Admin who
/// opens Hacienda on someone else's phone, or picks up a phone left unlocked,
/// meets six digits and a decision before a single Booking is on screen. It is
/// the same [PinGate] and the same [PinEntryPad] as the action sheet — one PIN,
/// one ladder, one ticket — only the door is wider.
///
/// What changed and why it is not the sheet again:
///
///   - `MainShellScreen` used to run `setupState()` in a post-frame callback
///     and, when the record was unreachable, show a snackbar and carry on with
///     sensitive actions merely locked. That is the failure ADR-0015 names: a
///     gate that can be walked past is not a gate. Here the same answer is a
///     whole screen with no way off but Retry or Sign out.
///   - First run creates the PIN here, twice, before the shell is ever built —
///     so the guided tour no longer has to queue behind a sheet.
///   - `AuthGate` re-locks on the same suspension boundary that wipes the
///     ticket, so leaving the app and coming back asks again.
///
/// No "skip", no "turn it off", and no default PIN: [PinGate.setPin] is the
/// only way one exists, and this screen is where it is called.
class PinGateScreen extends ConsumerStatefulWidget {
  /// Called once the Admin is past the gate. The caller shows the shell.
  final VoidCallback onUnlocked;

  const PinGateScreen({super.key, required this.onUnlocked});

  @override
  ConsumerState<PinGateScreen> createState() => _PinGateScreenState();
}

/// What the gate is asking for right now.
enum PinGatePhase {
  /// `setupState()` is in flight — which on a fresh install is a Firestore
  /// read, so this is a spinner rather than a blank screen.
  checking,

  /// No PIN exists for this account: choose one, then confirm it.
  setUpEnter,
  setUpRepeat,

  /// A PIN exists: check it.
  enter,

  /// No cached record and the server cannot be reached, so there is nothing
  /// to check against. Blocked, with Retry — never with a way past.
  blocked,
}

class _PinGateScreenState extends ConsumerState<PinGateScreen> {
  final GlobalKey<PinEntryPadState> _pad = GlobalKey<PinEntryPadState>();
  final GlobalKey<PinKeyboardInputState> _keyboard =
      GlobalKey<PinKeyboardInputState>();
  PinGatePhase _phase = PinGatePhase.checking;
  bool _busy = false;
  String _firstPin = '';
  bool _mismatch = false;
  DateTime? _lockedUntil;
  Timer? _countdown;

  bool get _locked => _lockedUntil != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _resolve());
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

  /// The pad's own keys. The hidden field is emptied here so the two routes
  /// cannot both hold digits: the pad is what the Admin sees, so it is what
  /// the entry is read from once a key has been tapped.
  void _onPadChanged(String digits) {
    _keyboard.currentState?.clear();
  }

  /// The platform keyboard. The digits are pushed into the pad so the dots
  /// fill the same way they do for a tap, and a full entry submits the same
  /// way it does.
  void _onKeyboardChanged(String digits) {
    final complete = _pad.currentState?.typeFromKeyboard(digits) ?? false;
    if (complete) {
      _keyboard.currentState?.clear();
      _submit(digits);
    }
  }

  /// Ask the gate what this device may do. Every branch lands in a state the
  /// Admin can only leave by typing a PIN — there is no fall-through.
  Future<void> _resolve() async {
    if (!mounted) return;
    setState(() {
      _phase = PinGatePhase.checking;
      _busy = false;
      _mismatch = false;
      _firstPin = '';
      _lockedUntil = null;
    });
    _keyboard.currentState?.clear();
    final state = await ref.read(pinGateProvider).setupState(_uid);
    if (!mounted) return;
    setState(() {
      switch (state) {
        case PinSetupState.ready:
          _phase = PinGatePhase.enter;
        case PinSetupState.setUpNeeded:
          _phase = PinGatePhase.setUpEnter;
        case PinSetupState.unreachable:
          _phase = PinGatePhase.blocked;
      }
    });
  }

  void _lock(DateTime until) {
    _countdown?.cancel();
    setState(() {
      _lockedUntil = until;
      _busy = false;
    });
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
    final gate = ref.read(pinGateProvider);

    if (_phase == PinGatePhase.setUpEnter) {
      setState(() {
        _busy = false;
        _mismatch = false;
        _firstPin = pin;
        _phase = PinGatePhase.setUpRepeat;
      });
      _pad.currentState?.reset();
      return;
    }

    if (_phase == PinGatePhase.setUpRepeat) {
      if (pin != _firstPin) {
        await Future<void>.delayed(const Duration(milliseconds: 250));
        if (!mounted) return;
        setState(() {
          _busy = false;
          _mismatch = true;
          _firstPin = '';
          _phase = PinGatePhase.setUpEnter;
        });
        HapticFeedback.heavyImpact();
        _pad.currentState?.reset();
        return;
      }
      setState(() => _busy = true);
      final problem = await gate.setPin(_uid, pin);
      if (!mounted) return;
      if (problem != null) {
        setState(() => _busy = false);
        _pad.currentState?.reset();
        _message(problem);
        return;
      }
      HapticFeedback.mediumImpact();
      widget.onUnlocked();
      return;
    }

    if (_phase != PinGatePhase.enter) return;
    setState(() => _busy = true);
    final result = await gate.verify(_uid, pin);
    if (!mounted) return;

    switch (result.outcome) {
      case PinVerifyOutcome.verified:
        if (result.ticket == null) {
          // Correct PIN, no ticket: the shape the screen cannot act on. Fail
          // closed rather than wave someone through with nothing to spend.
          setState(() => _busy = false);
          _pad.currentState?.reset();
          _message('The Security PIN was accepted but no session ticket was '
              'issued. Enter it again.');
          return;
        }
        HapticFeedback.mediumImpact();
        widget.onUnlocked();
        return;
      case PinVerifyOutcome.wrongPin:
        setState(() => _busy = false);
        HapticFeedback.heavyImpact();
        _pad.currentState?.reset();
        final lockedUntil = result.lockedUntil;
        if (lockedUntil != null) _lock(lockedUntil);
        return;
      case PinVerifyOutcome.locked:
        setState(() => _busy = false);
        if (result.lockedUntil != null) _lock(result.lockedUntil!);
        return;
      case PinVerifyOutcome.notSetUp:
      case PinVerifyOutcome.unavailable:
        // The record vanished or the server is gone. Both are questions for
        // `setupState`, not for the pad: ask again rather than guess.
        _resolve();
        return;
    }
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: AppColors.statusAlert,
      content: Text(text),
      duration: const Duration(seconds: 6),
    ));
  }

  /// The forgotten-PIN reset (ADR-0016), then straight back into setup.
  ///
  /// Re-resolving rather than jumping to `setUpEnter` on purpose: the record is
  /// gone on both sides now, so `setupState()` reaches
  /// [PinSetupState.setUpNeeded] on its own — the same question the first run
  /// asked, asked for the same reason. Forcing the phase here would be a
  /// shortcut that could disagree with what the server actually holds.
  Future<void> _forgetPin() async {
    if (_busy) return;
    final reset = await showForgotPinSheet(context, uid: _uid);
    if (!mounted || !reset) return;
    await _resolve();
  }

  String get _title {
    switch (_phase) {
      case PinGatePhase.checking:
        return 'Checking this device';
      case PinGatePhase.setUpEnter:
        return 'Create your Security PIN';
      case PinGatePhase.setUpRepeat:
        return 'Enter it once more';
      case PinGatePhase.enter:
        return 'Enter your Security PIN';
      case PinGatePhase.blocked:
        return 'The Security PIN cannot be checked';
    }
  }

  String get _consequence {
    // Deliberately one short line each. This text used to run to four or five
    // lines on a 320px phone, which made the whole gate taller than the screen
    // and pushed the keypad well below the middle — the copy is part of the
    // layout problem, not decoration on top of it.
    switch (_phase) {
      case PinGatePhase.checking:
        return 'One moment.';
      case PinGatePhase.setUpEnter:
        return 'Six digits. It cannot be turned off.';
      case PinGatePhase.setUpRepeat:
        return 'Once more, to catch a typo.';
      case PinGatePhase.enter:
        return 'Five wrong entries lock the app.';
      case PinGatePhase.blocked:
        return 'Reconnect and try again.';
    }
  }

  String get _lockMessage {
    final until = _lockedUntil;
    if (until == null) return '';
    final seconds = until.difference(DateTime.now()).inSeconds;
    return 'Too many wrong entries. Try again in ${seconds <= 0 ? 0 : seconds}s.';
  }

  @override
  Widget build(BuildContext context) {
    final blocked = _phase == PinGatePhase.blocked;
    return PopScope(
      // There is no route behind this screen to go back to, and the lockout is
      // not dismissible either: the countdown is the way out, and that is the
      // point of the ladder.
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.primaryDark,
        body: SafeArea(
          // The keyboard layer sits UNDER the pad so the keys keep their own
          // taps, and a tap on any empty part of the gate falls through to it
          // and raises the numeric keyboard.
          child: Stack(
            children: [
              Positioned.fill(
                child: PinKeyboardInput(
                  key: _keyboard,
                  enabled: !_busy &&
                      !_locked &&
                      _phase != PinGatePhase.checking &&
                      _phase != PinGatePhase.blocked,
                  onChanged: _onKeyboardChanged,
                ),
              ),
              // The keypad is the centred element, not the composition. Two `Expanded`
              // spacers — the header pinned to the top of the upper one, the
              // sign-out pinned to the bottom of the lower one — put the
              // keypad's centre on the screen's centre exactly, at any height.
              // Centring the whole block instead leaves the pad sitting low by
              // however much taller the header is than the footer, which is
              // what "pushed toward the bottom" looked like.
              //
              // `SliverFillRemaining` gives the Column a definite height to
              // distribute, and lets it scroll when the soft keyboard leaves
              // too little — the one case where scrolling is necessary rather
              // than avoidable.
              Positioned.fill(
                child: CustomScrollView(
                  slivers: [
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
                        child: Column(
                          key: const Key('pin-gate-block'),
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Expanded(
                              child: Align(
                                alignment: Alignment.topCenter,
                                child: Column(
                                  key: const Key('pin-gate-header'),
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment:
                                      CrossAxisAlignment.center,
                                  children: [
                                    const _Masthead(),
                                    Icon(
                                      blocked
                                          ? Icons.cloud_off_rounded
                                          : (_phase == PinGatePhase.enter
                                              ? Icons.lock_outline_rounded
                                              : Icons.shield_outlined),
                                      size: 24,
                                      color: AppColors.accentGold,
                                    ),
                                    const SizedBox(height: 10),
                                    Text(
                                      _title,
                                      textAlign: TextAlign.center,
                                      style: GoogleFonts.cinzel(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _consequence,
                                      textAlign: TextAlign.center,
                                      style: GoogleFonts.inter(
                                        fontSize: 12,
                                        height: 1.4,
                                        color: Colors.white.withOpacity(0.72),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            if (_phase == PinGatePhase.checking)
                              const Padding(
                                padding: EdgeInsets.symmetric(vertical: 48),
                                child: CircularProgressIndicator(
                                  color: AppColors.accentGold,
                                ),
                              )
                            else if (blocked)
                              _BlockedActions(
                                onRetry: _busy
                                    ? null
                                    : () {
                                        setState(() => _busy = true);
                                        _resolve();
                                      },
                                onSignOut: () => legacy
                                    .Provider.of<AuthStore>(context,
                                            listen: false)
                                    .signOut(),
                              )
                            else ...[
                              PinEntryPad(
                                key: _pad,
                                enabled: !_busy && !_locked,
                                message: _mismatch
                                    ? 'Those two did not match — start again.'
                                    : (_locked ? _lockMessage : null),
                                messageColor: AppColors.statusAlert,
                                onChanged: _onPadChanged,
                                onComplete: _submit,
                                theme: PinPadTheme.onDark,
                              ),
                            ],
                            const SizedBox(height: 10),
                            Expanded(
                              child: Align(
                                alignment: Alignment.bottomCenter,
                                child: blocked ||
                                        _phase == PinGatePhase.checking
                                    ? const SizedBox.shrink()
                                    : Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          // The way out of a gate nobody can
                                          // open (ADR-0016). Offered only where
                                          // a PIN exists to be lost and only
                                          // with a remote to dispose of it —
                                          // demo mode has no server record, so
                                          // it has no dead end to leave.
                                          if (_phase == PinGatePhase.enter &&
                                              ref
                                                  .read(pinGateProvider)
                                                  .remote !=
                                                  null)
                                            TextButton(
                                              key: const Key(
                                                  'pin-gate-forgot'),
                                              onPressed:
                                                  _busy ? null : _forgetPin,
                                              child: Text(
                                                'Cannot remember your PIN?',
                                                style: GoogleFonts.inter(
                                                  fontSize: 12,
                                                  fontWeight:
                                                      FontWeight.w600,
                                                  color: Colors.white
                                                      .withOpacity(0.75),
                                                ),
                                              ),
                                            ),
                                          TextButton(
                                            key: const Key('pin-gate-sign-out'),
                                            onPressed: () => legacy
                                                .Provider.of<AuthStore>(context,
                                                        listen: false)
                                                .signOut(),
                                            child: Text(
                                              'Use a different account',
                                              style: GoogleFonts.inter(
                                                fontSize: 12,
                                                fontWeight: FontWeight.w600,
                                                color: Colors.white
                                                    .withOpacity(0.75),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The app's name at the top of the gate, so a locked phone says whose it is.
class _Masthead extends StatelessWidget {
  const _Masthead();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 2),
      child: Column(
        children: [
          Text(
            AppConstants.appName,
            style: GoogleFonts.cinzel(
              fontSize: 13.5,
              fontWeight: FontWeight.bold,
              color: AppColors.accentGold,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            AppConstants.appTagline,
            style: GoogleFonts.inter(
              fontSize: 10,
              color: Colors.white.withOpacity(0.55),
            ),
          ),
        ],
      ),
    );
  }
}

/// Retry and sign-out for the blocked state — the only two doors out, and
/// neither is "through".
class _BlockedActions extends StatelessWidget {
  final VoidCallback? onRetry;
  final VoidCallback onSignOut;

  const _BlockedActions({required this.onRetry, required this.onSignOut});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            key: const Key('pin-gate-retry'),
            onPressed: onRetry,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.accentGold,
              foregroundColor: AppColors.primaryDark,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: Text(
              'Try again',
              style: GoogleFonts.inter(
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        TextButton(
          key: const Key('pin-gate-blocked-sign-out'),
          onPressed: onSignOut,
          child: Text(
            'Sign out instead',
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Colors.white.withOpacity(0.75),
            ),
          ),
        ),
      ],
    );
  }
}