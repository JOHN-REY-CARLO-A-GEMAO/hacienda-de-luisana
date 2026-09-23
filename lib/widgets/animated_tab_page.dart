import 'package:flutter/material.dart';

/// Wraps one tab of the [MainShellScreen]'s [IndexedStack].
///
/// The first time the tab becomes active (including the initial tab on
/// app start) it fades in and slides up over 280 ms. The child element is
/// passed as the [AnimatedBuilder] child, so during the animation the
/// framework only re-paints the transform/opacity — the tab's widget
/// subtree is not rebuilt per frame.
///
/// Inactive tabs that have never been visited are returned untouched
/// (the [IndexedStack] does not paint them anyway), and everything
/// collapses to a static swap when animations are disabled.
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
      duration: const Duration(milliseconds: 280),
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
        builder: (context, child) {
          final v = Curves.easeOut.transform(_controller.value);
          return Opacity(
            opacity: v,
            child: Transform.translate(
              offset: Offset(0, 12 * (1 - v)),
              child: child,
            ),
          );
        },
        child: widget.child,
      ),
    );
  }
}
