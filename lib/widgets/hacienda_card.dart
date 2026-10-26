import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';

/// Paper surface for one Admin record or form section.
///
/// The ledger look comes from a hairline rule and generous internal spacing,
/// not from the same soft shadow on every rectangle. Accent borders are used
/// only when their colour encodes a real state. Pass [showBorder] `false` for
/// a quiet inner panel.
class HaciendaCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final Color? borderColor;
  final double borderWidth;
  final BorderRadiusGeometry? borderRadius;
  final List<BoxShadow>? shadows;
  final BoxBorder? border;
  final bool showBorder;
  final String? semanticLabel;

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
    this.showBorder = true,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    final BoxBorder? effectiveBorder = !showBorder
        ? null
        : border ??
            Border.all(
              color: borderColor ?? AppColors.cardBorder,
              width: borderWidth,
            );

    final decorated = Container(
      decoration: BoxDecoration(
        color: color ?? AppColors.cardSurface,
        borderRadius: borderRadius ?? BorderRadius.circular(AppTheme.radiusCard),
        border: effectiveBorder,
        boxShadow: shadows ?? const <BoxShadow>[],
      ),
      child: Padding(
        padding: padding ?? const EdgeInsets.all(16),
        child: child,
      ),
    );

    if (semanticLabel == null) return decorated;
    return Semantics(container: true, label: semanticLabel, child: decorated);
  }
}
