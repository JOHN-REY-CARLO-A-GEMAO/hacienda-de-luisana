import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';

/// An explained loading state: the progress indicator never has to carry the
/// meaning by itself, and assistive technology receives the same message.
class LoadingState extends StatelessWidget {
  final String label;
  final String? detail;

  const LoadingState({
    super.key,
    this.label = 'Binabasa ang mga booking…',
    this.detail,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        liveRegion: true,
        label: detail == null ? label : '$label $detail',
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 20),
              Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textDark,
                ),
              ),
              if (detail != null) ...[
                const SizedBox(height: 8),
                Text(
                  detail!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, color: AppColors.textMuted, height: 1.4),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
