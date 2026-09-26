/// The tour's spotlight layer.
///
/// Four dim panes frame a see-through window around the highlighted control,
/// so the real widget underneath keeps receiving touches exactly as usual
/// while the rest of the screen is shielded from stray taps. The card
/// explains what the control does and why, and holds the tour's navigation
/// (Skip tour / Back / Continue / Exit). It docks near the highlight when
/// there is room, otherwise to the bottom of the screen — phones first.
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
  final GlobalKey _cardKey = GlobalKey();
  Timer? _ticker;
  late final AnimationController _pulse;
  Rect? _rect;
  double _cardHeight = 300;

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
    final changed = rect != _rect;
    final cardBox = _cardKey.currentContext?.findRenderObject();
    double? cardHeight;
    if (cardBox is RenderBox && cardBox.attached && cardBox.hasSize) {
      cardHeight = cardBox.size.height;
    }
    if (changed || (cardHeight != null && (cardHeight - _cardHeight).abs() > 4)) {
      setState(() {
        _rect = rect;
        if (cardHeight != null) _cardHeight = cardHeight;
      });
    } else if (_rect != rect) {
      setState(() => _rect = rect);
    }
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
    final maxCardHeight = size.height * 0.55;
    final keyboard = media.viewInsets.bottom;

    double left;
    double? top;
    double? bottom;
    if (rect == null) {
      left = (size.width - width) / 2;
      top = (size.height - _cardHeight) / 2.4;
      if (top < media.padding.top + 12) top = media.padding.top + 12;
    } else {
      left = rect.center.dx - width / 2;
      final maxLeft = size.width - width - 12;
      if (left < 12) left = 12;
      if (left > maxLeft && maxLeft > 12) left = maxLeft;
      final fitsBelow = rect.bottom + gap + _cardHeight + keyboard < size.height - 12;
      final fitsAbove = rect.top - gap - _cardHeight > media.padding.top + 8;
      if (fitsBelow) {
        top = rect.bottom + gap;
      } else if (fitsAbove) {
        top = rect.top - gap - _cardHeight;
      } else {
        bottom = (media.padding.bottom > 0 ? media.padding.bottom : 12.0) + keyboard;
      }
    }

    final body = tour.missing && step.fallbackBody != null ? step.fallbackBody! : step.body;

    return Positioned(
      left: left,
      top: top,
      bottom: bottom,
      width: width,
      child: Material(
        color: Colors.transparent,
        child: Container(
          key: _cardKey,
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
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'ADMIN TOUR · STEP ${tour.index + 1} OF ${tour.total}',
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
                        padding: EdgeInsets.all(2),
                        child: Icon(Icons.close, size: 18, color: AppColors.textMuted),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  step.title,
                  style: GoogleFonts.cinzel(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    height: 1.45,
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
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.primaryForest,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '👉 ${step.actionHint!}',
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
                    'The control this step highlights isn’t on this screen right now — read along and continue whenever you’re ready.',
                    style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: List.generate(
                    tour.total,
                    (i) => Container(
                      margin: const EdgeInsets.only(right: 4),
                      height: 4,
                      width: i == tour.index ? 18 : 8,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(4),
                        color: i == tour.index
                            ? AppColors.primaryForest
                            : i < tour.index
                                ? AppColors.primaryForestLight
                                : AppColors.cardBorder,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (!tour.isLast)
                      TextButton(
                        onPressed: tour.skip,
                        child: Text('Skip tour',
                            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
                      ),
                    if (tour.index > 0)
                      TextButton(
                        onPressed: tour.back,
                        child: Text('Back',
                            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
                      ),
                    const SizedBox(width: 4),
                    if (tour.awaiting)
                      TextButton(
                        onPressed: tour.next,
                        child: Text('Skip this step',
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              decoration: TextDecoration.underline,
                              color: AppColors.primaryForest,
                            )),
                      )
                    else
                      ElevatedButton(
                        onPressed: tour.next,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primaryForest,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        ),
                        child: Text(
                          tour.isLast ? 'Finish' : step.continueLabel,
                          style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600),
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
