import 'package:flutter/material.dart';

/// Wraps one tab of the shell's IndexedStack with a brief fade.
///
/// The child element is passed as the [AnimatedBuilder] child, so the
/// framework does not rebuild descendants per frame. Tabs that have never
/// been visited stay untouched, and reduced-motion users get a static swap.
class AnimatedTabPage extends StatefulWidget {
  final Widget child;
  final bool isActive;

  const AnimatedTabPage({
    super.key,
    required this.child,
    required this.isActive,
  });

  @override
  State<AnimatedTabPage> createState() => _AnimatedTabPageState();
}

class _AnimatedTabPageState extends State<AnimatedTabPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _hasEntered = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 160),
      value: 1.0,
    );
    if (widget.isActive) {
      _hasEntered = true;
      _controller
        ..value = 0.0
        ..forward();
    }
  }

  @override
  void didUpdateWidget(AnimatedTabPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.isActive && widget.isActive) {
      _hasEntered = true;
      _controller
        ..value = 0.0
        ..forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isActive && !_hasEntered) return widget.child;
    if (MediaQuery.of(context).disableAnimations) return widget.child;

    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => Opacity(
          opacity: Curves.easeOut.transform(_controller.value),
          child: child,
        ),
        child: widget.child,
      ),
    );
  }
}
