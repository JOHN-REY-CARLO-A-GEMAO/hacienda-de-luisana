import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// Brand progress bar (8 pt, rounded, deep-pine on a faint track).
/// Value changes animate implicitly via [LinearProgressIndicator].
class LuxeProgress extends StatelessWidget {
  final double value;
  final Color? color;
  final double height;

  const LuxeProgress({
    super.key,
    required this.value,
    this.color,
    this.height = 8,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(height / 2),
      child: LinearProgressIndicator(
        value: value.clamp(0.0, 1.0),
        minHeight: height,
        backgroundColor: Colors.black.withOpacity(0.08),
        valueColor:
            AlwaysStoppedAnimation<Color>(color ?? AppColors.primaryForest),
      ),
    );
  }
}
