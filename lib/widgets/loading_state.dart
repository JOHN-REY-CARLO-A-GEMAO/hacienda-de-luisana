import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';

/// An explained loading state: the spinner never carries the meaning alone,
/// and assistive technology receives the same message.
class LoadingState extends StatelessWidget {
  final String label;
  final String? detail;

  const LoadingState({
    super.key,
    this.label = 'Reading bookings…',
    this.detail,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        liveRegion: true,
        label: detail == null ? label : '$label $detail',
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(
                  width: 30,
                  height: 30,
                  child: CircularProgressIndicator(strokeWidth: 2.6),
                ),
                const SizedBox(height: 15),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: AppTheme.title(fontSize: 15),
                ),
                if (detail != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    detail!,
                    textAlign: TextAlign.center,
                    style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
