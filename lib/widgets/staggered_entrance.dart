import 'package:flutter/material.dart';

/// A short, single fade on first build.
///
/// Earlier versions staggered and slid many siblings; the skill's restraint
/// pass replaces that with one quiet 180 ms reveal. The [index],
/// [baseDelay] and [slideDistance] parameters remain for call-site
/// compatibility, but their defaults produce no scattered motion. The whole
/// effect collapses to an instant display when the system asks for reduced
/// motion.
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
    this.baseDelay = Duration.zero,
    this.duration = const Duration(milliseconds: 180),
    this.slideDistance = 0,
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
    final delay = Duration(
      milliseconds: widget.index * widget.baseDelay.inMilliseconds,
    );
    if (delay == Duration.zero) {
      _controller.forward();
    } else {
      Future<void>.delayed(delay, () {
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_controller.value == 1.0) return widget.child;
    return RepaintBoundary(
      child: AnimatedBuilder(
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
      ),
    );
  }
}
