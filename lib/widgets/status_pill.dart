import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';

/// Status in words, supported by a dot or icon and a tinted outline.
///
/// Colour is never the only signal, and the full label is exposed to
/// assistive technology.
class StatusPill extends StatelessWidget {
  final String label;
  final Color color;
  final double fontSize;
  final double horizontalPadding;
  final double radius;
  final IconData? icon;
  final String? semanticsLabel;

  const StatusPill({
    super.key,
    required this.label,
    required this.color,
    this.fontSize = 12.5,
    this.horizontalPadding = 10,
    this.radius = AppTheme.radiusPill,
    this.icon,
    this.semanticsLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel ?? label,
      container: true,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: horizontalPadding, vertical: 6),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.09),
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: color.withValues(alpha: 0.38)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: fontSize + 1, color: color),
              const SizedBox(width: 5),
            ] else ...[
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
            ],
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 180),
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTheme.label(
                  fontSize: fontSize,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
