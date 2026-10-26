import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';

/// Readable section label with an optional trailing text action.
///
/// Titles use sentence case; there are no decorative eyebrows or arrows.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? caption;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? actionSemanticsLabel;
  final EdgeInsetsGeometry? padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.caption,
    this.actionLabel,
    this.onAction,
    this.actionSemanticsLabel,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding ??
          const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.display(fontSize: 18),
                ),
                if (caption != null) ...[
                  const SizedBox(height: 3),
                  Text(caption!, style: AppTheme.body(fontSize: 12, color: AppColors.textMuted)),
                ],
              ],
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(width: 8),
            Semantics(
              button: true,
              label: actionSemanticsLabel ?? actionLabel!,
              child: TextButton(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
