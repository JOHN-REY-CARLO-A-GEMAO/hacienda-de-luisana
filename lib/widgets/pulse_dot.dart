import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// A dot that emits a soft expanding ring — the "guest approaching"
/// indicator on the dashboard banner.
///
/// The pulse is paint-only (transform + opacity inside a
/// [RepaintBoundary]) and collapses to a static dot when the user has
/// animations disabled in the system settings.
class PulseDot extends StatefulWidget {
  final double size;
  final Color color;
  final Duration period;

  const PulseDot({
    super.key,
    this.size = 10,
    this.color = AppColors.statusSuccess,
    this.period = const Duration(milliseconds: 900),
  });

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.period);
  }

  @override
  void didUpdateWidget(PulseDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.period != widget.period) {
      _controller.duration = widget.period;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _staticDot() {
    return Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.of(context).disableAnimations) {
      if (_controller.isAnimating) _controller.stop();
      return _staticDot();
    }
    if (!_controller.isAnimating) _controller.repeat();

    return RepaintBoundary(
      child: SizedBox(
        width: widget.size * 2.4,
        height: widget.size * 2.4,
        child: Stack(
          alignment: Alignment.center,
          children: [
            AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final v = _controller.value;
                return Transform.scale(
                  scale: 1 + 0.9 * v,
                  child: Container(
                    width: widget.size,
                    height: widget.size,
                    decoration: BoxDecoration(
                      color: widget.color.withOpacity(0.35 * (1 - v)),
                      shape: BoxShape.circle,
                    ),
                  ),
                );
              },
            ),
            _staticDot(),
          ],
        ),
      ),
    );
  }
}
