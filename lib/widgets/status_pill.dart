import 'package:flutter/material.dart';

/// Tinted status chip (12% fill, 40% border, bold label) used for booking
/// status, room status and proximity states. Exposes its label to
/// screen readers via [Semantics].
class StatusPill extends StatelessWidget {
  final String label;
  final Color color;
  final double fontSize;
  final double horizontalPadding;
  final double radius;

  const StatusPill({
    super.key,
    required this.label,
    required this.color,
    this.fontSize = 11,
    this.horizontalPadding = 10,
    this.radius = 16,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      container: true,
      child: Container(
        padding:
            EdgeInsets.symmetric(horizontal: horizontalPadding, vertical: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: color.withOpacity(0.4)),
        ),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: fontSize,
            fontWeight: FontWeight.bold,
            color: color,
            height: 1.3,
          ),
        ),
      ),
    );
  }
}
