import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// Brand progress bar: a quiet track, a pine fill and a real percentage for
/// screen readers. Value changes animate implicitly.
class LuxeProgress extends StatelessWidget {
  final double value;
  final Color? color;
  final double height;
  final String? semanticLabel;

  const LuxeProgress({
    super.key,
    required this.value,
    this.color,
    this.height = 8,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    final progress = value.clamp(0.0, 1.0);
    return Semantics(
      progressBar: true,
      value: '${(progress * 100).round()}%',
      label: semanticLabel,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(height / 2),
        child: LinearProgressIndicator(
          value: progress,
          minHeight: height,
          backgroundColor: AppColors.surfaceSunken,
          valueColor: AlwaysStoppedAnimation<Color>(
            color ?? AppColors.primaryForest,
          ),
        ),
      ),
    );
  }
}
