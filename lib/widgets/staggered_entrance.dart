import 'package:flutter/material.dart';

/// Fades + slides its child up on first build.
///
/// Siblings pass a rising [index] (0, 1, 2, …) to stagger by
/// `index * [baseDelay]`. The effect runs once; once settled the widget
/// returns to a plain passthrough so it adds zero per-frame cost.
///
/// Respects the system "reduce motion" setting
/// ([MediaQueryData.disableAnimations]) by appearing instantly.
class StaggeredEntrance extends StatefulWidget {
  final Widget child;
  final int index;
  final Duration baseDelay;
  final Duration duration;
  final double slideDistance;

  const StaggeredEntrance({
    super.key,
    required this.child,
    this.index = 0,
    this.baseDelay = const Duration(milliseconds: 60),
    this.duration = const Duration(milliseconds: 450),
    this.slideDistance = 14,
  });

  @override
  State<StaggeredEntrance> createState() => _StaggeredEntranceState();
}

class _StaggeredEntranceState extends State<StaggeredEntrance>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    // Rebuild once the effect settles so this element can drop back to a
    // plain passthrough (no lingering Opacity/Transform wrappers).
    _controller.addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) setState(() {});
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;

    if (MediaQuery.of(context).disableAnimations) {
      _controller.value = 1.0;
      return;
    }
    final delay =
        Duration(milliseconds: widget.index * widget.baseDelay.inMilliseconds);
    Future<void>.delayed(delay, () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Settled: plain passthrough, no per-frame cost.
    if (_controller.value == 1.0) return widget.child;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final v = Curves.easeOut.transform(_controller.value);
        return Opacity(
          opacity: v,
          child: Transform.translate(
            offset: Offset(0, widget.slideDistance * (1 - v)),
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
