import 'package:flutter/material.dart';

/// Press-scale micro-interaction for tappable cards (the "More" sheet
/// rows, banner buttons). Scales to [pressedScale] while pressed and
/// springs back on release.
///
/// Renders a plain passthrough when the user has animations disabled.
class PressableCard extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double pressedScale;

  const PressableCard({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.pressedScale = 0.985,
  });

  @override
  State<PressableCard> createState() => _PressableCardState();
}

class _PressableCardState extends State<PressableCard> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final animated = !MediaQuery.of(context).disableAnimations;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      child: animated
          ? AnimatedScale(
              scale: _pressed ? widget.pressedScale : 1.0,
              duration: const Duration(milliseconds: 150),
              curve: Curves.easeOut,
              child: widget.child,
            )
          : widget.child,
    );
  }
}
