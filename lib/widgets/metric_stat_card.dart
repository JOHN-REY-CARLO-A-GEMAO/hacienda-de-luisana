import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/constants/app_constants.dart';

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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardSurface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: hasAlert ? AppColors.statusAlert.withOpacity(0.5) : AppColors.cardBorder,
          width: hasAlert ? 1.5 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    height: 1.2,
                    letterSpacing: 0.3,
                    color: AppColors.textMuted,
                  ),
                  // "Today's check-ins" and "Pending requests" are the longest
                  // titles and must wrap rather than ellipsize — a cut-off
                  // label reads as a broken layout.
                  maxLines: 2,
                  overflow: TextOverflow.visible,
                ),
              ),
              const SizedBox(width: 5),
              Container(
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: accentColor.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 13, color: accentColor),
              ),
            ],
          ),
          const SizedBox(height: 6),
          _MetricValue(text: value, color: AppColors.textDark),
          const SizedBox(height: 4),
          Row(
            children: [
              if (hasAlert)
                Container(
                  width: 6,
                  height: 6,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: const BoxDecoration(
                    color: AppColors.statusAlert,
                    shape: BoxShape.circle,
                  ),
                ),
              Expanded(
                child: Text(
                  subtitle,
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: hasAlert ? AppColors.statusAlert : AppColors.textMuted,
                    fontWeight: hasAlert ? FontWeight.w600 : FontWeight.normal,
                  ),
                  maxLines: 1,
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
/// The digits keep the display face (Cinzel), but a leading currency symbol is
/// set in the UI face instead: Cinzel has no glyph for the peso sign (U+20B1),
/// so it silently fell back to another font and left "₱41,107" with a symbol
/// that sat off the digits' baseline.
class _MetricValue extends StatelessWidget {
  const _MetricValue({required this.text, required this.color});

  final String text;
  final Color color;

  static final RegExp _leadingSymbol = RegExp(r'^([^\d]*)(.*)$', dotAll: true);

  @override
  Widget build(BuildContext context) {
    final digits = GoogleFonts.cinzel(
      fontSize: 22,
      fontWeight: FontWeight.bold,
      color: color,
    );
    final match = _leadingSymbol.firstMatch(text);
    final symbol = match?.group(1) ?? '';
    final amount = match?.group(2) ?? text;
    if (symbol.isEmpty) return Text(text, style: digits);

    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: symbol,
            style: GoogleFonts.inter(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          TextSpan(text: amount, style: digits),
        ],
      ),
      textAlign: TextAlign.left,
    );
  }
}
