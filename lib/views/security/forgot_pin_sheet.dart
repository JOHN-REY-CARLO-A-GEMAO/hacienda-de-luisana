import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../providers/app_providers.dart';
import '../../services/pin_store.dart';

/// The way out of a gate nobody can open (ADR-0016).
///
/// ADR-0015 built a Security PIN that is deliberately not self-service: rotation
/// asks for the current PIN first, and the rules refuse that rotation outright
/// while a lock is live. So a PIN chosen once and not written down leaves the
/// Admin in front of six dots with no exit — `setupState` answers `ready`
/// because the server still holds the record, and the record cannot be rotated
/// without the very PIN nobody has.
///
/// This sheet disposes of that record. What it is and is not, in the copy
/// below and in ADR-0016:
///
///   - the proof of identity is the **signed-in Admin session**, never the PIN.
///     The PIN is a guard rail, not a trust boundary (ADR-0015 §2), so this
///     cannot become a way to defeat the PIN — it is a way to stop being locked
///     out by one;
///   - it is **online by construction**. With no remote there is nothing to
///     dispose of and no dead end either, so this is never offered;
///   - it **costs the lockout watermark**: `failed_attempts` and `locked_until`
///     go with the record. That is the trade ADR-0015 made the other way and
///     this ADR reverses, and the rules' refusal of `delete` is what changes.
///
/// The 24 h cooldown is read from the cached record's stamp rather than
/// discovered from a `permission-denied`, so the wait is said out loud and the
/// button is simply not there until it has passed. A refusal — offline, or the
/// rules saying no — changes nothing locally and says so.
///
/// Returns true when a reset actually happened, so the caller re-resolves.
Future<bool> showForgotPinSheet(BuildContext context, {required String uid}) {
  return showModalBottomSheet<bool>(
    context: context,
    backgroundColor: Colors.white,
    // Dismissable while idle — this is a way out, not a gate — but not while a
    // reset is in flight, so a double tap cannot fire two deletes.
    isDismissible: true,
    enableDrag: true,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _ForgotPinSheetBody(uid: uid),
  ).then((done) => done ?? false);
}

class _ForgotPinSheetBody extends ConsumerStatefulWidget {
  final String uid;

  const _ForgotPinSheetBody({required this.uid});

  @override
  ConsumerState<_ForgotPinSheetBody> createState() => _ForgotPinSheetBodyState();
}

class _ForgotPinSheetBodyState extends ConsumerState<_ForgotPinSheetBody> {
  bool _busy = false;

  /// When the server would accept a reset, or null when the cached record
  /// carries no stamp — which the rules refuse too, so null is not "now" and
  /// the button stays available for the server to decide.
  DateTime? _readyAt;

  /// True until the cooldown has been read, so the sheet cannot open showing an
  /// enabled button it is about to disable.
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _readCooldown());
  }

  Future<void> _readCooldown() async {
    final gate = ref.read(pinGateProvider);
    final record = await gate.cachedRecord(widget.uid);
    if (!mounted) return;
    setState(() {
      _readyAt = record == null ? null : pinResetAvailableAt(record);
      _checking = false;
    });
  }

  Duration? get _waiting {
    final readyAt = _readyAt;
    if (readyAt == null) return null;
    final left = readyAt.difference(DateTime.now());
    return left.isNegative ? null : left;
  }

  /// Hours and minutes, because "in 23 hours 58 minutes" is the useful half of
  /// a 24-hour wait and "in 86394 seconds" is not.
  String _waitText(Duration left) {
    final hours = left.inHours;
    final minutes = left.inMinutes.remainder(60);
    if (hours == 0) return '${minutes}m';
    if (minutes == 0) return '${hours}h';
    return '${hours}h ${minutes}m';
  }

  Future<void> _reset() async {
    if (_busy) return;
    setState(() => _busy = true);
    final outcome = await ref.read(pinGateProvider).forgetPin(widget.uid);
    if (!mounted) return;

    switch (outcome) {
      case PinForgetOutcome.reset:
        HapticFeedback.mediumImpact();
        Navigator.of(context).pop(true);
        return;
      case PinForgetOutcome.stillTooSoon:
        // The record moved under us — another device stamped it. Read again
        // rather than report a wait we guessed.
        setState(() => _checking = true);
        await _readCooldown();
        _say('This PIN was set too recently to reset yet.');
        return;
      case PinForgetOutcome.refused:
        setState(() => _busy = false);
        // One message for every refusal, because the rules cannot tell the
        // caller which rule said no, and a guess would be worse than the
        // truth: nothing was changed, and the PIN is still asked for.
        _say('Could not reset the PIN. Nothing was changed — check your '
            'connection and try again.');
        return;
    }
  }

  void _say(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: AppColors.statusAlert,
      content: Text(text),
      duration: const Duration(seconds: 6),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final waiting = _waiting;
    final blocked = _checking || waiting != null || _busy;

    return PopScope(
      canPop: !_busy,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
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
                    Icons.help_outline_rounded,
                    size: 18,
                    color: AppColors.primaryForest,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      // The action, not the gate's question again: the trigger
                      // below the pad already says "Cannot remember your PIN?",
                      // and two identical strings on one screen is noise.
                      'Set the PIN aside',
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
                'You are signed in as the Admin, so the PIN can be set aside. '
                'You will choose a new one next.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  height: 1.5,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 12),
              // What this costs, in the Admin's own words rather than in the
              // rules'. ADR-0016 is explicit that the lockout watermark goes
              // with the record; hiding that would make a security control
              // vanish behind a reassuring button.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.statusAlert.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  'This clears the record, so the lockout count and any waiting '
                  'time go with it, and anyone holding your unlocked phone could '
                  'do the same. Your bookings and money are not affected.',
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    height: 1.5,
                    color: AppColors.textDark,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (_checking)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else if (waiting != null)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    'Available in ${_waitText(waiting)}',
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                )
              else
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    key: const Key('forgot-pin-reset'),
                    onPressed: _busy ? null : _reset,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.statusAlert,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: _busy
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
              const SizedBox(height: 4),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: TextButton(
                  key: const Key('forgot-pin-back'),
                  // ADR-0015 §6: `Back` is the cancel word in this house.
                  onPressed: _busy ? null : () => Navigator.of(context).pop(false),
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
              // The button is disabled while the wait runs, so say why on the
              // control itself rather than only above it.
              if (blocked && !_checking && waiting != null)
                Semantics(
                  hint: 'A reset can be requested in ${_waitText(waiting)}',
                  child: const SizedBox.shrink(),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
