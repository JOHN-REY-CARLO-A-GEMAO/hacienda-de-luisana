/// The tour's spotlight layer.
///
/// Four dim panes frame a see-through window around the highlighted control,
/// so the real widget underneath keeps receiving touches exactly as usual
/// while the rest of the screen is shielded from stray taps. The card
/// explains what the control does and why, and holds the tour's navigation
/// (× to exit, Back, Next). It docks in whichever band beside the highlight
/// is taller — never over the highlight, never over the shell's tab bar —
/// and phones first.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../core/constants/app_constants.dart';
import 'tutorial_controller.dart';
import 'tutorial_step.dart';

class TutorialOverlay extends StatefulWidget {
  const TutorialOverlay({super.key, required this.controller});

  final TutorialController controller;

  @override
  State<TutorialOverlay> createState() => _TutorialOverlayState();
}

class _TutorialOverlayState extends State<TutorialOverlay>
    with SingleTickerProviderStateMixin {
  Timer? _ticker;
  late final AnimationController _pulse;
  Rect? _rect;

  TutorialController get tour => widget.controller;

  @override
  void initState() {
    super.initState();
    // A light tick keeps the spotlight glued to its widget through scrolls,
    // tab switches, sheet pushes and keyboard opens.
    _ticker = Timer.periodic(const Duration(milliseconds: 120), (_) => _remeasure());
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
    _remeasure();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  void _remeasure() {
    if (!mounted || !tour.running) return;
    final rect = tour.targetRect(tour.current.targetKey);
    if (rect != _rect) setState(() => _rect = rect);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: tour,
      builder: (context, _) {
        if (!tour.running) return const SizedBox.shrink();
        final step = tour.current;
        final media = MediaQuery.of(context);
        final size = media.size;
        final rect = tour.targetRect(step.targetKey);

        Widget? ring;
        final blockers = <Widget>[];
        if (rect != null) {
          blockers.addAll([
            _blocker(Rect.fromLTRB(0, 0, size.width, rect.top)),
            _blocker(Rect.fromLTRB(0, rect.bottom, size.width, size.height)),
            _blocker(Rect.fromLTRB(0, rect.top, rect.left, rect.bottom)),
            _blocker(Rect.fromLTRB(rect.right, rect.top, size.width, rect.bottom)),
          ]);
          ring = _buildRing(rect);
        } else {
          blockers.add(_blocker(Rect.fromLTWH(0, 0, size.width, size.height)));
        }

        return Stack(
          children: [
            ...blockers,
            if (ring != null) ring,
            _buildCard(context, step, rect, size, media),
          ],
        );
      },
    );
  }

  Widget _blocker(Rect rect) {
    if (rect.width <= 0 || rect.height <= 0) return const SizedBox.shrink();
    return Positioned.fromRect(
      rect: rect,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {/* absorb stray taps — the tour waits for the real control */},
        child: Container(color: Colors.black.withOpacity(0.55)),
      ),
    );
  }

  Widget _buildRing(Rect rect) {
    return Positioned.fromRect(
      rect: rect,
      child: IgnorePointer(
        child: AnimatedBuilder(
          animation: _pulse,
          builder: (context, _) {
            final spread = 3.0 + _pulse.value * 7.0;
            var opacity = 0.55 - _pulse.value * 0.5;
            if (opacity < 0.0) opacity = 0.0;
            if (opacity > 1.0) opacity = 1.0;
            return Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.accentGoldLight, width: 2),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.accentGoldLight.withOpacity(opacity),
                    blurRadius: 18,
                    spreadRadius: spread,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCard(
    BuildContext context,
    TutorialStep step,
    Rect? rect,
    Size size,
    MediaQueryData media,
  ) {
    final width = size.width - 24 < 420.0 ? size.width - 24 : 420.0;
    const gap = 14.0;
    const edge = 12.0;
    final keyboard = media.viewInsets.bottom;

    // The tab bar is part of the tour's vocabulary — several steps wait for a
    // tap on it — so the card is never allowed to cover it. It also keeps the
    // dashboard's metric cards visible behind the spotlight.
    final navTop = tour.targetRect('bottomNav')?.top ?? size.height;
    final floor = navTop - edge - keyboard;
    final ceiling = media.padding.top + edge;

    final maxLeft = size.width - width - edge;
    var left = rect == null
        ? maxLeft / 2
        : (rect.center.dx - width / 2).clamp(edge, maxLeft > edge ? maxLeft : edge);
    final right = left + width;

    Rect slot;
    if (rect == null) {
      slot = Rect.fromLTRB(left, ceiling, right, floor);
    } else {
      final below = Rect.fromLTRB(left, rect.bottom + gap, right, floor);
      final above = Rect.fromLTRB(left, ceiling, right, rect.top - gap);
      slot = below.height >= above.height ? below : above;
      // Both bands are cramped: fall back to the whole column, but stay short
      // so the highlighted control is never buried.
      if (slot.height < 140) {
        slot = Rect.fromLTRB(left, ceiling, right, floor);
      }
      left = slot.left;
    }

    final maxCardHeight = slot.height > 340.0 ? 340.0 : slot.height;

    final body = tour.missing && step.fallbackBody != null ? step.fallbackBody! : step.body;

    return Positioned.fromRect(
      rect: Rect.fromLTWH(left, slot.top, width, maxCardHeight),
      child: Material(
        color: Colors.transparent,
        child: Container(
          constraints: BoxConstraints(maxHeight: maxCardHeight),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.cardBorder),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.22),
                blurRadius: 28,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'STEP ${tour.index + 1} OF ${tour.total}',
                        style: GoogleFonts.inter(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 1.4,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: tour.exit,
                      borderRadius: BorderRadius.circular(20),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(Icons.close, size: 18, color: AppColors.textMuted),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: (tour.index + 1) / tour.total,
                    minHeight: 3,
                    backgroundColor: AppColors.cardBorder,
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      AppColors.primaryForest,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  step.title,
                  style: GoogleFonts.cinzel(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  body,
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    height: 1.4,
                    color: AppColors.textDark.withOpacity(0.9),
                  ),
                ),
                if (step.why != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.accentGoldLight.withOpacity(0.25),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.accentGold.withOpacity(0.35)),
                    ),
                    child: Text(
                      step.why!,
                      style: GoogleFonts.inter(
                        fontSize: 11.5,
                        height: 1.4,
                        color: AppColors.textDark.withOpacity(0.85),
                      ),
                    ),
                  ),
                ],
                if (tour.awaiting && step.actionHint != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.primaryForest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      step.actionHint!,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
                if (tour.missing && step.targetKey != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    'That control isn’t on this screen right now — read along and continue.',
                    style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                  ),
                ],
                const SizedBox(height: 12),
                // One way out per direction: × leaves the tour, Back steps back,
                // the primary button moves forward. Interactive steps use it as
                // their escape hatch so a missing control can never strand
                // the Admin — which is why "Skip tour" and "Skip this step" are
                // not needed alongside it.
                Row(
                  children: [
                    if (tour.index > 0)
                      TextButton(
                        onPressed: tour.back,
                        child: Text('Back',
                            style: GoogleFonts.inter(fontSize: 13, color: AppColors.textMuted)),
                      ),
                    const Spacer(),
                    ElevatedButton(
                      onPressed: tour.next,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryForest,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                      ),
                      child: Text(
                        tour.isLast ? 'Finish' : step.continueLabel,
                        style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
