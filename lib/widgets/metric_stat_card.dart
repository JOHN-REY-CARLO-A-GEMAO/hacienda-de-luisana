import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';
import 'hacienda_card.dart';

/// A compact statistic with its label in sentence case and tabular figures.
class MetricStatCard extends StatelessWidget {
  final String title;
  final String value;
  final String subtitle;
  final IconData icon;
  final Color accentColor;
  final bool hasAlert;

  const MetricStatCard({
    super.key,
    required this.title,
    required this.value,
    required this.subtitle,
    required this.icon,
    this.accentColor = AppColors.primaryForest,
    this.hasAlert = false,
  });

  @override
  Widget build(BuildContext context) {
    return HaciendaCard(
      padding: const EdgeInsets.all(16),
      borderColor: hasAlert
          ? AppColors.statusAlert.withValues(alpha: 0.42)
          : AppColors.cardBorder,
      semanticLabel: hasAlert ? '$title: $value. $subtitle. Needs attention.' : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: AppTheme.label(fontSize: 12),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 6),
              Icon(icon, size: 18, color: accentColor),
            ],
          ),
          const SizedBox(height: 12),
          _MetricValue(text: value, color: AppColors.textDark),
          const SizedBox(height: 6),
          Row(
            children: [
              if (hasAlert) ...[
                Container(
                  width: 7,
                  height: 7,
                  margin: const EdgeInsets.only(right: 6),
                  decoration: const BoxDecoration(
                    color: AppColors.statusAlert,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
              Expanded(
                child: Text(
                  subtitle,
                  style: AppTheme.body(
                    fontSize: 11,
                    color: hasAlert ? AppColors.statusAlert : AppColors.textMuted,
                    fontWeight: hasAlert ? FontWeight.w700 : FontWeight.normal,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The big number on a [MetricStatCard].
///
/// Digits use the display face, but a leading currency symbol uses the UI face:
/// Cinzel has no peso glyph and would otherwise fall back off-baseline.
class _MetricValue extends StatelessWidget {
  const _MetricValue({required this.text, required this.color});

  final String text;
  final Color color;

  static final RegExp _leadingSymbol = RegExp(r'^([^\d]*)(.*)$', dotAll: true);

  @override
  Widget build(BuildContext context) {
    final digits = AppTheme.metric(fontSize: 24, color: color);
    final match = _leadingSymbol.firstMatch(text);
    final symbol = match?.group(1) ?? '';
    final amount = match?.group(2) ?? text;
    if (symbol.isEmpty) {
      return Text(text, style: digits, maxLines: 2, overflow: TextOverflow.ellipsis);
    }

    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: symbol,
            style: AppTheme.body(
              fontSize: 15,
              color: color,
              fontWeight: FontWeight.w700,
            ),
          ),
          TextSpan(text: amount, style: digits),
        ],
      ),
      textAlign: TextAlign.left,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}
