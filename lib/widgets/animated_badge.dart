import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// Bottom-nav count badge that pops in when the count goes from 0 to n
/// and out when it returns to 0. Layout size is constant, so the
/// surrounding [Stack] never reflows.
class AnimatedBadge extends StatelessWidget {
  final int count;
  final Color color;

  const AnimatedBadge({
    super.key,
    required this.count,
    this.color = AppColors.statusAlert,
  });

  @override
  Widget build(BuildContext context) {
    final visible = count > 0;
    final animated = !MediaQuery.of(context).disableAnimations;

    final badge = Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 8,
          color: Colors.white,
          fontWeight: FontWeight.bold,
        ),
      ),
    );

    if (!animated) return visible ? badge : const SizedBox.shrink();

    return AnimatedScale(
      scale: visible ? 1.0 : 0.0,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOutBack,
      child: AnimatedOpacity(
        opacity: visible ? 1.0 : 0.0,
        duration: const Duration(milliseconds: 180),
        child: badge,
      ),
    );
  }
}
