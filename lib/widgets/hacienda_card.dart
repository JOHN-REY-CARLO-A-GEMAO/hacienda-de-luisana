import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// Brand card surface for the owner app.
///
/// White surface, hairline border and a soft, low-contrast shadow — the
/// same recipe previously inlined in Dashboard, Bookings, Stays, Rooms,
/// CRM and Smart Lock. Pass [borderColor: null] for a borderless inner
/// panel, or a custom [border] for accent cards (pending, VIP).
class HaciendaCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final Color? borderColor;
  final double borderWidth;
  final BorderRadiusGeometry? borderRadius;
  final List<BoxShadow>? shadows;
  final BoxBorder? border;

  const HaciendaCard({
    super.key,
    required this.child,
    this.padding,
    this.color,
    this.borderColor,
    this.borderWidth = 1,
    this.borderRadius,
    this.shadows,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    final BoxBorder? effectiveBorder =
        border ??
        (borderColor != null
            ? Border.all(color: borderColor!, width: borderWidth)
            : null);

    return Container(
      decoration: BoxDecoration(
        color: color ?? AppColors.cardSurface,
        borderRadius: borderRadius ?? BorderRadius.circular(20),
        border: effectiveBorder,
        boxShadow: shadows ?? const [
          BoxShadow(
            color: Color(0x050F1C11),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Padding(
        padding: padding ?? const EdgeInsets.all(16),
        child: child,
      ),
    );
  }
}
