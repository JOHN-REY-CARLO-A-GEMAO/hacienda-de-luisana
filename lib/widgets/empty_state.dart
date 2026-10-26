import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';

/// An empty or failed list is a direction, not a dead end.
///
/// The title says what is absent, the body says what to do next, and an
/// optional action gives the user the shortest way forward.
class EmptyState extends StatelessWidget {
  final IconData? icon;
  final String title;
  final String? subtitle;
  final Widget? action;
  final EdgeInsetsGeometry? padding;
  final Color? accent;

  const EmptyState({
    super.key,
    this.icon,
    required this.title,
    this.subtitle,
    this.action,
    this.padding,
    this.accent,
  });

  @override
  Widget build(BuildContext context) {
    final tone = accent ?? AppColors.primaryForest;
    return Center(
      child: Semantics(
        container: true,
        liveRegion: true,
        label: subtitle == null ? title : '$title. $subtitle',
        child: SingleChildScrollView(
          padding: padding ?? const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: tone.withValues(alpha: 0.10),
                      shape: BoxShape.circle,
                      border: Border.all(color: tone.withValues(alpha: 0.24)),
                    ),
                    child: Icon(icon, size: 25, color: tone),
                  ),
                  const SizedBox(height: 14),
                ],
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: AppTheme.display(fontSize: 19),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    subtitle!,
                    textAlign: TextAlign.center,
                    style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
                  ),
                ],
                if (action != null) ...[
                  const SizedBox(height: 18),
                  action!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
